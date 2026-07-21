import * as THREE from 'three';
import React from 'react';
import type { ArenaTheme } from './types.js';
import { AMBIENT_COLOR, KEY_LIGHT_COLOR, NEON_CYAN, NEON_PINK } from './palette.js';

interface BounceLight {
  /** Position: x/z as fractions of arena width/height, y in world units. */
  pos: [number, number, number];
  color: string;
  intensity: number;
  distance: number;
}

/**
 * Coloured "bounce fills": emissive signage can't light the world in a
 * rasterizer, so shadowless point lights fake the neon spill — local pools on
 * the floor near each signage cluster, colour-matched to the nearest sign.
 * Authored as data so they can become per-map later. Max 2 warm; the rest
 * magenta/cyan. Low tier renders only the first 3.
 */
const BOUNCE_LIGHTS: BounceLight[] = [
  { pos: [0.18, 0.8, 1.02], color: NEON_PINK, intensity: 14, distance: 6 },    // south hull signs
  { pos: [0.82, 0.8, 1.02], color: NEON_CYAN, intensity: 14, distance: 6 },
  { pos: [1.02, 0.8, 0.3], color: NEON_PINK, intensity: 12, distance: 6 },     // east hull signs
  { pos: [1.02, 0.8, 0.72], color: NEON_CYAN, intensity: 12, distance: 6 },
  { pos: [-0.05, 0.9, 0.35], color: '#ffb347', intensity: 11, distance: 5.5 }, // amber skyline board
];

/**
 * Lighting: 1 cool ambient + 1 shadowed key directional + ≤6 shadowless
 * bounce fills (the neon-spill pools). No per-strip lights.
 */
export function Lights({ width, height, theme = 'city', quality = 'high' }: {
  width: number;
  height: number;
  theme?: ArenaTheme;
  quality?: 'high' | 'low';
}) {
  const cx = width / 2;
  const cz = height / 2;
  const dirRef = React.useRef<THREE.DirectionalLight>(null);

  // Shadow frustum fitted tight to the arena bounds.
  const ext = Math.max(width, height) * 0.75 + 2;
  React.useLayoutEffect(() => {
    const light = dirRef.current;
    if (!light) return;
    light.target.position.set(cx, 0, cz);
    light.target.updateMatrixWorld();
    const cam = light.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 0.5;
    cam.far = 40;
    cam.updateProjectionMatrix();
  }, [cx, cz, ext]);

  const fills = quality === 'high' ? BOUNCE_LIGHTS : BOUNCE_LIGHTS.slice(0, 3);

  return (
    <>
      {/* Deliberately dark: unlit floor should approach black on screen. */}
      <ambientLight color={theme === 'desert' ? '#5a4460' : AMBIENT_COLOR} intensity={0.25} />
      <directionalLight
        ref={dirRef}
        color={theme === 'desert' ? '#ffd9b0' : KEY_LIGHT_COLOR}
        intensity={1.0}
        position={[cx - 6, 10, cz - 4]}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {fills.map((f, i) => (
        <pointLight
          key={i}
          color={f.color}
          intensity={f.intensity}
          distance={f.distance}
          decay={2}
          position={[f.pos[0] * width, f.pos[1], f.pos[2] * height]}
        />
      ))}
    </>
  );
}
