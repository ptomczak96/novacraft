import * as THREE from 'three';
import React from 'react';
import type { ArenaTheme } from './types.js';
import { AMBIENT_COLOR, KEY_LIGHT_COLOR, CORNER_LIGHT_COLOR } from './palette.js';

/**
 * Exactly three lights — the neon edge strips are emissive-only and get NO
 * point lights:
 *  1. violet ambient fill
 *  2. cool key directional from screen upper-left, casting the unit shadows
 *  3. one pink point light off-arena above a corner for a magenta wash
 */
export function Lights({ width, height, theme = 'city' }: {
  width: number;
  height: number;
  theme?: ArenaTheme;
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

  return (
    <>
      {/* Intensities sit above the spec'd legacy values (0.5 / 1.1) because
          three r155+ physically-based lighting + ACES render those too dark. */}
      {/* Desert: warm dusk key + orange corner glow; city: cool key + magenta. */}
      <ambientLight color={theme === 'desert' ? '#6d5270' : AMBIENT_COLOR} intensity={0.95} />
      <directionalLight
        ref={dirRef}
        color={theme === 'desert' ? '#ffd9b0' : KEY_LIGHT_COLOR}
        intensity={1.7}
        position={[cx - 6, 10, cz - 4]}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* Physically-based point intensity (three r155+): ≈ the classic 0.6 at
          the ~10-unit range that matters, with distance-30 cutoff. */}
      <pointLight
        color={theme === 'desert' ? '#ff8f3a' : CORNER_LIGHT_COLOR}
        intensity={60}
        distance={30}
        position={[-2, 6, -2]}
      />
    </>
  );
}
