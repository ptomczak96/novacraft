import * as THREE from 'three';
import React from 'react';
import { useGLTF } from '@react-three/drei';

/**
 * Kenney "Blocky Characters" (CC0, kenney.nl) vendored at
 * public/voxel3d/units/ — real voxel-style character models for the human-
 * scale unit kinds. Heavy kinds keep the box-built mech (there's no mech in
 * the pack, and the chunky silhouette reads well).
 */
const MODELS = ['character-a', 'character-d', 'character-h', 'character-m', 'character-p'];

function hashKind(kind: string): number {
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  return h;
}

export function modelUrlForKind(kind: string): string {
  return `/voxel3d/units/${MODELS[hashKind(kind) % MODELS.length]}.glb`;
}

const TARGET_HEIGHT = 0.68; // world units, matches the box placeholders

export function GltfUnit({ kind, teamColor }: { kind: string; teamColor: string }) {
  const { scene } = useGLTF(modelUrlForKind(kind));

  const model = React.useMemo(() => {
    const root = scene.clone(true);
    // Normalise: feet on y=0, TARGET_HEIGHT tall, centred on x/z.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scale = TARGET_HEIGHT / (size.y || 1);
    root.scale.setScalar(scale);
    const scaled = new THREE.Box3().setFromObject(root);
    root.position.x -= (scaled.min.x + scaled.max.x) / 2;
    root.position.z -= (scaled.min.z + scaled.max.z) / 2;
    root.position.y -= scaled.min.y;

    const team = new THREE.Color(teamColor);
    root.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.castShadow = true;
      // The pack's materials are KHR unlit (→ MeshBasicMaterial). Swap for a
      // lit flat-shaded standard material so key light, shadows and AO apply,
      // and tint lightly toward the team colour.
      const src = obj.material as THREE.MeshBasicMaterial;
      const mat = new THREE.MeshStandardMaterial({
        map: src.map,
        color: src.color.clone().lerp(team, 0.22),
        roughness: 0.8,
        metalness: 0.1,
        flatShading: true,
      });
      obj.material = mat;
    });
    return root;
  }, [scene, teamColor]);

  React.useEffect(() => () => {
    model.traverse(obj => {
      if (obj instanceof THREE.Mesh) (obj.material as THREE.Material).dispose();
    });
  }, [model]);

  return (
    <group>
      {/* Pedestal crate under the character, like the reference heroes. */}
      <mesh position={[0, 0.115, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.52, 0.23, 0.52]} />
        <meshStandardMaterial color="#262c44" flatShading roughness={0.85} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.235, 0]}>
        <boxGeometry args={[0.56, 0.03, 0.56]} />
        <meshStandardMaterial color="#323a5c" flatShading roughness={0.7} metalness={0.3} />
      </mesh>
      <group position={[0, 0.25, 0]}>
        <primitive object={model} />
        {/* Team visor glow — the unit's blooming detail, like the box units. */}
        <mesh position={[0, 0.545, 0.093]}>
          <boxGeometry args={[0.12, 0.035, 0.02]} />
          <meshStandardMaterial color="#000000" emissive={teamColor} emissiveIntensity={5} />
        </mesh>
      </group>
    </group>
  );
}

MODELS.forEach(m => useGLTF.preload(`/voxel3d/units/${m}.glb`));
