import * as THREE from 'three';
import React from 'react';
import type { ArenaTheme } from './types.js';
import { AMBIENT_COLOR, KEY_LIGHT_COLOR } from './palette.js';

/** Lighting, kept simple: 1 cool ambient + 1 shadowed key directional. */
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
