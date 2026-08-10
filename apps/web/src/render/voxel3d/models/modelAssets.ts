/**
 * GEN 8 — 3D Tileset asset registry. Maps engine terrain ids to the four tile
 * GLBs and unit typeIds to their unit GLBs (optimized copies of /assets, baked
 * by scripts/optimize-3d-assets.sh: meshopt + webp @1K + simplification).
 *
 * Only KINDS LISTED HERE have real models; everything else falls back to the
 * box-voxel build in units/unitDefs.ts, so modded/new units keep working.
 */

export const TILE_MODEL_URLS = {
  flat: '/voxel3d/models/tiles/flat.glb',
  forest: '/voxel3d/models/tiles/forest.glb',
  mountain: '/voxel3d/models/tiles/mountain.glb',
  water: '/voxel3d/models/tiles/water.glb',
} as const;

export type TileModelKind = keyof typeof TILE_MODEL_URLS;

/** Engine terrain id → tile model. Anything unknown reads as flat ground. */
export function tileModelForTerrain(terrain: string): TileModelKind {
  switch (terrain) {
    case 'forest': return 'forest';
    case 'mountain': return 'mountain';
    case 'water':
    case 'river':
    case 'lava': return 'water';
    default: return 'flat'; // plains / sand / snow / resource / …
  }
}

export interface UnitModelDef {
  url: string;
  /**
   * Target world height (tile = 1.0). Deliberately varied per unit class so a
   * scuttling reads small and a titan towers — never one uniform height.
   * The loader additionally clamps the scaled footprint to ≤ MAX_FOOTPRINT so
   * every unit stays within its own tile.
   */
  height: number;
}

/** Widest a unit may be after scaling — keeps every model inside one tile. */
export const MAX_FOOTPRINT = 0.85;

const U = '/voxel3d/models/units';

export const UNIT_MODELS: Record<string, UnitModelDef> = {
  // ── Vanguard / shared ──
  scout:      { url: `${U}/scout.glb`,      height: 0.6 },
  warrior:    { url: `${U}/warrior.glb`,    height: 0.7 },
  lancer:     { url: `${U}/lancer.glb`,     height: 0.74 },
  defender:   { url: `${U}/defender.glb`,   height: 0.78 }, // Bulwark
  wraith:     { url: `${U}/wraith.glb`,     height: 0.66 },
  stalker:    { url: `${U}/stalker.glb`,    height: 0.85 },
  sentinel:   { url: `${U}/sentinel.glb`,   height: 0.8 },
  tank:       { url: `${U}/tank.glb`,       height: 0.55 }, // vehicle: low & wide
  titan:      { url: `${U}/titan.glb`,      height: 1.1 },
  // ── Hive ──
  scuttling:  { url: `${U}/scuttling.glb`,  height: 0.38 },
  hive_scout: { url: `${U}/hive_scout.glb`, height: 0.55 },
  scab:       { url: `${U}/scab.glb`,       height: 0.6 },
  burstling:  { url: `${U}/burstling.glb`,  height: 0.5 },
  vindrace:   { url: `${U}/vindrace.glb`,   height: 0.8 },
  seercaust:  { url: `${U}/seercaust.glb`,  height: 0.85 },
  wyrm:       { url: `${U}/wyrm.glb`,       height: 0.95 },
  behemoth:   { url: `${U}/behemoth.glb`,   height: 1.15 },
};

/** Mode-variant unit ids that reuse another kind's model. */
const KIND_ALIASES: Record<string, string> = {
  tank_assault: 'tank',
  wyrm_burrowed: 'wyrm',
};

export function unitModelForKind(kind: string): UnitModelDef | null {
  return UNIT_MODELS[KIND_ALIASES[kind] ?? kind] ?? null;
}
