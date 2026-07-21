/**
 * Placeholder "voxel-look" unit definitions: grouped boxes on a conceptual
 * 24-voxel-tall humanoid scale. Sizes/positions are in voxels; pos is the part
 * CENTER, x/z from body midline, y up from the ground. Models face +Z.
 *
 * This is the seam where real voxel glTF models plug in later: replace
 * buildUnit()'s box assembly, keep the UnitDef→Group interface.
 */

export const VOXEL = 0.03; // 24 voxels ≈ 0.72 world units tall

export interface UnitPartDef {
  size: [number, number, number];
  pos: [number, number, number];
  color?: string;
  /** Painted with the owning player's team colour. */
  teamColor?: boolean;
  emissive?: string;
  /** Visor/eye glow in the owning player's team colour (blooms). */
  teamGlow?: boolean;
  emissiveIntensity?: number;
}

export interface UnitDef {
  parts: UnitPartDef[];
}

const GUNMETAL = '#57627a';
const DARK = '#39415a';
const JOINT = '#232838';

/** Standard infantry silhouette: legs, torso, head with emissive visor, rifle. */
const TROOPER: UnitDef = {
  parts: [
    { size: [3, 8, 3], pos: [-2.2, 4, 0], color: DARK },
    { size: [3, 8, 3], pos: [2.2, 4, 0], color: DARK },
    { size: [8, 8, 5], pos: [0, 12, 0], teamColor: true },
    { size: [2.5, 6.5, 2.5], pos: [-5.2, 12.5, 0], color: GUNMETAL },
    { size: [2.5, 6.5, 2.5], pos: [5.2, 12.5, 0], color: GUNMETAL },
    { size: [5, 5, 5], pos: [0, 18.8, 0], color: GUNMETAL },
    // Visor — the one emissive detail (bloom + reflection participant).
    { size: [4.2, 1.4, 0.8], pos: [0, 19.3, 2.6], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    { size: [1.8, 1.8, 8], pos: [5.2, 10.5, 3], color: JOINT },
  ],
};

/** Long-barrel variant: slimmer, antenna, red visor, oversized rifle. */
const GUNNER: UnitDef = {
  parts: [
    { size: [2.6, 8, 2.6], pos: [-2, 4, 0], color: DARK },
    { size: [2.6, 8, 2.6], pos: [2, 4, 0], color: DARK },
    { size: [7, 7.5, 4.5], pos: [0, 11.7, 0], teamColor: true },
    { size: [2.2, 6, 2.2], pos: [-4.6, 12, 0], color: GUNMETAL },
    { size: [2.2, 6, 2.2], pos: [4.6, 12, 0], color: GUNMETAL },
    { size: [4.6, 4.6, 4.6], pos: [0, 17.8, 0], color: GUNMETAL },
    { size: [3.8, 1.2, 0.8], pos: [0, 18.2, 2.4], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    { size: [0.8, 5, 0.8], pos: [-2, 22.5, -1], color: JOINT },
    { size: [1.6, 1.6, 12], pos: [4.6, 10.2, 4], color: JOINT },
  ],
};

/** Heavy walker: broad torso, shoulder pads, stubby legs, cyclops visor. */
const MECH: UnitDef = {
  parts: [
    { size: [4.5, 9, 5.5], pos: [-4, 4.5, 0], color: DARK },
    { size: [4.5, 9, 5.5], pos: [4, 4.5, 0], color: DARK },
    { size: [13, 10, 8], pos: [0, 14, 0], teamColor: true },
    { size: [5, 4, 7], pos: [-8.5, 18, 0], color: GUNMETAL },
    { size: [5, 4, 7], pos: [8.5, 18, 0], color: GUNMETAL },
    { size: [7, 4, 6], pos: [0, 21, 0.5], color: GUNMETAL },
    // Cyclops visor slit.
    { size: [5.5, 1.6, 0.8], pos: [0, 21.2, 3.6], color: '#000000', teamGlow: true, emissiveIntensity: 5 },
    { size: [3, 3, 9], pos: [-8.5, 15.5, 3], color: JOINT },
  ],
};

/** Unit kinds with a heavy/large silhouette in the game data. */
const HEAVY_KINDS = new Set([
  'titan', 'tank', 'catapult', 'ironclad_siege_tower', 'sylvan_treant', 'vindrace', 'wyrm', 'defender',
]);
/** Ranged / sensor kinds → long-barrel gunner silhouette. */
const RANGED_KINDS = new Set([
  'archer', 'sentinel', 'seercaust', 'hive_scout', 'reaper', 'stalker',
]);

export function defForKind(kind: string): UnitDef {
  if (HEAVY_KINDS.has(kind)) return MECH;
  if (RANGED_KINDS.has(kind)) return GUNNER;
  return TROOPER;
}
