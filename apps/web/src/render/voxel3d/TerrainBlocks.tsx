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
  waterPane: BlockInstance[];
  lavaPane: BlockInstance[];
  oreCrystal: BlockInstance[];
  plasmaCrystal: BlockInstance[];
  ruinPillar: BlockInstance[];
  cityBase: BlockInstance[];
  cityTower: BlockInstance[];
  cityWindow: BlockInstance[];
}

function buildTerrain(map: MapData, visibility: TileVisibility[][] | undefined, desert: boolean): TerrainSets {
  const s: TerrainSets = {
    mountainBase: [], mountainPeak: [], forestCanopy: [], forestTrunk: [],
    waterPane: [], lavaPane: [], oreCrystal: [], plasmaCrystal: [],
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
        s.cityBase.push({ pos: [cx, 0.1, cz], scale: [0.9, 0.2, 0.9] });
        s.cityTower.push({ pos: [cx, 0.55, cz], scale: [0.45, 0.7, 0.45] });
        s.cityWindow.push({ pos: [cx, 0.62, cz], scale: [0.47, 0.08, 0.47], color: teamColor });
      } else if (tile.terrain === 'mountain') {
        // A low cluster of rocks, not a tile-filling monolith — units (0.7
        // tall) should still dominate the silhouette.
        s.mountainBase.push({ pos: [cx - 0.08, 0.16, cz + 0.06], scale: [0.55, 0.32, 0.55], rotY: jitter * 0.4 });
        s.mountainBase.push({ pos: [cx + 0.24, 0.1, cz - 0.2], scale: [0.32, 0.2, 0.32], rotY: -jitter * 0.6 });
        s.mountainPeak.push({
          pos: [cx - 0.05 + jitter * 0.08, 0.4, cz + 0.04],
          scale: [0.3, 0.18, 0.3],
          rotY: jitter * 0.5,
        });
      } else if (tile.terrain === 'forest') {
        if (desert) {
          // Oasis scrub: a slim saguaro (trunk + two arms) and a small bush.
          s.forestTrunk.push({ pos: [cx, 0.26, cz], scale: [0.14, 0.52, 0.14], rotY: jitter * 0.3 });
          s.forestTrunk.push({ pos: [cx - 0.17, 0.34, cz], scale: [0.08, 0.2, 0.08] });
          s.forestTrunk.push({ pos: [cx + 0.17, 0.28, cz], scale: [0.08, 0.16, 0.08] });
          s.forestTrunk.push({ pos: [cx - 0.13, 0.26, cz], scale: [0.1, 0.07, 0.07] });
          s.forestTrunk.push({ pos: [cx + 0.13, 0.22, cz], scale: [0.1, 0.07, 0.07] });
          s.forestCanopy.push({ pos: [cx + 0.26, 0.07, cz - 0.26], scale: [0.2, 0.14, 0.2], rotY: jitter });
        } else {
          // Two small trees + a bush per tile instead of one huge cube.
          s.forestTrunk.push({ pos: [cx - 0.18, 0.09, cz + 0.12], scale: [0.07, 0.18, 0.07] });
          s.forestCanopy.push({
            pos: [cx - 0.18, 0.3 + jitter * 0.04, cz + 0.12],
            scale: [0.3, 0.26, 0.3],
            rotY: jitter,
          });
          s.forestTrunk.push({ pos: [cx + 0.2, 0.07, cz - 0.16], scale: [0.06, 0.14, 0.06] });
          s.forestCanopy.push({
            pos: [cx + 0.2, 0.24, cz - 0.16],
            scale: [0.24, 0.2, 0.24],
            rotY: -jitter,
          });
          s.forestCanopy.push({ pos: [cx + 0.05, 0.07, cz + 0.3], scale: [0.14, 0.12, 0.14], rotY: jitter * 2 });
        }
      } else if (tile.terrain === 'water' || tile.terrain === 'river') {
        s.waterPane.push({ pos: [cx, 0.02, cz], scale: [0.92, 0.03, 0.92] });
      } else if (tile.terrain === 'lava') {
        s.lavaPane.push({ pos: [cx, 0.02, cz], scale: [0.92, 0.03, 0.92] });
      }

      if (tile.isRuin) {
        s.ruinPillar.push({ pos: [cx + 0.18, 0.18, cz - 0.15], scale: [0.18, 0.36, 0.18], rotY: jitter });
        s.ruinPillar.push({ pos: [cx - 0.2, 0.09, cz + 0.18], scale: [0.16, 0.18, 0.16], rotY: -jitter });
      }
      if (tile.resourceKind === 'ore') {
        s.oreCrystal.push({ pos: [cx - 0.2, 0.14, cz - 0.2], scale: [0.16, 0.28, 0.16], rotY: 0.6 + jitter });
      } else if (tile.resourceKind === 'plasma') {
        s.plasmaCrystal.push({ pos: [cx - 0.2, 0.14, cz - 0.2], scale: [0.16, 0.28, 0.16], rotY: 0.6 + jitter });
      }
    }
  }
  return s;
}

export function TerrainBlocks({ map, visibility, theme = 'city' }: {
  map: MapData;
  visibility?: TileVisibility[][];
  theme?: ArenaTheme;
}) {
  const desert = theme === 'desert';
  const sets = React.useMemo(
    () => buildTerrain(map, visibility, desert),
    [map, visibility, desert],
  );
  return (
    <>
      {/* Desert: sandstone mesas + saguaro cacti; city: rock + forest. */}
      <Blocks instances={sets.mountainBase} color={desert ? '#6b4a33' : '#454f6b'} />
      <Blocks instances={sets.mountainPeak} color={desert ? '#7d5940' : '#57627e'} />
      <Blocks instances={sets.forestTrunk} color={desert ? '#3f7a4a' : '#33293f'} />
      <Blocks instances={sets.forestCanopy} color={desert ? '#2f5c3a' : '#2a6b4f'} />
      <Blocks instances={sets.waterPane} color="#1e3a5f" opacity={0.65} castShadow={false} />
      <Blocks instances={sets.lavaPane} color="#2a0d05" emissive="#ff5a1f" emissiveIntensity={1.4} castShadow={false} />
      <Blocks instances={sets.oreCrystal} color="#000000" emissive="#ffb84d" emissiveIntensity={3} />
      <Blocks instances={sets.plasmaCrystal} color="#000000" emissive="#33f0ff" emissiveIntensity={3} />
      <Blocks instances={sets.ruinPillar} color="#565e75" />
      <Blocks instances={sets.cityBase} color="#262c3d" />
      <Blocks instances={sets.cityTower} color="#39415a" />
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
