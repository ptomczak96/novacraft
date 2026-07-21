import * as THREE from 'three';
import { VOXEL, type UnitDef } from './unitDefs.js';

// One shared unit-box; every part is this box scaled. Never disposed.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/**
 * Assemble a unit's THREE.Group from its def. Flat-shaded standard materials,
 * castShadow on every part, team-flagged parts tinted with teamColor.
 * Real voxel glTF loading can replace this behind the same interface.
 */
export function buildUnit(def: UnitDef, teamColor: string): THREE.Group {
  const group = new THREE.Group();
  for (const part of def.parts) {
    // Team-flagged parts get a faint emissive of the same colour so allegiance
    // reads in the dark arena — kept well below the bloom threshold (1.0) so
    // the visor stays the unit's only blooming detail.
    const material = new THREE.MeshStandardMaterial({
      color: part.teamColor ? teamColor : (part.color ?? '#57627a'),
      flatShading: true,
      roughness: 0.7,
      metalness: 0.25,
      emissive: part.emissive ?? (part.teamColor ? teamColor : '#000000'),
      emissiveIntensity: part.emissiveIntensity ?? (part.teamColor ? 0.35 : 0),
    });
    const mesh = new THREE.Mesh(UNIT_BOX, material);
    mesh.scale.set(part.size[0] * VOXEL, part.size[1] * VOXEL, part.size[2] * VOXEL);
    mesh.position.set(part.pos[0] * VOXEL, part.pos[1] * VOXEL, part.pos[2] * VOXEL);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Dispose the per-unit materials (geometry is shared and kept). */
export function disposeUnit(group: THREE.Group): void {
  group.traverse(obj => {
    if (obj instanceof THREE.Mesh) (obj.material as THREE.Material).dispose();
  });
}
