import * as THREE from 'three';
import React from 'react';
import type { TileHighlight } from './types.js';
import { HIGHLIGHT_COLORS } from './palette.js';

const MAX_HIGHLIGHTS = 512;

/**
 * Props-driven tile highlights: one InstancedMesh → one draw call regardless of
 * count. 0.96×0.96 quads at y=0.012 — above the reflector plane, so they appear
 * in the floor reflection automatically. Additive, no depth write. The shader
 * draws a ~0.10-alpha fill plus a brighter 0.05-wide border band per quad;
 * per-tile colour rides in instanceColor.
 */
export function Highlights({ highlights }: { highlights: TileHighlight[] }) {
  const meshRef = React.useRef<THREE.InstancedMesh>(null);

  const material = React.useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vUv = uv;
        vColor = instanceColor;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        float d = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0; // 0 centre → 1 edge
        // Border band: outer ~0.05 of the quad, softened on both sides.
        float border = smoothstep(0.86, 0.93, d) * (1.0 - smoothstep(0.985, 1.0, d));
        float fill = 0.10;
        gl_FragColor = vec4(vColor * (fill + border * 0.9), fill + border * 0.55);
      }
    `,
  }), []);
  React.useEffect(() => () => material.dispose(), [material]);

  // Pre-create instanceColor so the shader's instanceColor attribute always exists.
  React.useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (mesh && !mesh.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(MAX_HIGHLIGHTS * 3), 3);
    }
  }, []);

  // Prop changes only rewrite instance buffers — the scene never remounts.
  React.useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const c = new THREE.Color();
    const n = Math.min(highlights.length, MAX_HIGHLIGHTS);
    for (let i = 0; i < n; i++) {
      const h = highlights[i];
      m.copy(rot).setPosition(h.x + 0.5, 0.012, h.y + 0.5);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(HIGHLIGHT_COLORS[h.kind]));
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [highlights]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, MAX_HIGHLIGHTS]}
      material={material}
      frustumCulled={false}
    >
      <planeGeometry args={[0.96, 0.96]} />
    </instancedMesh>
  );
}
