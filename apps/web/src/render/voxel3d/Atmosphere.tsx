import * as THREE from 'three';
import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
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
 * Background city: 7 flat billboard planes at varying depths behind/below the
 * arena, textured with procedural emissive window grids. Excluded from the
 * floor reflection and from shadows; softened by the scene fog.
 */
export function CityCards({ width, height }: { width: number; height: number }) {
  const camera = useThree(s => s.camera);
  const groupRef = React.useRef<THREE.Group>(null);

  const cards = React.useMemo(() => {
    const cx = width / 2;
    const cz = height / 2;
    // View direction of the fixed dimetric camera; cards sit beyond the arena
    // along it (and below), like towers under a floating platform.
    const view = new THREE.Vector3(-1, -0.82, -1).normalize();
    const perp = new THREE.Vector3(1, 0, -1).normalize();
    return Array.from({ length: 7 }, (_, i) => {
      const depth = 34 + hash(i * 3) * 40;
      const side = (hash(i * 3 + 1) - 0.5) * (Math.max(width, height) * 1.6 + depth);
      const pos = new THREE.Vector3(cx, 0, cz)
        .addScaledVector(view, depth)
        .addScaledVector(perp, side);
      pos.y += (hash(i * 3 + 2) - 0.85) * 14;
      const w = 6 + hash(i * 5) * 7;
      const h = 15 + hash(i * 5 + 1) * 14;
      return { pos, w, h, seed: 1000 + i * 97 };
    });
  }, [width, height]);

  const textures = React.useMemo(
    () => cards.map(c => makeCityWindowTexture(256, 512, c.seed)),
    [cards],
  );
  React.useEffect(() => () => textures.forEach(t => t.dispose()), [textures]);

  React.useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.traverse(o => o.layers.set(LAYER_NO_REFLECT));
    // Static billboards: face the (fixed) game camera once.
    g.children.forEach(child => child.lookAt(camera.position));
  }, [camera, cards]);

  return (
    <group ref={groupRef}>
      {cards.map((c, i) => (
        <mesh key={i} position={c.pos}>
          <planeGeometry args={[c.w, c.h]} />
          {/* color > 1 pushes lit windows past the bloom threshold (≈ emissiveIntensity 1.5). */}
          <meshBasicMaterial map={textures[i]} color={new THREE.Color(1.2, 1.2, 1.2)} fog transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

const RAIN_COUNT = 1500;

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
      <boxGeometry args={[0.012, 0.42, 0.012]} />
      <meshBasicMaterial
        color="#9fc0ff"
        transparent
        opacity={0.12}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
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
