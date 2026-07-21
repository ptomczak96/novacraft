/**
 * Three.js layer assignments controlling what the floor reflection pass sees.
 *
 * drei's MeshReflectorMaterial renders the mirrored pass with a fresh internal
 * camera whose layer mask is the default (layer 0 only). So: everything that
 * should appear in the floor reflection stays on layer 0; everything excluded
 * (background city cards, rain, the grid overlay, debug helpers) goes on
 * NO_REFLECT, which only the main camera enables.
 */
export const LAYER_REFLECTED = 0;
export const LAYER_NO_REFLECT = 1;
