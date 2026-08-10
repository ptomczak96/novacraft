import { create } from 'zustand';
import type * as THREE from 'three';

/**
 * Bridge between the selected UnitMesh (which owns the body meshes) and the
 * PostFX Outline pass (which needs those meshes as its selection). Kept as a
 * tiny render-side store so neither component imports the other.
 */
interface OutlineState {
  objects: THREE.Object3D[];
  set: (objects: THREE.Object3D[]) => void;
}

export const useOutlineStore = create<OutlineState>(set => ({
  objects: [],
  set: objects => set({ objects }),
}));
