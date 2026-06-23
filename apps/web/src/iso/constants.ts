// ── Isometric tile dimensions ──
// TILE_W / TILE_H are the GRID SPACING (the "cell size" — how far apart tile
// centres sit, and the diamond used for mouse hit-testing). SPRITE_W is how wide
// the art is actually drawn. Keeping SPRITE_W larger than TILE_W makes the cubes
// overlap, "squeezing" the board tighter without shrinking the art. Lower
// TILE_W / TILE_H to pull tiles closer; raise them to spread tiles apart.
export const TILE_W = 108;  // horizontal grid spacing (cell size)
export const TILE_H = 54;   // vertical grid spacing (2:1 ratio)
export const SPRITE_W = 132; // on-screen draw width of a tile sprite
export const BASE_DEPTH = 28; // side-face height for the vector fallback prism

// ── Terrain elevation offsets (px, relative to base) ──
// Flat board (Polytopia-style): every terrain renders at the same level. A
// mountain is just a tile you walk onto for a defence bonus, never a raised
// platform. Heights baked into the tile sprites are purely visual.
export const ELEVATION: Record<string, number> = {
  plains:   0,
  forest:   0,
  mountain: 0,
  water:    0,
  river:    0,
  resource: 0,
  sand:     0,
  snow:     0,
  lava:     0,
};

// ── Terrain face colors: [top, left, right] ──
// Left face is darker, right face medium, top lightest — simulates light from upper-left.
// Used as a fallback before tile sprites finish loading.
export const TERRAIN_COLORS: Record<string, [string, string, string]> = {
  plains:   ['#a8d5a2', '#7ab374', '#8ec486'],
  forest:   ['#2d6a4f', '#1b4332', '#245740'],
  mountain: ['#8d99ae', '#6b7486', '#7c8798'],
  water:    ['#457b9d', '#2e5e7a', '#3a6f8d'],
  river:    ['#7ec8e3', '#5ba3bf', '#6db5d1'],
  resource: ['#f4a261', '#c47d3e', '#d99050'],
  sand:     ['#e8d18a', '#c9ae62', '#dabf74'],
  snow:     ['#eef2f7', '#cbd5e1', '#dde5ee'],
  lava:     ['#e8531f', '#b83a12', '#d14618'],
};

// ── Player / faction colors ──
export const PLAYER_COLORS: [string, string] = ['#4fc3f7', '#ef5350'];

// ── Overlay colors ──
export const MOVE_HIGHLIGHT = 'rgba(79, 195, 247, 0.35)';
export const ATTACK_HIGHLIGHT = 'rgba(239, 83, 80, 0.35)';
export const SELECTION_COLOR = 'rgba(255, 255, 255, 0.7)';
export const FOG_EXPLORED_OVERLAY = 'rgba(10, 10, 26, 0.55)';
export const BG_COLOR = '#1a1a2e';

// ── HP bar colors ──
export const HP_HIGH = '#66bb6a';
export const HP_MID  = '#ffa726';
export const HP_LOW  = '#ef5350';

// ── Unit shape mapping ──
// Maps unit typeId to a geometric shape identifier used by drawUnit.
export type UnitShape = 'pentagon' | 'diamond' | 'triangle' | 'hexagon' | 'circle' | 'star' | 'square' | 'cross' | 'arrow';

export const UNIT_SHAPES: Record<string, UnitShape> = {
  warrior:              'pentagon',
  scout:                'diamond',
  archer:               'triangle',
  defender:             'hexagon',
  catapult:             'circle',
  ironclad_berserker:   'star',
  ironclad_siege_tower: 'square',
  sylvan_ranger:        'arrow',
  sylvan_treant:        'cross',
};

// ── Grid label font ──
export const LABEL_FONT = '9px monospace';
export const LABEL_COLOR = 'rgba(255,255,255,0.4)';

// ── Canvas padding around the rendered map ──
export const CANVAS_PAD = 32;
