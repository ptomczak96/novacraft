// ── Tile sprite loader + variants ──
// Loads terrain PNGs from /public/tiles. Each terrain maps to a weighted list of
// sprite "variant" files; the renderer picks one deterministically per tile so a
// biome reads as "mostly X with a few others mixed in" while staying stable
// across re-renders. Water and lava sprites stay loaded but are currently unused
// by map generation (kept so the code path is ready to re-enable).

// Every distinct sprite file we load, keyed by short name → /tiles/<key>.png
const SPRITE_FILES = [
  'plains', 'forest', 'dirt',
  'stone01', 'stone02', 'stone03',
  'water', 'lava', 'sand', 'snow', 'resource', 'mountain',
  // Resource marker icons (32×32 pixel art, drawn on top of a tile).
  'ore', 'plasma',
] as const;

// terrain id → weighted variant file keys. Repeating a key weights it heavier.
// Grassland uses grass (mostly) + a little dirt; forests use leafs. Stone uses
// Stone_02 mostly with Stone_01/03 mixed in.
export const TILE_VARIANTS: Record<string, string[]> = {
  plains:   ['plains', 'plains', 'plains', 'dirt'],
  forest:   ['forest'],
  mountain: ['stone02', 'stone02', 'stone02', 'stone01', 'stone03'],
  // Disabled-but-supported terrains (not generated right now):
  water:    ['water'],
  lava:     ['lava'],
  sand:     ['sand'],
  snow:     ['snow'],
  resource: ['plains'],
};

const sprites: Record<string, HTMLImageElement> = {};
let started = false;
let loaded = 0;

/** Begin loading all tile sprites. Idempotent; `onReady` fires when complete. */
export function loadTileSprites(onReady?: () => void): void {
  if (started) {
    if (loaded >= SPRITE_FILES.length) onReady?.();
    return;
  }
  started = true;
  for (const key of SPRITE_FILES) {
    const img = new Image();
    const done = () => {
      loaded++;
      if (loaded >= SPRITE_FILES.length) onReady?.();
    };
    img.onload = done;
    img.onerror = done; // count errors too so a missing file never hangs readiness
    img.src = `/tiles/${key}.png`;
    sprites[key] = img;
  }
}

/**
 * Return a ready-to-draw sprite for a terrain, choosing a variant by `variant`
 * (any integer — typically a per-tile hash). Returns null to use the vector fallback.
 */
export function getTileSprite(terrain: string, variant = 0): HTMLImageElement | null {
  const variants = TILE_VARIANTS[terrain] ?? [terrain];
  const key = variants[((variant % variants.length) + variants.length) % variants.length];
  const img = sprites[key];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/** Resource marker icon for an ore/plasma tile, or null until loaded. */
export function getResourceIcon(kind: 'ore' | 'plasma'): HTMLImageElement | null {
  const img = sprites[kind];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
