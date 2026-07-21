import * as THREE from 'three';
import React from 'react';
import { RIM_BLOCK, NEON_CYAN, NEON_PINK } from './palette.js';

/** Deterministic per-index hash for colour jitter / pink strip picks. */
function hash(i: number): number {
  let x = (i + 1) * 2654435761;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) >>> 0;
  return x / 4294967296;
}

interface RimData {
  blocks: { pos: [number, number, number]; tint: number }[];
  cyanStrips: THREE.Matrix4[];
  pinkStrips: THREE.Matrix4[];
}

function buildRim(width: number, height: number): RimData {
  const blocks: RimData['blocks'] = [];
  // 1-block-wide rim ring around the floor, sunk so its top sits at +0.3 —
  // the arena reads as a floating platform with a chunky hull edge.
  for (let x = -1; x <= width; x++) {
    for (let z = -1; z <= height; z++) {
      const onRim = x === -1 || x === width || z === -1 || z === height;
      if (!onRim) continue;
      const i = blocks.length;
      blocks.push({ pos: [x + 0.5, -0.2, z + 0.5], tint: 0.9 + hash(i) * 0.25 });
    }
  }
  // Corner risers: 2–3 blocks tall.
  const corners: [number, number][] = [
    [-0.5, -0.5], [width + 0.5, -0.5], [-0.5, height + 0.5], [width + 0.5, height + 0.5],
  ];
  corners.forEach(([px, pz], ci) => {
    const extra = ci === 1 ? 3 : 2;
    for (let k = 1; k <= extra; k++) {
      blocks.push({ pos: [px, -0.2 + k, pz], tint: 0.85 + hash(blocks.length) * 0.2 });
    }
  });

  // Neon strips along the outer rim, on every other tile edge. Mostly cyan,
  // a few pink. These are emissive-only "light sources" — no point lights.
  const cyanStrips: THREE.Matrix4[] = [];
  const pinkStrips: THREE.Matrix4[] = [];
  const stripY = 0.315; // resting on the rim top (0.3)
  const addStrip = (x: number, z: number, rotY: number, i: number) => {
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, stripY, z);
    (hash(i * 31 + 7) < 0.18 ? pinkStrips : cyanStrips).push(m);
  };
  let i = 0;
  for (let x = 0; x < width; x += 2) {
    addStrip(x + 0.5, -0.5, 0, i++);          // north rim
    addStrip(x + 0.5, height + 0.5, 0, i++);  // south rim
  }
  for (let z = 0; z < height; z += 2) {
    addStrip(-0.5, z + 0.5, Math.PI / 2, i++);          // west rim
    addStrip(width + 0.5, z + 0.5, Math.PI / 2, i++);   // east rim
  }
  return { blocks, cyanStrips, pinkStrips };
}

function StripMesh({ matrices, color }: { matrices: THREE.Matrix4[]; color: string }) {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);
  return (
    <instancedMesh
      key={matrices.length}
      ref={ref}
      args={[undefined, undefined, Math.max(1, matrices.length)]}
      frustumCulled={false}
    >
      <boxGeometry args={[0.9, 0.03, 0.06]} />
      <meshStandardMaterial color="#000000" emissive={color} emissiveIntensity={6} />
    </instancedMesh>
  );
}

/** Chunky voxel edge blocks + neon strips forming the arena perimeter. */
export function EdgeRim({ width, height }: { width: number; height: number }) {
  const rim = React.useMemo(() => buildRim(width, height), [width, height]);
  const blocksRef = React.useRef<THREE.InstancedMesh>(null);

  React.useLayoutEffect(() => {
    const mesh = blocksRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const base = new THREE.Color(RIM_BLOCK);
    rim.blocks.forEach((b, i) => {
      m.identity().setPosition(...b.pos);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.copy(base).multiplyScalar(b.tint));
    });
    mesh.count = rim.blocks.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [rim]);

  return (
    <>
      <instancedMesh
        key={rim.blocks.length}
        ref={blocksRef}
        args={[undefined, undefined, Math.max(1, rim.blocks.length)]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" flatShading roughness={0.85} metalness={0.15} />
      </instancedMesh>
      <StripMesh matrices={rim.cyanStrips} color={NEON_CYAN} />
      <StripMesh matrices={rim.pinkStrips} color={NEON_PINK} />
    </>
  );
}
