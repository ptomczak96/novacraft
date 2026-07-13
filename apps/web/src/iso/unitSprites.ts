// Directional unit sprites. Units keyed here render from 4-view PNG art instead
// of the vector drawers in drawUnit.ts; anything not keyed falls back to vectors.
// Facing is a render-side concern only (derived from move deltas in IsoCanvas) —
// it never touches engine state.

/** Screen-diagonal facings: se = down-right (grid +x), sw = down-left (grid +y),
 *  ne = up-right (grid -y), nw = up-left (grid -x). */
export type Facing = 'ne' | 'nw' | 'se' | 'sw';

export const DEFAULT_FACING: Facing = 'se';

interface UnitSpriteDef {
  base: string;       // /units/<set> — expects ne.png / nw.png / se.png / sw.png
  srcW: number;       // source canvas size (all 4 views share it)
  srcH: number;
  footY: number;      // row in the source where the feet touch the ground
  drawW: number;      // on-map draw width in world px (height keeps aspect)
}

// Keys are either `${factionId}:${typeId}` (sprite only for that team) or a bare
// `typeId` (sprite for every team). Faction-scoped entries win over bare ones.
const UNIT_SPRITES: Record<string, UnitSpriteDef> = {
  // Vanguard warrior [variation] — the Vanguard team's basic melee unit, mapped
  // to the Ironclad Dominion faction; other factions keep their vector drawers.
  // Body-anchored normalization (sword excluded from centering/foot row):
  // 433×397 views, body centerline on the canvas center, feet at row 385, body
  // 373px tall. drawW keeps the figure ≈70px tall on screen (70·433/373).
  'ironclad:warrior': {
    base: '/units/vanguard_warrior',
    srcW: 433, srcH: 397, footY: 385,
    drawW: 81.3,
  },
};

const FACINGS: Facing[] = ['ne', 'nw', 'se', 'sw'];

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
  for (const [typeId, def] of Object.entries(UNIT_SPRITES)) {
    const set: LoadedSet = { def, imgs: {} };
    loaded.set(typeId, set);
    for (const f of FACINGS) {
      const img = new Image();
      img.onload = () => { set.imgs[f] = img; onReady?.(); };
      img.src = `${def.base}/${f}.png`;
    }
  }
}

/** Returns the sprite + draw metrics for a unit type & facing, or null if the
 *  type has no sprite set for this faction (or its image hasn't loaded yet).
 *  Faction-scoped sets (`faction:type`) take precedence over global (`type`). */
export function getUnitSprite(
  typeId: string,
  facing: Facing,
  factionId?: string,
): { img: HTMLImageElement; def: UnitSpriteDef } | null {
  const set = (factionId ? loaded.get(`${factionId}:${typeId}`) : undefined)
    ?? loaded.get(typeId);
  if (!set) return null;
  const img = set.imgs[facing] ?? set.imgs[DEFAULT_FACING];
  return img ? { img, def: set.def } : null;
}

/** Derive facing from a grid-space move delta (screen: +x = down-right, +y = down-left). */
export function facingFromDelta(dx: number, dy: number): Facing | null {
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'se' : 'nw';
  return dy > 0 ? 'sw' : 'ne';
}
