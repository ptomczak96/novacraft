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
  /** Flying unit: body hovers this far above the tile (with a gentle bob);
   *  the team ring stays on the ground like a landing marker. */
  hover?: number;
  /** Model ships walk/attack/idle clips (rigged in Blender — see
   *  assets/rigs/): moves glide slower so the stride reads, and the
   *  procedural move-hop is disabled in favour of the clip's own gait. */
  rigged?: boolean;
  /** Experimental opt-in pixel-3D shading treatment. Kept per-kind so the
   *  visual conversion can be reviewed unit-by-unit before wider rollout. */
  pixelStyle?: boolean;
}

/** Widest a unit may be after scaling — keeps every model inside one tile. */
export const MAX_FOOTPRINT = 0.85;

/** How far a unit standing on a mountain tile is lifted so it stands ON the
 *  rock top instead of merging into it (tileset mode only). */
export const MOUNTAIN_UNIT_ELEVATION = 0.34;

const U = '/voxel3d/models/units';

export const UNIT_MODELS: Record<string, UnitModelDef> = {
  // ── Vanguard / shared ── (all rigged: idle/walk/attack clips, see assets/rigs/
  // for the warrior blend; the rest were rigged procedurally via Blender MCP)
  scout:      { url: `${U}/scout.glb`,      height: 0.36, rigged: true },
  warrior:    { url: `${U}/warrior.glb`,    height: 0.7, rigged: true },
  lancer:     { url: `${U}/lancer.glb`,     height: 0.74, rigged: true },
  defender:   { url: `${U}/defender.glb`,   height: 0.78, rigged: true }, // Bulwark
  wraith:     { url: `${U}/wraith.glb`,     height: 0.66, rigged: true },
  stalker:    { url: `${U}/stalker.glb`,    height: 1.1, rigged: true }, // footprint clamp keeps it on-tile
  sentinel:   { url: `${U}/sentinel.glb`,   height: 0.72, hover: 0.3, rigged: true }, // flyer
  tank:       { url: `${U}/tank.glb`,       height: 0.55, rigged: true }, // vehicle: low & wide
  titan:      { url: `${U}/titan.glb`,      height: 1.1, rigged: true, pixelStyle: true },
  // ── Hive ──
  scuttling:  { url: `${U}/scuttling.glb`,  height: 0.27, rigged: true },
  hive_scout: { url: `${U}/hive_scout.glb`, height: 0.55, rigged: true },
  reaper:     { url: `${U}/reaper.glb`,     height: 0.55, hover: 0.25, rigged: true }, // flyer
  ravener:    { url: `${U}/ravener.glb`,    height: 0.5,  hover: 0.25 }, // flyer (air class)
  scab:       { url: `${U}/scab.glb`,       height: 0.6, rigged: true },
  burstling:  { url: `${U}/burstling.glb`,  height: 0.5, rigged: true },
  vindrace:   { url: `${U}/vindrace.glb`,   height: 0.8, rigged: true },
  seercaust:  { url: `${U}/seercaust.glb`,  height: 0.85, rigged: true },
  wyrm:       { url: `${U}/wyrm.glb`,       height: 0.95, rigged: true },
  behemoth:   { url: `${U}/behemoth.glb`,   height: 1.15, rigged: true },
};

/** Mode-variant unit ids that reuse another kind's model. */
const KIND_ALIASES: Record<string, string> = {
  tank_assault: 'tank',
  wyrm_burrowed: 'wyrm',
};

export function unitModelForKind(kind: string): UnitModelDef | null {
  return UNIT_MODELS[KIND_ALIASES[kind] ?? kind] ?? null;
}
