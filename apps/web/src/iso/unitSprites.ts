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
// Only the four recruitable Vanguard units carry sprites; everything else
// (including all Hive units) keeps the vector drawers.
const UNIT_SPRITES: Record<string, UnitSpriteDef> = {
  'vanguard:warrior':  vanguardDuo('warrior',  { srcW: 890, srcH: 648, footY: 638, drawW: 99.2 }),
  'vanguard:scout':    vanguardDuo('scout',    { srcW: 659, srcH: 507, footY: 497, drawW: 65.0 }),
  'vanguard:lancer':   vanguardDuo('lancer',   { srcW: 701, srcH: 581, footY: 571, drawW: 87.5 }),
  'vanguard:defender': vanguardDuo('defender', { srcW: 518, srcH: 709, footY: 699, drawW: 57.1 }),
};

const QUAD_FACINGS: Facing[] = ['ne', 'nw', 'se', 'sw'];
const DUO_FACINGS: Facing[] = ['se', 'sw'];

interface LoadedSet {
  def: UnitSpriteDef;
  imgs: Partial<Record<Facing, HTMLImageElement>>;
}

const loaded = new Map<string, LoadedSet>();
let started = false;

/** Kick off loading of all unit sprite sets. Safe to call repeatedly; invokes
 *  onReady once per image that finishes so the canvas can repaint. */
export function loadUnitSprites(onReady?: () => void): void {
  if (started) return;
  started = true;
  for (const [key, def] of Object.entries(UNIT_SPRITES)) {
    const set: LoadedSet = { def, imgs: {} };
    loaded.set(key, set);
    for (const f of def.duo ? DUO_FACINGS : QUAD_FACINGS) {
      const img = new Image();
      img.onload = () => { set.imgs[f] = img; onReady?.(); };
      img.src = `${def.base}/${f}.png`;
    }
  }
}

/** Returns the sprite + draw metrics for a unit type & facing (plus whether to
 *  mirror horizontally), or null if the type has no sprite set for this faction
 *  or the image hasn't loaded. Faction-scoped sets win over global ones. */
export function getUnitSprite(
  typeId: string,
  facing: Facing,
  factionId?: string,
): { img: HTMLImageElement; def: UnitSpriteDef; flip: boolean } | null {
  const set = (factionId ? loaded.get(`${factionId}:${typeId}`) : undefined)
    ?? loaded.get(typeId);
  if (!set) return null;
  // Duo sets have no back views: up-facing reuses the matching front view.
  const want: Facing = set.def.duo
    ? (facing === 'ne' ? 'se' : facing === 'nw' ? 'sw' : facing)
    : facing;
  let img = set.imgs[want];
  if (img) return { img, def: set.def, flip: false };
  // Missing side: mirror the opposite front view if we have it.
  const opposite: Facing = want === 'se' ? 'sw' : want === 'sw' ? 'se' : want;
  img = set.imgs[opposite];
  if (img) return { img, def: set.def, flip: true };
  img = set.imgs[DEFAULT_FACING];
  return img ? { img, def: set.def, flip: false } : null;
}

/** Derive facing from a grid-space move delta (screen: +x = down-right, +y = down-left). */
export function facingFromDelta(dx: number, dy: number): Facing | null {
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'se' : 'nw';
  return dy > 0 ? 'sw' : 'ne';
}
