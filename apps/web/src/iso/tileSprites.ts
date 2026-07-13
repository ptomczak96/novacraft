// ── Tile sprite loader ──
// Terrain PNGs for the default hand-built grassland/stone tileset under
// /tiles/*.png. Each engine terrain id maps to a weighted list of sprite
// "variant" files; the renderer picks one deterministically per tile so a biome
// reads as "mostly X with a few others mixed in" while staying stable across
// re-renders.
//
// The engine only ever generates plains / forest / mountain terrain (water & lava
// generation is disabled).

export type TileTheme =
  | 'default' | 'gen2_volcanic' | 'grass_iso' | 'gen3_desert' | 'gen5_desert'
  | 'variety_neon_blue' | 'variety_toxic_green' | 'variety_violet_ash'
  | 'variety_ember_red' | 'variety_frost_teal';

/** Shared ThemeDef for the "Variety tiles" pack — 5 color themes with identical
 *  geometry (same sheet, same normalisation contract), differing only in art. */
function varietyTheme(name: string): ThemeDef {
  return {
    base: `/tiles/variety_${name}`,
    files: ['plain', 'mountain', 'rocky', 'water'],
    variants: {
      plains:   [...Array(11).fill('plain'), 'rocky'],
      forest:   ['rocky', 'rocky', 'plain'],
      mountain: ['mountain', 'mountain', 'plain'],
      water:    ['water'],
      river:    ['water'],
      lava:     ['water'],
      sand:     ['plain'],
      snow:     ['plain'],
      resource: ['plain'],
    },
    draw: { spriteW: 108, spriteH: 100.84, topOffsetY: -20.73 },
  };
}

// Draw geometry for a theme. The renderer needs to know how wide to draw a sprite
// and where its top-face "surface" sits inside the art so tiles tessellate on the
// isometric grid regardless of the art's own dimensions.
export interface ThemeDrawParams {
  /** On-screen draw width of a terrain tile (px). Wider than the grid cell so
   *  neighbouring tiles overlap and seams disappear. */
  spriteW: number;
  /** Optional explicit on-screen draw height (px). When set, the sprite is scaled
   *  ANISOTROPICALLY (spriteW × spriteH) so the art's top-face diamond becomes
   *  congruent to the grid diamond (edge slope exactly 0.5) and tiles tessellate.
   *  When omitted, dh is derived from the art's natural aspect ('default' behaviour). */
  spriteH?: number;
  /** Vertical offset (px) from the diamond's top vertex to where the sprite's
   *  top edge is drawn. Tuned so the art's top surface lands on the tile diamond. */
  topOffsetY: number;
  /** How resource art is drawn: 'icon' (small marker centred on the tile, default)
   *  or 'object' (a transparent prop scaled to the tile and planted base-on-surface).
   *  Omit → 'icon'. */
  resourceMode?: 'icon' | 'object';
}

interface ThemeDef {
  /** URL prefix under /public for this theme's sprites. */
  base: string;
  /** Distinct sprite files to load, key → `${base}/${key}.png`. */
  files: readonly string[];
  /** Engine terrain id → weighted variant file keys (repeat a key to weight it). */
  variants: Record<string, string[]>;
  /** Shore autotiling: pick a tile by which of the 4 diamond edges border LAND.
   *  `terrains` are the terrains treated as "this liquid" (all count as water for
   *  the neighbour test). `lookup` maps a 4-bit "NE SE SW NW" land-mask (e.g.
   *  "1001") to candidate file keys (one chosen per-tile by hash for variety). */
  autotile?: { terrains: string[]; lookup: Record<string, string[]> };
  /** Variant pool for tiles carrying a feature (resource/ruin/city). Defaults to
   *  the first plains variant only — set this when several equally-clean base
   *  tiles exist so featured ground mixes instead of repeating one file. */
  featureVariants?: string[];
  /** When true, water/lava/river do NOT sink below the land plane in this theme
   *  (its "liquid" art is solid barrier objects standing ON the ground, e.g.
   *  GEN 5's mesa towers — sinking them would bury their bases). */
  flushLiquids?: boolean;
  /** Resource kind → sprite key drawn on top of the tile. */
  resources?: Partial<Record<'ore' | 'plasma', string>>;
  /** Optional per-sprite vertical correction (px, added to topOffsetY; positive =
   *  drawn lower). For tiles whose surface plane sits at a different row inside the
   *  canvas than the tile the theme's transform was derived from — nudges them back
   *  onto the shared floor plane so they don't cascade. Keys are file keys. */
  nudge?: Record<string, number>;
  draw: ThemeDrawParams;
}

