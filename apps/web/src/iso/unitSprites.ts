import { TEAM_COLORS } from './constants.js';
import { getActiveTheme } from './tileSprites.js';

// Directional unit sprites. Units keyed here render from PNG art instead of the
// vector drawers in drawUnit.ts; anything not keyed falls back to vectors.
// Facing is a render-side concern only (derived from move deltas in IsoCanvas) —
// it never touches engine state.
//
// Two view modes:
//  - quad: ne/nw/se/sw.png — one sprite per diagonal (includes back views).
//  - duo (Polytopia-style): only se.png + sw.png front views exist; units moving
//    "up" simply reuse the front sprite of the matching horizontal direction
//    (ne→se, nw→sw). If one side's file is missing entirely, the other is
//    mirrored at draw time (flip).

/** Screen-diagonal facings: se = down-right (grid +x), sw = down-left (grid +y),
 *  ne = up-right (grid -y), nw = up-left (grid -x). */
export type Facing = 'ne' | 'nw' | 'se' | 'sw';

export const DEFAULT_FACING: Facing = 'se';

interface UnitSpriteDef {
  base: string;       // /units/<set> — expects <facing>.png files
  srcW: number;       // source canvas size (all views share it)
  srcH: number;
  footY: number;      // row in the source where the feet touch the ground
  drawW: number;      // on-map draw width in world px (height keeps aspect)
  /** Polytopia-style: only se/sw front views (ne/nw map onto them). */
  duo?: boolean;
}

// Rigbound Vanguard art (Units/Vanguard/<Folder>/-A sheets, split into SE/SW and
// body-anchor normalized: weapons excluded from centering and the foot row, feet
// on a shared row, body centerline on the canvas center). Duo facings only.
const vanguardDuo = (typeId: string, m: { srcW: number; srcH: number; footY: number; drawW: number }): UnitSpriteDef =>
  ({ base: `/units/vanguard/${typeId}`, duo: true, ...m });


// Keys are either `${factionId}:${typeId}` (sprite only for that team) or a bare
// `typeId` (sprite for every team). Faction-scoped entries win over bare ones.
// Every Vanguard unit class with Rigbound art carries a sprite; everything else
// (including all Hive units) keeps the vector drawers. Titan has only a SW view,
// so its SE renders via the mirror-at-draw fallback. Assault-mode tanks reuse
// the tank art.
const UNIT_SPRITES: Record<string, UnitSpriteDef> = {
  'vanguard:warrior':      vanguardDuo('warrior',  { srcW: 890,  srcH: 648, footY: 638, drawW: 99.2 }),
  'vanguard:scout':        vanguardDuo('scout',    { srcW: 659,  srcH: 507, footY: 497, drawW: 65.0 }),
  'vanguard:lancer':       vanguardDuo('lancer',   { srcW: 701,  srcH: 581, footY: 571, drawW: 87.5 }),
  'vanguard:defender':     vanguardDuo('defender', { srcW: 518,  srcH: 709, footY: 699, drawW: 57.1 }),
  'vanguard:sentinel':     vanguardDuo('sentinel', { srcW: 652,  srcH: 614, footY: 604, drawW: 72.0 }),
  'vanguard:stalker':      vanguardDuo('stalker',  { srcW: 582,  srcH: 781, footY: 771, drawW: 69.0 }),
  'vanguard:tank':         vanguardDuo('tank',     { srcW: 868,  srcH: 580, footY: 570, drawW: 93.0 }),
  'vanguard:tank_assault': vanguardDuo('tank',     { srcW: 868,  srcH: 580, footY: 570, drawW: 93.0 }),
  // Titan uses the -PIX pixel-art pair (real SE + SW views, unit_normalizer
  // output: 260x252 canvas, BODY-anchored so the drooping gun barrel doesn't
  // lift the feet off the tile; foot row 217) with magenta team-color masks.
  // drawW keeps the same world pixel scale as the 256-wide contract (x0.4141).
  'vanguard:titan':        vanguardDuo('titan',    { srcW: 260,  srcH: 252, footY: 217, drawW: 107.7 }),
  'vanguard:wraith':       vanguardDuo('wraith',   { srcW: 440,  srcH: 841, footY: 831, drawW: 44.0 }),

};

const QUAD_FACINGS: Facing[] = ['ne', 'nw', 'se', 'sw'];
const DUO_FACINGS: Facing[] = ['se', 'sw'];

