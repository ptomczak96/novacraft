import * as THREE from 'three';
import React from 'react';
import type { ArenaTheme } from './types.js';
import { RIM_BLOCK } from './palette.js';

/** Deterministic per-index hash for colour jitter / greeble layout. */
function hash(i: number): number {
  let x = (i + 1) * 2654435761;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) >>> 0;
  return x / 4294967296;
}

interface RimData {
  lip: { pos: [number, number, number]; tint: number }[];
}

function buildRim(width: number, height: number): RimData {
  // Low flush lip ring — the platform edge is nearly level with the floor
  // (reference look), with the mass in the hull below.
  const lip: RimData['lip'] = [];
  for (let x = -1; x <= width; x++) {
    for (let z = -1; z <= height; z++) {
      const onRim = x === -1 || x === width || z === -1 || z === height;
      if (!onRim) continue;
      lip.push({ pos: [x + 0.5, -0.38, z + 0.5], tint: 0.9 + hash(lip.length) * 0.25 });
    }
  }

  return { lip };
}

function InstancedSet({ items, color, emissive, emissiveIntensity = 0, geo, castShadow = false }: {
  items: { m: THREE.Matrix4; tint?: number }[];
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
  geo: [number, number, number];
  castShadow?: boolean;
}) {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = new THREE.Color();
    const base = new THREE.Color(color);
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      if (it.tint !== undefined) mesh.setColorAt(i, c.copy(base).multiplyScalar(it.tint));
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items, color]);
  if (items.length === 0) return null;
  const usesTint = items[0].tint !== undefined;
  return (
    <instancedMesh
      key={items.length}
      ref={ref}
      args={[undefined, undefined, items.length]}
      castShadow={castShadow}
      receiveShadow
      frustumCulled={false}
    >
      <boxGeometry args={geo} />
      <meshStandardMaterial
        color={usesTint ? '#ffffff' : color}
        flatShading
        roughness={0.85}
        metalness={0.15}
        emissive={emissive ?? '#000000'}
        emissiveIntensity={emissiveIntensity}
      />
    </instancedMesh>
  );
}

/**
 * Platform edge + hull, kept simple (SC1 space-platform style): flush voxel
 * lip and a clean tiered hull with corner support pillars below. No lights.
 */
export function EdgeRim({ width, height, theme = 'city' }: {
  width: number;
  height: number;
  theme?: ArenaTheme;
}) {
  const rim = React.useMemo(() => buildRim(width, height), [width, height]);
  const cx = width / 2;
  const cz = height / 2;

  const lipItems = React.useMemo(
    () => rim.lip.map(b => ({ m: new THREE.Matrix4().setPosition(...b.pos), tint: b.tint })),
    [rim],
  );

  return (
    <>
      <InstancedSet items={lipItems} color={RIM_BLOCK} geo={[1, 0.9, 1]} castShadow />
      {/* Hull: tiered underside + corner support pillars */}
      <mesh position={[cx, -0.78, cz]}>
        <boxGeometry args={[width + 2, 1.25, height + 2]} />
        <meshStandardMaterial color="#141824" flatShading roughness={0.9} metalness={0.1} />
      </mesh>
      <mesh position={[cx, -1.75, cz]}>
        <boxGeometry args={[width - 1, 1.0, height - 1]} />
        <meshStandardMaterial color="#10131c" flatShading roughness={0.9} metalness={0.1} />
      </mesh>
      {[[0.8, 0.8], [width - 0.8, 0.8], [0.8, height - 0.8], [width - 0.8, height - 0.8]].map(([px, pz], i) => (
        <mesh key={i} position={[px, -2.6, pz]}>
          <boxGeometry args={[0.7, 2.6, 0.7]} />
          <meshStandardMaterial color="#171b28" flatShading roughness={0.9} metalness={0.1} />
        </mesh>
      ))}
    </>
  );
}
