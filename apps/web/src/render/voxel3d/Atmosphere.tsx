import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import { Clouds, Cloud } from '@react-three/drei';
import type { TileVisibility } from '@tactica/engine';
import type { ArenaTheme, MapData } from './types.js';
import { LAYER_NO_REFLECT } from './layers.js';

/** Deterministic PRNG so the starfield layout is stable across reloads. */
function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface StarLayer {
  count: number;
  /** Fraction of camera pan this layer follows — higher reads as farther. */
  k: number;
  size: number;
  color: string;
  opacity: number;
}

/**
 * Parallax starfield — the platform floats in open space (the SC1 space
 *-platform framing). An orthographic camera has no translation parallax, so
 * each layer follows a fraction of the camera pan. Fixed-pixel star sprites;
 * spread sized to the zoomed frustum so stars are always on screen.
 */
export function SpaceStars({ width, height, quality }: {
  width: number;
  height: number;
  quality: 'high' | 'low';
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  const anchorRef = React.useRef<THREE.Vector3 | null>(null);
  const scale = quality === 'high' ? 1 : 0.5;

  const layers = React.useMemo<StarLayer[]>(() => [
    { count: Math.round(1100 * scale), k: 0.92, size: 3, color: '#c9d2ff', opacity: 0.85 },
    { count: Math.round(550 * scale), k: 0.78, size: 4.2, color: '#ffffff', opacity: 0.95 },
    { count: Math.round(260 * scale), k: 0.6, size: 5.5, color: '#ffd9c0', opacity: 0.9 },
  ], [scale]);

  const geometries = React.useMemo(() => {
    const cx = width / 2;
    const cz = height / 2;
    return layers.map((layer, li) => {
      const rnd = mulberry(0xbeef + li * 7919);
      const positions = new Float32Array(layer.count * 3);
      const spread = Math.max(width, height) * 4;
      for (let i = 0; i < layer.count; i++) {
        let x = 0, y = 0, z = 0;
        do {
          x = (rnd() - 0.5) * spread * 2;
          y = (rnd() - 0.5) * spread * 1.6;
          z = (rnd() - 0.5) * spread * 2;
        } while (Math.hypot(x, y, z) < Math.max(width, height) * 1.4);
        positions[i * 3] = cx + x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = cz + z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      return geo;
    });
  }, [layers, width, height]);
  React.useEffect(() => () => geometries.forEach(g => g.dispose()), [geometries]);

  React.useMemo(() => { anchorRef.current = null; }, [width, height]);

  React.useLayoutEffect(() => {
    groupRef.current?.traverse(o => o.layers.set(LAYER_NO_REFLECT));
  }, [geometries]);

  const off = React.useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const g = groupRef.current;
    if (!g) return;
    if (!anchorRef.current) anchorRef.current = camera.position.clone();
    off.copy(camera.position).sub(anchorRef.current);
    g.children.forEach((child, i) => {
      child.position.copy(off).multiplyScalar(layers[i]?.k ?? 0.8);
    });
  });

  return (
    <group ref={groupRef}>
      {layers.map((layer, i) => (
        <points key={i} geometry={geometries[i]} frustumCulled={false}>
          <pointsMaterial
            color={layer.color}
            size={layer.size}
            sizeAttenuation={false}
            transparent
            opacity={layer.opacity}
            depthWrite={false}
            fog={false}
          />
        </points>
      ))}
    </group>
  );
}

/**
 * Fog of war as cloud puffs (drei Clouds, sprite vendored at
 * public/voxel3d/cloud.png). Terrain/props are never placed under hidden
 * tiles, so nothing can leak; rendered on every quality tier.
 */
export function FogClouds({ map, visibility, theme = 'city' }: {
  map: MapData;
  visibility?: TileVisibility[][];
  theme?: ArenaTheme;
}) {
  const groupRef = React.useRef<THREE.Group>(null);

  const tiles = React.useMemo(() => {
    if (!visibility) return [];
    const out: { x: number; y: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (visibility[y]?.[x] === 'hidden') out.push({ x, y });
      }
    }
    return out;
  }, [map, visibility]);

  // drei Clouds mounts its mesh only after the sprite texture resolves — a
  // one-shot mount effect misses it and the clouds leak into the floor
  // reflection. Re-assert the layer every frame (tiny traverse).
  useFrame(() => {
    groupRef.current?.traverse(o => {
      if (o.layers.mask !== 1 << LAYER_NO_REFLECT) o.layers.set(LAYER_NO_REFLECT);
    });
  });

  if (tiles.length === 0) return null;
  return (
    <group ref={groupRef}>
      <Clouds
        material={THREE.MeshBasicMaterial}
        texture="/voxel3d/cloud.png"
        limit={map.width * map.height * 4}
        frustumCulled={false}
      >
        {tiles.map(t => (
          <Cloud
            key={`${t.x},${t.y}`}
            seed={t.x * 31 + t.y}
            segments={4}
            bounds={[0.46, 0.16, 0.46]}
            volume={0.8}
            growth={0}
            speed={0}
            opacity={0.72}
            fade={0}
            color={theme === 'desert' ? '#8a7458' : '#525d80'}
            position={[t.x + 0.5, 0.28, t.y + 0.5]}
          />
        ))}
      </Clouds>
    </group>
  );
}

/** Dev-only frame-time logger for the quality-tier comparison. */
export function FrameStats({ quality }: { quality: 'high' | 'low' }) {
  const acc = React.useRef({ time: 0, frames: 0 });
  useFrame((_, dt) => {
    if (!import.meta.env.DEV) return;
    const a = acc.current;
    a.time += dt;
    a.frames += 1;
    if (a.frames >= 240) {
      console.info(
        `[voxel3d] quality=${quality} avg frame ${(a.time / a.frames * 1000).toFixed(2)}ms ` +
        `(${(a.frames / a.time).toFixed(0)}fps)`,
      );
      a.time = 0;
      a.frames = 0;
    }
  });
  return null;
}
