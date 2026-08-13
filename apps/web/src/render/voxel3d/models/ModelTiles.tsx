import * as THREE from 'three';
import React from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { TileVisibility } from '@tactica/engine';
import type { MapData } from '../types.js';
import type { CameraInteraction } from '../CameraRig.js';
import {
  TILE_MODEL_URLS, tileModelForTerrain, type TileModelKind,
} from './modelAssets.js';

/**
 * GEN 8 — 3D Tileset board: the floor plane is replaced by one GLB tile block
 * per grid cell (flat / forest / mountain / water), drawn as ONE InstancedMesh
 * per tile kind. Each model is normalized so its footprint is exactly 1×1 world
 * units and the FLAT tile's top surface lands at y=0 — the plane units stand
 * on, highlights hover over, and city/resource props are built against.
 * Mountains rise above 0; water dips below. Same coordinate contract as Floor:
 * tile (x,y) centered at (x+0.5, 0, y+0.5).
 *
 * Clicks ride a single invisible plane at y=0 (identical to Floor's contract);
 * the instanced tiles carry no pointer handlers, so r3f never raycasts their
 * geometry.
 */

interface NormalizedTile {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Local mesh→scene transform (gltf node transforms, if any). */
  world: THREE.Matrix4;
  /** Per-axis scale making the footprint EXACTLY 1×1 (applied in model space,
   *  before the quarter-turn, so rotated tiles keep the 1×1 footprint). A
   *  malformed export with a squashed axis — Water1 shipped 1.9×1.6 — is
   *  stretched back to a full square tile. Height uses the smaller footprint
   *  factor, i.e. the export's intended uniform scale. */
  scale: THREE.Vector3;
  /** Model-space bbox (scene space, before scaling). */
  box: THREE.Box3;
}

function normalizeTile(scene: THREE.Group): NormalizedTile {
  scene.updateMatrixWorld(true);
  let mesh: THREE.Mesh | null = null;
  scene.traverse(o => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new Error('tile GLB has no mesh');
  const m = mesh as THREE.Mesh;
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const sx = 1 / (size.x || 1);
  const sz = 1 / (size.z || 1);
  return {
    geometry: m.geometry,
    material: Array.isArray(m.material) ? m.material[0] : m.material,
    world: m.matrixWorld.clone(),
    scale: new THREE.Vector3(sx, Math.min(sx, sz), sz),
    box,
  };
}

const TILE_KINDS = Object.keys(TILE_MODEL_URLS) as TileModelKind[];

// Per-kind vertical trim on top of the shared base alignment, hand-tuned per
// tile set (slab thickness isn't derivable from the bbox — it can't separate
// slab from trees/peaks). Current set: the "1" exports, whose slabs align at
// the base; water keeps the 20%-of-a-slab (~0.29) drop below ground level.
const TILE_Y_OFFSET: Record<TileModelKind, number> = {
  flat: 0,
  forest: 0,
  mountain: 0,
  water: -0.2 * 0.29,
};

export function ModelTiles({ map, visibility, onTileClick, onTileHover, interaction, occupied }: {
  map: MapData;
  visibility?: TileVisibility[][];
  onTileClick?: (x: number, y: number) => void;
  onTileHover?: (x: number | null, y?: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
  /** "x,y" keys of unit-occupied tiles: forest blocks swap to flat ground
   *  there so trees never clip through a unit's body. */
  occupied?: Set<string>;
}) {
  // Fixed-order hooks over the static kind list.
  const flat = useGLTF(TILE_MODEL_URLS.flat);
  const forest = useGLTF(TILE_MODEL_URLS.forest);
  const mountain = useGLTF(TILE_MODEL_URLS.mountain);
  const water = useGLTF(TILE_MODEL_URLS.water);

  const normalized = React.useMemo<Record<TileModelKind, NormalizedTile>>(() => ({
    flat: normalizeTile(flat.scene),
    forest: normalizeTile(forest.scene),
    mountain: normalizeTile(mountain.scene),
    water: normalizeTile(water.scene),
  }), [flat.scene, forest.scene, mountain.scene, water.scene]);

  // Shared ground plane: every tile's base sits where the FLAT tile's base must
  // be for its top to land exactly at y=0.
  const baseY = React.useMemo(() => {
    const f = normalized.flat;
    return -(f.box.max.y - f.box.min.y) * f.scale.y;
  }, [normalized]);


  // Grid cell → instance transforms, grouped by tile kind. Hidden (never seen)
  // tiles get no block at all — FogClouds covers them, and nothing can leak.
  const instancesByKind = React.useMemo(() => {
    const out: Record<TileModelKind, THREE.Matrix4[]> = {
      flat: [], forest: [], mountain: [], water: [],
    };
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const center = new THREE.Matrix4();
    const place = new THREE.Matrix4();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (visibility && visibility[y]?.[x] === 'hidden') continue;
        let kind = tileModelForTerrain(map.tiles[y][x].terrain);
        if (kind === 'forest' && occupied?.has(`${x},${y}`)) kind = 'flat';
        const n = normalized[kind];
        // Deterministic quarter-turn per tile so repeated blocks read varied.
        const rot = (((x * 7 + y * 13) % 4) * Math.PI) / 2;
        pos.set(x + 0.5, baseY + TILE_Y_OFFSET[kind], y + 0.5);
        quat.setFromAxisAngle(up, rot);
        scl.copy(n.scale);
        place.compose(pos, quat, scl);
        // Model-space: center x/z on origin, rest the bbox base on y=0.
        center.makeTranslation(
          -(n.box.min.x + n.box.max.x) / 2,
          -n.box.min.y,
          -(n.box.min.z + n.box.max.z) / 2,
        );
        out[kind].push(new THREE.Matrix4().multiplyMatrices(
          place, new THREE.Matrix4().multiplyMatrices(center, n.world)));
      }
    }
    return out;
  }, [map, visibility, normalized, baseY, occupied]);

  const handleClick = React.useCallback((e: ThreeEvent<MouseEvent>) => {
    if (!onTileClick) return;
    if (interaction?.current.suppressClick) return; // release of a grab-pan
    e.stopPropagation();
    const x = Math.min(map.width - 1, Math.max(0, Math.floor(e.point.x)));
    const y = Math.min(map.height - 1, Math.max(0, Math.floor(e.point.z)));
    onTileClick(x, y);
  }, [onTileClick, map.width, map.height, interaction]);

  return (
    <>
      {TILE_KINDS.map(kind => (
        <TileLayer
          key={kind}
          normalized={normalized[kind]}
          matrices={instancesByKind[kind]}
        />
      ))}
      {/* Click catcher at the walkable surface height — same math as Floor. */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[map.width / 2, 0, map.height / 2]}
        visible={false}
        onClick={handleClick}
        onPointerMove={e => {
          if (!onTileHover) return;
          onTileHover(
            Math.min(map.width - 1, Math.max(0, Math.floor(e.point.x))),
            Math.min(map.height - 1, Math.max(0, Math.floor(e.point.z))),
          );
        }}
        onPointerLeave={() => onTileHover?.(null)}
      >
        <planeGeometry args={[map.width, map.height]} />
      </mesh>
    </>
  );
}

function TileLayer({ normalized, matrices }: {
  normalized: NormalizedTile;
  matrices: THREE.Matrix4[];
}) {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);
  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      // Remount when capacity changes (fog reveals add instances).
      key={matrices.length}
      ref={ref}
      args={[normalized.geometry, normalized.material, matrices.length]}
      castShadow
      receiveShadow
      frustumCulled={false}
    />
  );
}

for (const url of Object.values(TILE_MODEL_URLS)) useGLTF.preload(url);
