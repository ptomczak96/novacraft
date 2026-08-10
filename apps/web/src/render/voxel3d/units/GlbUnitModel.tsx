import * as THREE from 'three';
import React from 'react';
import { useGLTF } from '@react-three/drei';
import { MAX_FOOTPRINT, unitModelForKind } from '../models/modelAssets.js';

/**
 * Generic GLB unit body for the GEN 8 — 3D Tileset mode. Loads the kind's
 * model (see models/modelAssets.ts), scales it to the kind's target height
 * (heights deliberately differ per unit class), clamps the footprint so the
 * unit always fits inside one tile, and rests it base-down centered on the
 * tile origin — the parent UnitMesh group already sits at the tile center.
 *
 * Original baked materials/textures are kept (shared across clones, never
 * mutated); ownership reads from a team-colored glow ring at the base.
 */

function normalize(scene: THREE.Group, targetHeight: number, opts?: { cloneMaterials?: boolean }) {
  const model = scene.clone(true);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  let s = targetHeight / (size.y || 1);
  const foot = Math.max(size.x, size.z) || 1;
  // Never wider than a tile, whatever the model's proportions.
  if (foot * s > MAX_FOOTPRINT) s = MAX_FOOTPRINT / foot;
  model.scale.setScalar(s);
  const sb = new THREE.Box3().setFromObject(model);
  model.position.set(
    -(sb.min.x + sb.max.x) / 2,
    -sb.min.y,
    -(sb.min.z + sb.max.z) / 2,
  );
  model.traverse(o => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      if (opts?.cloneMaterials) {
        o.material = (o.material as THREE.Material).clone();
        (o.material as THREE.Material).transparent = true;
      }
    }
  });
  return { model, height: sb.max.y - sb.min.y };
}

export function GlbUnitModel({ kind, teamColor }: { kind: string; teamColor: string }) {
  const def = unitModelForKind(kind);
  if (!def) throw new Error(`no GLB model registered for unit kind "${kind}"`);
  const { scene } = useGLTF(def.url);
  const { model } = React.useMemo(() => normalize(scene, def.height), [scene, def]);
  return (
    <group>
      <primitive object={model} />
      {/* Team allegiance ring at the model's feet. */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <ringGeometry args={[0.3, 0.36, 40]} />
        <meshBasicMaterial
          color={teamColor}
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Ghost variant: materials are CLONED so the death fade can animate opacity
 * without dimming living units that share the same GLB. The parent GhostUnit
 * drives opacity via the ref'd model traversal, same contract as its box path.
 */
export function GlbGhostModel({ kind, onModel }: {
  kind: string;
  onModel: (model: THREE.Group) => void;
}) {
  const def = unitModelForKind(kind);
  if (!def) throw new Error(`no GLB model registered for unit kind "${kind}"`);
  const { scene } = useGLTF(def.url);
  const { model } = React.useMemo(() => {
    const n = normalize(scene, def.height, { cloneMaterials: true });
    n.model.traverse(o => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    return n;
  }, [scene, def]);
  React.useEffect(() => {
    onModel(model);
    return () => {
      model.traverse(o => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
      });
    };
  }, [model, onModel]);
  return <primitive object={model} />;
}
