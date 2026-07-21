import * as THREE from 'three';
import React from 'react';
import { makeNeonSignTexture, type SignPalette } from './proceduralTextures.js';
import { LAYER_NO_REFLECT } from './layers.js';

const PALETTES: SignPalette[] = ['pink', 'cyan', 'orange', 'purple', 'pink', 'cyan'];

interface SignDef {
  pos: [number, number, number];
  rotY: number;
  w: number;
  h: number;
  seed: number;
  palette: SignPalette;
}

/**
 * Neon signage: vertical framed signs with glyph-like strokes, mounted on the
 * two camera-facing hull sides plus a few large ones floating in the skyline.
 * Emissive-only (colour pushed past 1 → they bloom); no lights.
 */
export function Signage({ width, height }: { width: number; height: number }) {
  const groupRef = React.useRef<THREE.Group>(null);

  const signs = React.useMemo<SignDef[]>(() => {
    const list: SignDef[] = [];
    // Hull-mounted: south face (+z) and east face (+x).
    const hullY = -0.95;
    [0.18, 0.5, 0.82].forEach((f, i) => {
      list.push({
        pos: [f * width, hullY, height + 1.03], rotY: 0,
        w: 0.55, h: 1.5, seed: 300 + i * 17, palette: PALETTES[i],
      });
    });
    [0.25, 0.62, 0.9].forEach((f, i) => {
      list.push({
        pos: [width + 1.03, hullY, f * height], rotY: Math.PI / 2,
        w: 0.55, h: 1.5, seed: 400 + i * 23, palette: PALETTES[i + 3],
      });
    });
    // Skyline: large floating signs among the towers (reference: signage
    // everywhere at multiple depths).
    list.push({ pos: [-4, 3.5, height * 0.35], rotY: Math.PI / 4, w: 1.6, h: 4.4, seed: 501, palette: 'purple' });
    list.push({ pos: [width * 0.3, 5, -4.5], rotY: Math.PI / 4, w: 1.6, h: 4.2, seed: 502, palette: 'pink' });
    list.push({ pos: [width + 5, 1.5, height * 0.75], rotY: Math.PI / 3, w: 1.4, h: 3.8, seed: 503, palette: 'cyan' });
    list.push({ pos: [width * 0.8, 4.2, height + 5.5], rotY: Math.PI / 6, w: 1.5, h: 4.0, seed: 504, palette: 'orange' });
    list.push({ pos: [-8, 7, height * 0.7], rotY: Math.PI / 4, w: 2.2, h: 6, seed: 505, palette: 'cyan' });
    list.push({ pos: [width * 0.6, 8.5, -8.5], rotY: Math.PI / 4, w: 2.0, h: 5.5, seed: 506, palette: 'orange' });
    list.push({ pos: [width + 9, 5, height * 0.25], rotY: Math.PI / 3, w: 1.8, h: 5, seed: 507, palette: 'pink' });
    list.push({ pos: [width * 0.1, 6, height + 9], rotY: Math.PI / 6, w: 1.8, h: 5, seed: 508, palette: 'purple' });
    return list;
  }, [width, height]);

  const textures = React.useMemo(
    () => signs.map(s => makeNeonSignTexture(s.seed, s.palette)),
    [signs],
  );
  React.useEffect(() => () => textures.forEach(t => t.dispose()), [textures]);

  React.useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    // Skyline signs shouldn't show in the floor reflection; hull signs sit
    // below the reflector plane anyway, so exclude the whole group.
    g.traverse(o => o.layers.set(LAYER_NO_REFLECT));
  }, [signs]);

  return (
    <group ref={groupRef}>
      {signs.map((s, i) => (
        <mesh key={i} position={s.pos} rotation-y={s.rotY}>
          <planeGeometry args={[s.w, s.h]} />
          {/* colour > 1 lifts the neon strokes past the bloom threshold */}
          <meshBasicMaterial
            map={textures[i]}
            color={new THREE.Color(2.2, 2.2, 2.2)}
            side={THREE.DoubleSide}
            fog
          />
        </mesh>
      ))}
    </group>
  );
}
