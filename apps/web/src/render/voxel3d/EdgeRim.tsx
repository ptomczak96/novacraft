import * as THREE from 'three';
import React from 'react';
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
  strips: THREE.Matrix4[];
  greebles: { pos: [number, number, number]; scale: [number, number, number] }[];
  posts: [number, number, number][];
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

  // White-cyan light dashes ON the floor surface along the perimeter,
  // every other tile edge — emissive-only "emergency lighting".
  const strips: THREE.Matrix4[] = [];
  const addStrip = (x: number, z: number, rotY: number) => {
    strips.push(new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0.035, z));
  };
  for (let x = 0; x < width; x += 2) {
    addStrip(x + 0.5, 0.09, 0);
    addStrip(x + 0.5, height - 0.09, 0);
  }
  for (let z = 0; z < height; z += 2) {
    addStrip(0.09, z + 0.5, Math.PI / 2);
    addStrip(width - 0.09, z + 0.5, Math.PI / 2);
  }

  // Greebles: vents/boxes studded on the two camera-facing hull faces.
  const greebles: RimData['greebles'] = [];
  const faceX = width + 1.02;
  const faceZ = height + 1.02;
  for (let i = 0; i < 14; i++) {
    const w = 0.35 + hash(i * 3) * 0.6;
    const h = 0.14 + hash(i * 3 + 1) * 0.22;
    const y = -0.4 - hash(i * 3 + 2) * 0.85;
    if (i % 2 === 0) {
      greebles.push({ pos: [hash(i * 7) * (width - 1) + 0.5, y, faceZ], scale: [w, h, 0.1] });
    } else {
      greebles.push({ pos: [faceX, y, hash(i * 7) * (height - 1) + 0.5], scale: [0.1, h, w] });
    }
  }

  // Railing posts along the two far edges (screen-top in the dimetric view).
  const posts: RimData['posts'] = [];
  for (let x = 0.5; x < width; x += 1) posts.push([x, 0.2, 0.06]);
  for (let z = 0.5; z < height; z += 1) posts.push([0.06, 0.2, z]);
  return { lip, strips, greebles, posts };
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
 * Platform edge + hull: flush voxel lip, white-cyan light dashes on the floor
 * perimeter (emissive-only, no point lights), tiered hull below with corner
 * support pillars and greebled faces, and railings along the two far edges.
 */
export function EdgeRim({ width, height }: { width: number; height: number }) {
  const rim = React.useMemo(() => buildRim(width, height), [width, height]);
  const cx = width / 2;
  const cz = height / 2;

  const lipItems = React.useMemo(
    () => rim.lip.map(b => ({ m: new THREE.Matrix4().setPosition(...b.pos), tint: b.tint })),
    [rim],
  );
  const stripItems = React.useMemo(() => rim.strips.map(m => ({ m })), [rim]);
  const greebleItems = React.useMemo(
    () => rim.greebles.map(g => ({
      m: new THREE.Matrix4()
        .makeScale(g.scale[0] * 10, g.scale[1] * 10, g.scale[2] * 10)
        .setPosition(...g.pos),
    })),
    [rim],
  );
  const postItems = React.useMemo(
    () => rim.posts.map(p => ({ m: new THREE.Matrix4().setPosition(...p) })),
    [rim],
  );

  return (
    <>
      <InstancedSet items={lipItems} color={RIM_BLOCK} geo={[1, 0.9, 1]} castShadow />
      <InstancedSet
        items={stripItems}
        color="#000000"
        emissive="#d6fbff"
        emissiveIntensity={6}
        geo={[0.55, 0.03, 0.05]}
      />
      {/* greebles: base box 0.1³ scaled per instance */}
      <InstancedSet items={greebleItems} color="#232838" geo={[0.1, 0.1, 0.1]} />
      <InstancedSet items={postItems} color="#333b4e" geo={[0.045, 0.36, 0.045]} />
      {/* Railing bars along the far edges */}
      <mesh position={[cx, 0.37, 0.06]}>
        <boxGeometry args={[width, 0.035, 0.035]} />
        <meshStandardMaterial color="#3a4356" roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[0.06, 0.37, cz]}>
        <boxGeometry args={[0.035, 0.035, height]} />
        <meshStandardMaterial color="#3a4356" roughness={0.5} metalness={0.5} />
      </mesh>
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
