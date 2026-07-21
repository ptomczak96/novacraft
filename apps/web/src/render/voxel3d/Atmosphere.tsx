import * as THREE from 'three';
import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Clouds, Cloud, Sparkles } from '@react-three/drei';
import type { TileVisibility } from '@tactica/engine';
import type { ArenaTheme, MapData } from './types.js';
import { LAYER_NO_REFLECT } from './layers.js';
import { makeCityWindowTexture } from './proceduralTextures.js';

/** Deterministic per-index hash so the skyline/rain layout is stable. */
function hash(i: number): number {
  let x = (i + 1) * 2654435761;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) >>> 0;
  return x / 4294967296;
}

/**
 * Background skyline. City theme: 3D voxel towers with lit-window faces, dark
 * roofs, rooftop antennas. Desert theme: dark tiered rock buttes on the
 * horizon plus a couple of distant radio masts — no windows, no signage; a
 * floating arena over open wasteland instead of a metropolis. Both excluded
 * from the floor reflection and softened by scene fog.
 */
export function CityBlocks({ width, height, theme = 'city' }: {
  width: number;
  height: number;
  theme?: ArenaTheme;
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  const desert = theme === 'desert';

  const towers = React.useMemo(() => {
    const cx = width / 2;
    const cz = height / 2;
    const view = new THREE.Vector3(-1, -0.82, -1).normalize();
    const perp = new THREE.Vector3(1, 0, -1).normalize();
    const list: { pos: THREE.Vector3; w: number; h: number; d: number; seed: number }[] = [];
    // Dense skyline — the reference has no empty sky. Three rings of towers:
    // flanking near ones rising past the arena, a mid ring, and a far wall.
    const count = desert ? 14 : 26;
    for (let i = 0; i < count; i++) {
      const ring = i % 3;
      const depth = ring === 0 ? 26 + hash(i * 3) * 14
        : ring === 1 ? 42 + hash(i * 3) * 22
        : 62 + hash(i * 3) * 30;
      const side = (hash(i * 3 + 1) - 0.5) * (Math.max(width, height) * 2.0 + depth * 1.5);
      // Desert buttes: broad and low. City towers: narrow and tall.
      const w = desert ? 8 + hash(i * 5) * 12 : 4.5 + hash(i * 5) * 6;
      const d = desert ? 8 + hash(i * 5 + 2) * 12 : 4.5 + hash(i * 5 + 2) * 6;
      const h = desert ? 7 + hash(i * 5 + 1) * 12 : 18 + hash(i * 5 + 1) * 26;
      // Near flankers rise past the arena; farther rings fill the horizon.
      const top = desert
        ? (ring === 0 ? 2 + hash(i * 7) * 6 : -1 + hash(i * 7) * 7)
        : ring === 0
          ? 6 + hash(i * 7) * 14
          : ring === 1 ? 2 + hash(i * 7) * 12 : 4 + hash(i * 7) * 16;
      const pos = new THREE.Vector3(cx, 0, cz)
        .addScaledVector(view, depth)
        .addScaledVector(perp, side);
      pos.y = top - h / 2;
      list.push({ pos, w, h, d, seed: 1000 + i * 97 });
    }
    return list;
  }, [width, height, desert]);

  const materials = React.useMemo(
    () => towers.map((t, i) => {
      if (desert) {
        // Buttes: bare rock, slightly lighter caprock on top.
        const rock = new THREE.MeshBasicMaterial({ color: '#332420', fog: true });
        const cap = new THREE.MeshBasicMaterial({ color: '#41302a', fog: true });
        return [rock, rock, cap, rock, rock, rock];
      }
      const tex = makeCityWindowTexture(256, 512, t.seed);
      // Slight violet cast on the tower faces ties them into the haze.
      const windows = new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(1.05, 0.95, 1.2),
        fog: true,
      });
      const dark = new THREE.MeshBasicMaterial({ color: '#12101f', fog: true });
      // BoxGeometry face order: +x, -x, +y (roof), -y, +z, -z
      return [windows, windows, dark, dark, windows, windows];
    }),
    [towers, desert],
  );
  React.useEffect(() => () => {
    materials.forEach(m => {
      m[0].map?.dispose();
      m[0].dispose();
      m[2].dispose();
    });
  }, [materials]);

  React.useLayoutEffect(() => {
    groupRef.current?.traverse(o => o.layers.set(LAYER_NO_REFLECT));
  }, [towers]);

  return (
    <group ref={groupRef}>
      {towers.map((t, i) => {
        const top = t.pos.y + t.h / 2;
        // City: rooftop antennas on ~45% of towers. Desert: two lone radio
        // masts on far buttes — the only man-made lights on the horizon.
        const hasAntenna = desert ? i === 4 || i === 9 : hash(i * 19) < 0.45;
        const mastH = desert ? 6 : 2.2;
        return (
          <group key={i}>
            <mesh position={t.pos} material={materials[i]}>
              <boxGeometry args={[t.w, t.h, t.d]} />
            </mesh>
            {hasAntenna && (
              <group position={[t.pos.x + (hash(i * 23) - 0.5) * t.w * 0.5, 0, t.pos.z]}>
                <mesh position={[0, top + mastH / 2, 0]}>
                  <boxGeometry args={[0.16, mastH, 0.16]} />
                  <meshBasicMaterial color="#0c0e18" fog />
                </mesh>
                <mesh position={[0, top + mastH + 0.1, 0]}>
                  <boxGeometry args={[0.22, 0.22, 0.22]} />
                  <meshStandardMaterial color="#000000" emissive="#ff3b30" emissiveIntensity={4} />
                </mesh>
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}

const RAIN_COUNT = 300;

/**
 * Rain: one InstancedMesh of short vertical streaks, additive, scrolling down
 * and respawning at the top. Excluded from reflection and shadows.
 */
export function Rain({ width, height }: { width: number; height: number }) {
  const meshRef = React.useRef<THREE.InstancedMesh>(null);

  const drops = React.useMemo(() => {
    const spanX = width + 16;
    const spanZ = height + 16;
    return Array.from({ length: RAIN_COUNT }, (_, i) => ({
      x: -8 + hash(i * 4) * spanX,
      z: -8 + hash(i * 4 + 1) * spanZ,
      y: hash(i * 4 + 2) * 16,
      speed: 9 + hash(i * 4 + 3) * 6,
    }));
  }, [width, height]);

  React.useLayoutEffect(() => {
    meshRef.current?.layers.set(LAYER_NO_REFLECT);
  }, []);

  const m = React.useMemo(() => new THREE.Matrix4(), []);
  useFrame((_, rawDt) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dt = Math.min(rawDt, 0.1); // tab-refocus guard
    for (let i = 0; i < RAIN_COUNT; i++) {
      const d = drops[i];
      d.y -= d.speed * dt;
      if (d.y < -3) d.y += 19;
      mesh.setMatrixAt(i, m.identity().setPosition(d.x, d.y, d.z));
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, RAIN_COUNT]} frustumCulled={false}>
      <boxGeometry args={[0.014, 0.7, 0.014]} />
      <meshBasicMaterial
        color="#9fc0ff"
        transparent
        opacity={0.18}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

/**
 * Fog of war as real cloud puffs (drei Clouds — one batched instanced draw,
 * cloud sprite vendored at public/voxel3d/cloud.png so builds stay offline).
 * Terrain/props are never placed under hidden tiles, so nothing can leak;
 * these clouds are the visual layer on top. Rendered on every quality tier —
 * fog is gameplay information, not decoration.
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
  // reflection (dark cloud silhouettes stamped on the mirror). Re-assert the
  // layer every frame; the traverse is a few dozen nodes, negligible.
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
            growth={0.12}
            speed={0.06}
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

/**
 * Violet haze: three huge soft radial-gradient billboards layered between the
 * tower rings — the glowing atmosphere that fills the reference's sky.
 * Additive, no depth write, excluded from reflection.
 */
export function HazeLayers({ width, height, theme = 'city' }: {
  width: number;
  height: number;
  theme?: ArenaTheme;
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  const camera = useThree(s => s.camera);

  const tex = React.useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
    if (theme === 'desert') {
      // Dusty sunset haze.
      g.addColorStop(0, 'rgba(235,140,90,0.4)');
      g.addColorStop(0.5, 'rgba(190,90,120,0.26)');
      g.addColorStop(1, 'rgba(90,40,90,0)');
    } else {
      g.addColorStop(0, 'rgba(150,100,235,0.4)');
      g.addColorStop(0.5, 'rgba(120,70,200,0.28)');
      g.addColorStop(1, 'rgba(60,30,120,0)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [theme]);
  React.useEffect(() => () => tex.dispose(), [tex]);

  const layers = React.useMemo(() => {
    const cx = width / 2;
    const cz = height / 2;
    const view = new THREE.Vector3(-1, -0.82, -1).normalize();
    const perp = new THREE.Vector3(1, 0, -1).normalize();
    return [
      { depth: 36, side: -14, y: 4, s: 55 },
      { depth: 55, side: 16, y: 8, s: 75 },
      { depth: 78, side: 0, y: 6, s: 110 },
    ].map(l => ({
      pos: new THREE.Vector3(cx, l.y, cz)
        .addScaledVector(view, l.depth)
        .addScaledVector(perp, l.side),
      s: l.s,
    }));
  }, [width, height]);

  React.useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.traverse(o => o.layers.set(LAYER_NO_REFLECT));
    g.children.forEach(child => child.lookAt(camera.position));
  }, [camera, layers]);

  return (
    <group ref={groupRef}>
      {layers.map((l, i) => (
        <mesh key={i} position={l.pos}>
          <planeGeometry args={[l.s, l.s * 0.7]} />
          <meshBasicMaterial
            map={tex}
            transparent
            opacity={0.2}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Defocused city-light bokeh dots drifting in the tower field. */
export function Bokeh({ width, height }: { width: number; height: number }) {
  const groupRef = React.useRef<THREE.Group>(null);
  React.useLayoutEffect(() => {
    groupRef.current?.traverse(o => o.layers.set(LAYER_NO_REFLECT));
  }, []);
  const cx = width / 2;
  const cz = height / 2;
  return (
    <group ref={groupRef}>
      <Sparkles
        count={40} speed={0.06} opacity={0.55} size={7} color="#ffca8a" noise={0.2}
        scale={[width * 4, 26, height * 4]} position={[cx - 18, 6, cz - 18]}
      />
      <Sparkles
        count={40} speed={0.06} opacity={0.5} size={6} color="#8fb4ff" noise={0.2}
        scale={[width * 4, 26, height * 4]} position={[cx - 24, 10, cz - 24]}
      />
    </group>
  );
}

/** Ambient floating dust motes over the arena (drei Sparkles, one draw call). */
export function DustMotes({ width, height, theme = 'city' }: {
  width: number;
  height: number;
  theme?: ArenaTheme;
}) {
  const ref = React.useRef<THREE.Points>(null);
  React.useLayoutEffect(() => {
    ref.current?.layers.set(LAYER_NO_REFLECT);
  }, []);
  return (
    <Sparkles
      ref={ref}
      count={theme === 'desert' ? 140 : 90}
      speed={0.25}
      opacity={0.4}
      size={1.6}
      color={theme === 'desert' ? '#ffd9a0' : '#9fd8ff'}
      noise={0.6}
      scale={[width, 2.2, height]}
      position={[width / 2, 1.2, height / 2]}
    />
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
