import * as THREE from 'three';
import React from 'react';
import type { ArenaTheme } from './types.js';
import { AMBIENT_COLOR, KEY_LIGHT_COLOR } from './palette.js';

/** Lighting, kept simple: 1 cool ambient + 1 shadowed key directional.
 *  Tileset mode swaps in a golden-hour SUN: warm high-intensity key with
 *  crisp long shadows + sky/ground hemisphere fill, so the hand-painted
 *  tile textures read in full colour instead of the night-arena grade. */
export function Lights({ width, height, theme = 'city', quality = 'high', tileset = false }: {
  width: number;
  height: number;
  theme?: ArenaTheme;
  quality?: 'high' | 'low';
  tileset?: boolean;
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

  if (tileset) {
    return (
      <>
        {/* Sky-blue bounce from above, warm earth bounce from below. */}
        <hemisphereLight args={['#b8d4ff', '#8a6f4d', 0.55]} />
        <ambientLight color="#fff2df" intensity={0.22} />
        {/* Low warm sun raking across the board — long readable shadows. */}
        <directionalLight
          ref={dirRef}
          color="#ffdfae"
          intensity={3.4}
          position={[cx - 9, 8.5, cz - 3.5]}
          castShadow
          shadow-mapSize={quality === 'high' ? [2048, 2048] : [1024, 1024]}
          shadow-bias={-0.0003}
          shadow-normalBias={0.03}
        />
        {/* Faint cool rim from the opposite side so shadow sides stay legible. */}
        <directionalLight color="#7fa8ff" intensity={0.35} position={[cx + 8, 6, cz + 6]} />
      </>
    );
  }

  return (
    <>
      {/* Deliberately dark: unlit floor should approach black on screen. */}
      <ambientLight color={theme === 'desert' ? '#5a4460' : AMBIENT_COLOR} intensity={0.35} />
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
    </>
  );
}