// ── Team coloring ────────────────────────────────────────────────────────────
// Unit art carries MAGENTA mask panels where the team color belongs. On load,
// any sprite containing enough magenta gets one recolored canvas baked per
// team: the mask pixels' hue/sat are swapped for the (muted) team color while
// each pixel's value is kept, so panel shading survives the swap. Sprites
// without a mask (older photographic art) render unchanged.

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    if (mx === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (mx === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
    if (h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const MASK_HUE_MIN = 270, MASK_HUE_MAX = 335, MASK_SAT_MIN = 0.35;
const MIN_MASK_PIXELS = 64;

/** Bake a team-colored copy of img, or null if it has no magenta mask. */
function bakeTeamVariant(img: HTMLImageElement, teamHex: string): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const [tr, tg, tb] = hexToRgb(teamHex);
  const [th, ts, tv] = rgbToHsv(tr, tg, tb);
  let hits = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const [h, s, v] = rgbToHsv(px[i], px[i + 1], px[i + 2]);
    if (s >= MASK_SAT_MIN && h >= MASK_HUE_MIN && h <= MASK_HUE_MAX) {
      // keep the pixel's own shading (v, scaled so the brightest mask pixel
      // lands exactly on the team color's value), take the team hue, and scale
      // saturation by the mask's so soft glows stay soft.
      const [nr, ng, nb] = hsvToRgb(th, ts * s, v * tv);
      px[i] = nr; px[i + 1] = ng; px[i + 2] = nb;
      hits++;
    }
  }
  if (hits < MIN_MASK_PIXELS) return null;
  ctx.putImageData(data, 0, 0);
  return canvas;
}

interface LoadedSet {
  def: UnitSpriteDef;
  imgs: Partial<Record<Facing, HTMLImageElement>>;
  /** Per-facing, per-owner magenta-mask recolors (undefined = no mask). */
  team: Partial<Record<Facing, (HTMLCanvasElement | null)[]>>;
}

const loaded = new Map<string, LoadedSet>();
let started = false;

/** Kick off loading of all unit sprite sets. Safe to call repeatedly; invokes
 *  onReady once per image that finishes so the canvas can repaint. */
export function loadUnitSprites(onReady?: () => void): void {
  if (started) return;
  started = true;
  for (const [key, def] of Object.entries(UNIT_SPRITES)) {
    const set: LoadedSet = { def, imgs: {}, team: {} };
    loaded.set(key, set);
    for (const f of def.duo ? DUO_FACINGS : QUAD_FACINGS) {
      const img = new Image();
      img.onload = () => {
        set.imgs[f] = img;
        set.team[f] = TEAM_COLORS.map(c => bakeTeamVariant(img, c));
        onReady?.();
      };
      img.src = `${def.base}/${f}.png`;
    }
  }
}

/** Returns the sprite + draw metrics for a unit type & facing (plus whether to
 *  mirror horizontally), or null if the type has no sprite set for this faction
 *  or the image hasn't loaded. Faction-scoped sets win over global ones.
 *  Pass the owning player index to get the team-colored variant when the art
 *  carries a magenta team mask. */
export function getUnitSprite(
  typeId: string,
  facing: Facing,
  factionId?: string,
  owner?: number,
): { img: HTMLImageElement | HTMLCanvasElement; def: UnitSpriteDef; flip: boolean } | null {
  // Theme-scoped skin wins over the faction set, which wins over a global set.
  const theme = getActiveTheme();
  const set = (factionId ? loaded.get(`${theme}::${factionId}:${typeId}`) : undefined)
    ?? (factionId ? loaded.get(`${factionId}:${typeId}`) : undefined)
    ?? loaded.get(typeId);
  if (!set) return null;
  const pick = (f: Facing): HTMLImageElement | HTMLCanvasElement | undefined =>
    (owner != null ? set.team[f]?.[owner] : null) ?? set.imgs[f];
  // Duo sets have no back views: up-facing reuses the matching front view.
  const want: Facing = set.def.duo
    ? (facing === 'ne' ? 'se' : facing === 'nw' ? 'sw' : facing)
    : facing;
  let img = pick(want);
  if (img) return { img, def: set.def, flip: false };
  // Missing side: mirror the opposite front view if we have it.
  const opposite: Facing = want === 'se' ? 'sw' : want === 'sw' ? 'se' : want;
  img = pick(opposite);
  if (img) return { img, def: set.def, flip: true };
  img = pick(DEFAULT_FACING);
  return img ? { img, def: set.def, flip: false } : null;
}

/** Derive facing from a grid-space move delta (screen: +x = down-right, +y = down-left). */
export function facingFromDelta(dx: number, dy: number): Facing | null {
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'se' : 'nw';
  return dy > 0 ? 'sw' : 'ne';
}