/** Deterministic per-tile value used to pick a stable weighted variant. */
function variantHash(x: number, y: number): number {
  return ((x * 73856093) ^ (y * 19349663)) >>> 0;
}

const THEMES: Record<TileTheme, ThemeDef> = {
  // ── Default: hand-built grassland / stone cubes (148×164 art) ──
  default: {
    base: '/tiles',
    files: [
      'plains', 'forest', 'dirt',
      'stone01', 'stone02', 'stone03',
      'water', 'lava', 'sand', 'snow', 'resource', 'mountain',
      'ore', 'plasma',
    ],
    variants: {
      plains:   ['plains', 'plains', 'plains', 'dirt'],
      forest:   ['forest'],
      mountain: ['stone02', 'stone02', 'stone02', 'stone01', 'stone03'],
      // Disabled-but-supported terrains (not generated right now):
      water:    ['water'],
      lava:     ['lava'],
      sand:     ['sand'],
      snow:     ['snow'],
      resource: ['plains'],
    },
    resources: { ore: 'ore', plasma: 'plasma' },
    draw: { spriteW: 132, topOffsetY: -6 },
  },

  // ── Shared 192×256 iso-tile transform (originally derived for the Space Station
  //    set; reused by GEN 2 - Volcanic) ──
  // Contract: canvas 192×256, pivot (96,245), footprint width 178, contact row 245.
  // The reference tile's top-face diamond (back vertex row 108, L/R vertices row 161
  // halfWidth 88.5, front vertex ~214.5) is mapped ANISOTROPICALLY onto the grid
  // diamond so its drawn edge slope is exactly 0.5:
  //   sx_scale = HW/88.5 = 54/88.5 = 0.610169 → spriteW = 192·sx = 117.15
  //   sy_scale = 54/106.5          = 0.507042 → spriteH = 256·sy = 129.80
  //   (full top face 108→214.5 → exactly 54, so each tile's front vertex meets the
  //    next tile's back vertex — the anti-cascade invariant)
  // Then a UNIFORM OVERLAP BLEED f=1.02 about the surface centre (sy+27):
  //   spriteW = 119.50, spriteH = 132.40, topOffsetY = -56.39
  // The bleed grows each tile ~1.08px past the grid on every side so its top face
  // laps OVER the tile behind it (painter order draws front tiles last), hiding the
  // sub-pixel seam AND the darker rim baked around each tile — the residual
  // "micro-cascade". Surface centre stays on sy+27 so units/markers align; the bleed
  // is a fixed per-tile expansion so it does NOT accumulate down the board. KEEP
  // THESE FRACTIONAL — rounding drifts the slope and reopens seams. Per-tile `nudge`
  // corrects tiles whose surface plane sits at a different canvas row.
  gen2_volcanic: {
    base: '/tiles/gen2_volcanic',
    files: ['plain', 'mountain', 'rocky', 'lava'],
    variants: {
      // Rocky is a sparse accent (~1 in 13 plains); features never use it (hasFeature).
      plains:   [...Array(12).fill('plain'), 'rocky'],
      forest:   ['rocky', 'rocky', 'plain'],
      mountain: ['mountain', 'mountain', 'plain'],
      // Molten lava tile serves both water and lava terrain; both sink (TERRAIN_SINK).
      water:    ['lava'],
      lava:     ['lava'],
      sand:     ['plain'],
      snow:     ['plain'],
      resource: ['plain'],
    },
    // Per-tile nudge aligns each surface plane (top-of-full-width-band row, measured)
    // onto the shared floor (reference art-row 160 → grid surface centre) so the
    // floor stays flat: plain 151→+4.65, mountain 155→+2.59, rocky 149→+5.69, lava 150→+5.17.
    // Lava additionally raised 10.8px (50% of the 0.4·TILE_H≈21.6 sink) so the
    // molten surface sits shallower in its basin: 5.17 − 10.8 = −5.63.
    nudge: { plain: 4.65, mountain: 2.59, rocky: 5.69, lava: -5.63 },
    // No ore/plasma art → vector crystal marker fallback.
    draw: { spriteW: 119.50, spriteH: 132.40, topOffsetY: -56.39 },
  },

  // ── GEN 3 - Desert (AI-generated cube tiles, normalised) ──
  // The 4 source cubes had inconsistent footprints (475/535/485/529) and a ~1.7:1
  // top-face diamond (steeper than the grid's 2:1). They were normalised at build
  // time to ONE shared 475×500 contract (uniform-scaled to a common footprint, side-
  // vertex rows aligned), so a single ANISOTROPIC draw maps the 1.7:1 top diamond onto
  // the 2:1 grid: spriteW 108 (footprint→108), spriteH 96.43 (squash the taller
  // diamond so its 280px height → 54), topOffsetY -13.5 (canonical back vertex → sy).
  gen3_desert: {
    base: '/tiles/gen3_desert',
    files: ['flat', 'rock', 'mountain', 'water'],
    variants: {
      plains:   ['flat', 'flat', 'flat', 'flat', 'flat', 'flat', 'flat', 'rock'],
      forest:   ['rock', 'rock', 'flat'],
      mountain: ['mountain', 'mountain', 'flat'],
      water:    ['water'],
      river:    ['water'],
      lava:     ['water'],
      sand:     ['flat'],
      snow:     ['flat'],
      resource: ['flat'],
    },
    // Raise the water tile ~30% of its sink (0.4·TILE_H≈21.6px) so it sits a touch
    // shallower in the basin: net sink ≈ 15px.
    nudge: { water: -6.5 },
    draw: { spriteW: 108, spriteH: 96.43, topOffsetY: -13.5 },
  },

  // ── Variety pack (5 neon color themes from one AI sheet) ──
  // 20 tiles parsed out of "Variety tiles.png" (5 themes × plain/mountain/rocky/
  // water on black), background flood-fill keyed (interior stays opaque, outer
  // glow halo gets soft alpha), then normalised to ONE shared 192×169 contract:
  // body footprint (glow excluded) scaled to 176px, side-vertex rows aligned at
  // row 80. Anisotropic draw maps the ~1.9:1 top diamond onto the 2:1 grid.
  variety_neon_blue:   varietyTheme('neon_blue'),
  variety_toxic_green: varietyTheme('toxic_green'),
  variety_violet_ash:  varietyTheme('violet_ash'),
  variety_ember_red:   varietyTheme('ember_red'),
  variety_frost_teal:  varietyTheme('frost_teal'),

  // ── Fantasy grassland (Mocapot Unity isometric tileset) ──
  // Pre-baked cube tiles, native 128×128 with a 128×64 top-face diamond (top vertex
  // row 0, side vertices row 32). Uniform scale 108/128 = 0.84375 maps that diamond
  // exactly onto the 108×54 grid, so spriteW = 108 / topOffsetY = 0 tessellates with
  // no cascade (the art was authored to tile). Tree tiles composite a tree object
  // onto a grass base on a taller 128-wide canvas; their diamond sits at the bottom,
  // pulled back onto the floor by nudge = -(280-128)·0.84375 = -128.25.
  grass_iso: {
    base: '/tiles/grass_iso',
    files: [
      'grass', 'bumpy', 'tree_a', 'tree_b', 'sand', 'snow',
      ...Array.from({ length: 48 }, (_, i) => `water_${String(i).padStart(2, '0')}`),
    ],
    variants: {
      // Mostly grass with an occasional bumpy (cobbled-stone) accent.
      plains:   ['grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'bumpy'],
      forest:   ['tree_a', 'tree_b'],
      mountain: ['bumpy', 'bumpy', 'grass'],
      // Fallback open-water tile; the shore variant is chosen by autotile below.
      water:    ['water_00'],
      river:    ['water_00'],
      lava:     ['water_00'],
      sand:     ['sand'],
      snow:     ['snow'],
      resource: ['grass'],
    },
    // Shore autotiling: 4-bit "NE SE SW NW" land-mask → water tiles whose baked
    // foam sits on exactly those (land-facing) edges. Derived by foam-edge analysis
    // of the pack's 48-tile water set; multiple candidates give per-tile variety.
    autotile: {
      terrains: ['water', 'river', 'lava'],
      lookup: {
        '0000': ['water_00', 'water_01', 'water_12', 'water_14', 'water_23', 'water_24', 'water_27', 'water_29'],
        '0001': ['water_05', 'water_13', 'water_21', 'water_22', 'water_31', 'water_37', 'water_38', 'water_43'],
        '0010': ['water_03', 'water_32', 'water_33', 'water_41'],
        '0011': ['water_04', 'water_30', 'water_42'],
        '0100': ['water_09', 'water_36', 'water_39', 'water_47'],
        '0101': ['water_15'],
        '0110': ['water_02', 'water_40'],
        '0111': ['water_17'],
        '1000': ['water_07', 'water_34', 'water_35', 'water_45'],
        '1001': ['water_06', 'water_10', 'water_25', 'water_26', 'water_28', 'water_44'],
        '1010': ['water_16'],
        '1011': ['water_18'],
        '1100': ['water_08', 'water_46'],
        '1101': ['water_11', 'water_19'],
        '1110': ['water_20'],
        '1111': ['water_20'],
      },
    },
    // Tree tiles carry extra canvas above the diamond; pull them onto the floor plane.
    nudge: { tree_a: -128.25, tree_b: -128.25 },
    draw: { spriteW: 108, topOffsetY: 0 },
  },

  // ── GEN 5 - Desert (Patrick's Tileset_Script normaliser output) ──
  // Geometry straight from out_desert/manifest.json: 512×256 top-face diamond —
  // exactly the grid's 2:1, so a plain uniform scale (108/512) works with NO
  // anisotropic squash (spriteH omitted; tall canvases keep their aspect).
  // Normal canvases are 512×384 with the diamond's top vertex at row 32
  // → topOffsetY = −32·(108/512) = −6.75. The two tall mesa barriers are
  // 512×768 (top vertex row 416): nudge −(416−32)·s = −81. Liquids draw flush
  // (flushLiquids) — this theme's water/lava art is mesa towers standing ON the
  // plane, and skipping the sink lets the tall mesas serve BOTH mountains and
  // impassable tiles with one nudge value.
  gen5_desert: {
    base: '/tiles/gen5_desert',
    files: [
      'open_01', 'open_02', 'open_03',
      'cover_01', 'cover_02', 'cover_03',
      'barrier_01', 'barrier_02', 'barrier_03',
    ],
    // Every open terrain draws from ALL three scrub variants so the ground mixes
    // evenly, and mountains rotate through all three mesa shapes.
    variants: {
      plains:   ['open_01', 'open_02', 'open_03'],
      forest:   ['cover_01', 'cover_02', 'cover_03'],
      mountain: ['barrier_01', 'barrier_02', 'barrier_03'],
      water:    ['barrier_02', 'barrier_03'],
      lava:     ['barrier_02', 'barrier_03'],
      river:    ['open_01', 'open_02', 'open_03'],
      sand:     ['open_01', 'open_02', 'open_03'],
      snow:     ['open_01', 'open_02', 'open_03'],
      resource: ['open_01', 'open_02', 'open_03'],
    },
    // Featured tiles (resources/ruins/cities) also mix across the three scrubs
    // instead of pinning to open_01 (~25% of tiles carry a resource sprinkle).
    featureVariants: ['open_01', 'open_02', 'open_03'],
    flushLiquids: true,
    nudge: { barrier_02: -81, barrier_03: -81 },
    draw: { spriteW: 108, topOffsetY: -6.75 },
  },
};

// Loaded images keyed by `${theme}/${key}`.
const sprites: Record<string, HTMLImageElement> = {};
const loadedThemes = new Set<TileTheme>();
const loadingThemes = new Set<TileTheme>();

// The theme the renderer currently draws with.
let activeTheme: TileTheme = 'default';

export function setActiveTheme(theme: TileTheme): void {
  activeTheme = theme;
}

export function getActiveTheme(): TileTheme {
  return activeTheme;
}

/** Draw geometry for the active theme. */
export function getThemeDrawParams(): ThemeDrawParams {
  return THEMES[activeTheme].draw;
}

/**
 * Begin loading a theme's sprites (idempotent per theme). `onReady` fires once
 * that theme's images have all settled (loaded or errored — errors are counted
 * so a missing file never hangs readiness).
 */
export function loadTileSprites(theme: TileTheme = activeTheme, onReady?: () => void): void {
  if (loadedThemes.has(theme)) { onReady?.(); return; }
  const def = THEMES[theme];
  if (loadingThemes.has(theme)) {
    // Already in flight: still notify the caller when it finishes.
    if (onReady) {
      const check = () => {
        if (loadedThemes.has(theme)) onReady();
        else setTimeout(check, 30);
      };
      check();
    }
    return;
  }
  loadingThemes.add(theme);
  let loaded = 0;
  for (const key of def.files) {
    const img = new Image();
    const done = () => {
      loaded++;
      if (loaded >= def.files.length) {
        loadedThemes.add(theme);
        loadingThemes.delete(theme);
        onReady?.();
      }
    };
    img.onload = done;
    img.onerror = done;
    img.src = `${def.base}/${key}.png`;
    sprites[`${theme}/${key}`] = img;
  }
}

function ready(theme: TileTheme, key: string): HTMLImageElement | null {
  const img = sprites[`${theme}/${key}`];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * Return a ready-to-draw terrain sprite for the active theme at grid (x,y),
 * choosing a stable weighted variant. Returns null to fall back to the vector prism.
 */
export function getTileSprite(
  terrain: string, x: number, y: number, hasFeature = false,
): { img: HTMLImageElement | null; nudge: number } {
  const def = THEMES[activeTheme];
  let key: string;
  if (hasFeature) {
    // Resources / cities / ruins always sit on clean base ground — never on a
    // scattered rocky (or other) variant tile. Themes with several clean base
    // tiles list them in featureVariants so featured ground still mixes.
    const base = def.featureVariants ?? [def.variants.plains?.[0] ?? def.variants[terrain]?.[0] ?? terrain];
    const v = variantHash(x, y);
    key = base[((v % base.length) + base.length) % base.length];
  } else {
    const variants = def.variants[terrain] ?? [terrain];
    const v = variantHash(x, y);
    key = variants[((v % variants.length) + variants.length) % variants.length];
  }
  return { img: ready(activeTheme, key), nudge: def.nudge?.[key] ?? 0 };
}

/** Resource marker sprite (ore/plasma) for the active theme, or null until loaded. */
export function getResourceIcon(kind: 'ore' | 'plasma'): HTMLImageElement | null {
  const key = THEMES[activeTheme].resources?.[kind];
  return key ? ready(activeTheme, key) : null;
}

/** Whether the active theme draws liquids flush with the land plane (no sink). */
export function getThemeFlushLiquids(): boolean {
  return THEMES[activeTheme].flushLiquids ?? false;
}

/** Shore-autotile config for the active theme, or null if it doesn't autotile. */
export function getThemeAutotile(): { terrains: string[]; lookup: Record<string, string[]> } | null {
  return THEMES[activeTheme].autotile ?? null;
}

/**
 * Ready-to-draw sprite for an explicit file key in the active theme (+ its nudge).
 * Used by shore autotiling, which resolves the key itself. Returns null img until
 * the image has loaded.
 */
export function getSpriteByKey(key: string): { img: HTMLImageElement | null; nudge: number } {
  const def = THEMES[activeTheme];
  return { img: ready(activeTheme, key), nudge: def.nudge?.[key] ?? 0 };
}

