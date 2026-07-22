import * as THREE from 'three';
import React from 'react';
import { useGLTF, useTexture } from '@react-three/drei';

/**
 * The Vanguard Stalker as a real 3D mech (CGTrader ADV_M_002, vendored):
 * geometry converted OBJ→glb; 4K PBR textures baked down to 1K web maps
 * (AO multiplied into the diffuse; roughness/metalness channel-packed into
 * one ORM texture on three's G/B channels). Voxel3d renderer only.
 */
const GLB = '/voxel3d/units/stalker.glb';
const TARGET_HEIGHT = 0.82; // heavy walker — taller than the 0.72 infantry scale

/** Yaw offset so the mech's forward matches the pipeline's +Z convention. */
const ROT_OFFSET = 0;

export function StalkerModel({ teamColor }: { teamColor: string }) {
  const { scene } = useGLTF(GLB);
  const [diffuse, normal, orm] = useTexture([
    '/voxel3d/units/stalker-diffuse.jpg',
    '/voxel3d/units/stalker-normal.jpg',
    '/voxel3d/units/stalker-orm.jpg',
  ]);

  const { model, material } = React.useMemo(() => {
    // glTF UV convention: textures must not be flipped.
    for (const t of [diffuse, normal, orm]) t.flipY = false;
    diffuse.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshStandardMaterial({
      map: diffuse,
      normalMap: normal,
      roughnessMap: orm,
      metalnessMap: orm,
      roughness: 1,
      metalness: 1,
      // Faint team tint so ownership reads even on the textured hull.
      color: new THREE.Color('#ffffff').lerp(new THREE.Color(teamColor), 0.15),
    });

    const model = scene.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.setScalar(TARGET_HEIGHT / (size.y || 1));
    const scaled = new THREE.Box3().setFromObject(model);
    model.position.set(
      -(scaled.min.x + scaled.max.x) / 2,
      -scaled.min.y,
      -(scaled.min.z + scaled.max.z) / 2,
    );
    model.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.material = material;
      }
    });
    return { model, material };
  }, [scene, diffuse, normal, orm, teamColor]);

  React.useEffect(() => () => material.dispose(), [material]);

  return (
    <group rotation-y={ROT_OFFSET}>
      <primitive object={model} />
      {/* Team beacon above the hull — the blooming allegiance marker. */}
      <mesh position={[0, TARGET_HEIGHT + 0.05, 0]}>
        <boxGeometry args={[0.06, 0.06, 0.06]} />
        <meshStandardMaterial color="#000000" emissive={teamColor} emissiveIntensity={4} />
      </mesh>
    </group>
  );
}

useGLTF.preload(GLB);
