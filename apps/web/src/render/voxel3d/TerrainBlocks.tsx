import * as THREE from 'three';
import React from 'react';
import type { TileVisibility } from '@tactica/engine';
import type { ArenaTheme, MapData } from './types.js';
import { TEAM_COLORS } from './palette.js';

/**
 * Voxel-first terrain: the board itself is the flat reflective floor; anything
 * that isn't plains gets a chunky block prop on its tile. Built fresh for this
 * renderer — no reuse of the 2D sprite/tile theming.
 */

interface BlockInstance {
  pos: [number, number, number];
  scale: [number, number, number];
  rotY?: number;
  color?: string;
}

function Blocks({ instances, color, emissive, emissiveIntensity = 0, opacity, castShadow = true }: {
  instances: BlockInstance[];
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  castShadow?: boolean;
}) {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    instances.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rotY ?? 0);
      m.compose(
        new THREE.Vector3(...b.pos),
        q,
        new THREE.Vector3(...b.scale),
      );
      mesh.setMatrixAt(i, m);
      if (b.color) mesh.setColorAt(i, c.set(b.color));
    });
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [instances]);
  if (instances.length === 0) return null;
  return (
    <instancedMesh
      key={instances.length}
      ref={ref}
      args={[undefined, undefined, instances.length]}
      castShadow={castShadow}
      receiveShadow
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        flatShading
        roughness={0.8}
        metalness={0.15}
        emissive={emissive ?? '#000000'}
        emissiveIntensity={emissiveIntensity}
        transparent={opacity !== undefined}
        opacity={opacity ?? 1}
      />
    </instancedMesh>
  );
}

interface TerrainSets {
  mountainBase: BlockInstance[];
  mountainPeak: BlockInstance[];
  forestCanopy: BlockInstance[];
  forestTrunk: BlockInstance[];
  oreCrystal: BlockInstance[];
  plasmaCrystal: BlockInstance[];
  orePatch: BlockInstance[];
  plasmaPatch: BlockInstance[];
  ruinPillar: BlockInstance[];
  cityBase: BlockInstance[];
  cityTower: BlockInstance[];
  cityWindow: BlockInstance[];
}

function buildTerrain(map: MapData, visibility: TileVisibility[][] | undefined, desert: boolean, breach: boolean, natureProps: boolean): TerrainSets {
  const s: TerrainSets = {
    mountainBase: [], mountainPeak: [], forestCanopy: [], forestTrunk: [],
    oreCrystal: [], plasmaCrystal: [],
    orePatch: [], plasmaPatch: [],
    ruinPillar: [], cityBase: [], cityTower: [], cityWindow: [],
  };
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y][x];
      const cx = x + 0.5;
      const cz = y + 0.5;
      // Fog of war: nothing is placed under never-seen tiles, so terrain can't
      // leak through the 3D view. The visible cloud layer itself is drawn by
      // FogClouds (drei Clouds) in Atmosphere.tsx.
      if (visibility && visibility[y]?.[x] === 'hidden') continue;
      const jitter = ((x * 7 + y * 13) % 5) / 5 - 0.4; // deterministic ±0.4 variation

      if (tile.isCity) {
        const teamColor = tile.owner != null
          ? TEAM_COLORS[tile.owner % TEAM_COLORS.length]
          : '#8fb4ff';
        // Centred on the tile; a garrisoned unit gets a small visual offset
        // toward the camera instead (see VoxelArena).
        if (breach) {
          // Small back-of-tile skyline: readable as a city without obscuring
          // the garrisoned unit standing in the foreground.
          s.cityBase.push({ pos: [cx, 0.045, cz + 0.08], scale: [0.72, 0.09, 0.54] });
          s.cityTower.push({ pos: [cx - 0.19, 0.26, cz + 0.12], scale: [0.22, 0.43, 0.22] });
          s.cityTower.push({ pos: [cx + 0.10, 0.34, cz + 0.16], scale: [0.27, 0.60, 0.24] });
          s.cityTower.push({ pos: [cx + 0.29, 0.20, cz - 0.01], scale: [0.14, 0.32, 0.16] });
          s.cityWindow.push({ pos: [cx - 0.19, 0.29, cz + 0.12], scale: [0.23, 0.055, 0.23], color: teamColor });
          s.cityWindow.push({ pos: [cx + 0.10, 0.40, cz + 0.16], scale: [0.28, 0.065, 0.25], color: teamColor });
        } else {
          s.cityBase.push({ pos: [cx, 0.05, cz], scale: [0.6, 0.1, 0.6] });
          s.cityTower.push({ pos: [cx, 0.4, cz], scale: [0.34, 0.6, 0.34] });
          s.cityWindow.push({ pos: [cx, 0.46, cz], scale: [0.36, 0.07, 0.36], color: teamColor });
        }
      } else if (tile.terrain === 'mountain' && natureProps) {
        // A low cluster of rocks, not a tile-filling monolith — units (0.7
        // tall) should still dominate the silhouette.
        // One clean raised block — simple SC1-style high ground.
        s.mountainBase.push({ pos: [cx - 0.12, 0.16, cz - 0.12], scale: [0.56, 0.32, 0.56] });
        s.mountainPeak.push({ pos: [cx - 0.12, 0.38, cz - 0.12], scale: [0.4, 0.12, 0.4] });
      } else if (tile.terrain === 'forest' && natureProps) {
        if (desert) {
          // Simple saguaro: trunk + two arms.
          s.forestTrunk.push({ pos: [cx - 0.18, 0.24, cz - 0.16], scale: [0.13, 0.48, 0.13] });
          s.forestTrunk.push({ pos: [cx - 0.32, 0.3, cz - 0.16], scale: [0.08, 0.18, 0.08] });
          s.forestTrunk.push({ pos: [cx - 0.04, 0.26, cz - 0.16], scale: [0.08, 0.14, 0.08] });
        } else {
          // One simple tree: trunk + canopy cube.
          s.forestTrunk.push({ pos: [cx - 0.16, 0.1, cz - 0.14], scale: [0.07, 0.2, 0.07] });
          s.forestCanopy.push({
            pos: [cx - 0.16, 0.34, cz - 0.14],
            scale: [0.28, 0.26, 0.28],
            rotY: jitter,
          });
        }
      }
      // water/lava render as holes in the platform (see Floor holes) — no props.

      if (tile.isRuin) {
        s.ruinPillar.push({ pos: [cx + 0.18, 0.18, cz - 0.15], scale: [0.18, 0.36, 0.18], rotY: jitter });
        s.ruinPillar.push({ pos: [cx - 0.2, 0.09, cz + 0.18], scale: [0.16, 0.18, 0.16], rotY: -jitter });
      }
      // Resources as ground deposits, not beacons: a low shard cluster in the
      // tile corner + a faint glow patch. Sub-bloom emissive — they should
      // read on inspection, not from across the board.
      if (tile.resourceKind === 'ore' || tile.resourceKind === 'plasma') {
        const shards = tile.resourceKind === 'ore' ? s.oreCrystal : s.plasmaCrystal;
        const patch = tile.resourceKind === 'ore' ? s.orePatch : s.plasmaPatch;
        const ox = cx - 0.24, oz = cz - 0.24;
        shards.push({ pos: [ox, 0.07, oz], scale: [0.09, 0.15, 0.09], rotY: 0.6 + jitter });
        shards.push({ pos: [ox + 0.13, 0.05, oz - 0.05], scale: [0.06, 0.1, 0.06], rotY: 1.4 - jitter });
        shards.push({ pos: [ox - 0.06, 0.035, oz + 0.12], scale: [0.05, 0.07, 0.05], rotY: jitter * 2 });
        patch.push({ pos: [ox + 0.02, 0.006, oz + 0.02], scale: [0.42, 0.008, 0.42], rotY: jitter });
      }
    }
  }
  return s;
}

export function TerrainBlocks({ map, visibility, theme = 'city', natureProps = true }: {
  map: MapData;
  visibility?: TileVisibility[][];
  theme?: ArenaTheme;
  /** False in GEN 8 tileset mode: the GLB tiles carry mountains/forests, so
   *  only cities / ruins / resource deposits are placed as props. */
  natureProps?: boolean;
}) {
  const desert = theme === 'desert';
  const breach = theme === 'breach';
  const sets = React.useMemo(
    () => buildTerrain(map, visibility, desert, breach, natureProps),
    [map, visibility, desert, breach, natureProps],
  );
  return (
    <>
      {/* Desert: sandstone mesas + saguaro cacti; city: rock + forest. */}
      <Blocks instances={sets.mountainBase} color={desert ? '#6b4a33' : '#454f6b'} />
      <Blocks instances={sets.mountainPeak} color={desert ? '#7d5940' : '#57627e'} />
      <Blocks instances={sets.forestTrunk} color={desert ? '#3f7a4a' : '#33293f'} />
      <Blocks instances={sets.forestCanopy} color={desert ? '#2f5c3a' : '#2a6b4f'} />
      {/* Shards: dim self-lit mineral, well under the bloom threshold. */}
      <Blocks instances={sets.oreCrystal} color="#3a2c18" emissive="#c8842e" emissiveIntensity={0.55} />
      <Blocks instances={sets.plasmaCrystal} color="#123338" emissive="#2ab8c8" emissiveIntensity={0.55} />
      <Blocks instances={sets.orePatch} color="#000000" emissive="#c8842e" emissiveIntensity={0.4} opacity={0.3} castShadow={false} />
      <Blocks instances={sets.plasmaPatch} color="#000000" emissive="#2ab8c8" emissiveIntensity={0.4} opacity={0.3} castShadow={false} />
      <Blocks instances={sets.ruinPillar} color={breach ? '#6d4b36' : '#565e75'} />
      <Blocks instances={sets.cityBase} color={breach ? '#34342f' : '#262c3d'} />
      <Blocks instances={sets.cityTower} color={breach ? '#55564e' : '#39415a'} />
      {/* Window bands glow in the owner's team colour — emissive can't vary
          per instance, and cities are few, so these are plain meshes. */}
      {sets.cityWindow.map((b, i) => (
        <mesh key={i} position={b.pos} scale={b.scale}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#000000" emissive={b.color} emissiveIntensity={3} />
        </mesh>
      ))}
    </>
  );
}
