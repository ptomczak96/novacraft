import type { Coord } from './types.js';

// The 8 neighbour offsets around a unit, in ring (clockwise) order starting North.
// A "Slash" hits three consecutive tiles along this ring: the middle one is the
// central (100% damage) tile, the two ends are the side (50% damage) tiles. So the
// two side tiles are always the ring-neighbours of the chosen central tile — NOT
// every tile adjacent to both (which would over-select). See docs/conditions.md.
const RING: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

/**
 * The tiles a Slash hits, given the attacker's position and the chosen central
 * tile (one of the attacker's 8 neighbours). Returns the central tile first
 * (`isCenter: true`, 100% damage), then its two ring-neighbours (the 50% side
 * tiles). Callers should bounds-check the coords against the map before use.
 */
export function getSlashArc(
  attackerPos: Coord,
  center: Coord,
): { coord: Coord; isCenter: boolean }[] {
  const cdx = center.x - attackerPos.x;
  const cdy = center.y - attackerPos.y;
  const i = RING.findIndex(([dx, dy]) => dx === cdx && dy === cdy);
  if (i < 0) return [{ coord: center, isCenter: true }]; // center not a neighbour
  const [pdx, pdy] = RING[(i + 7) % 8];
  const [ndx, ndy] = RING[(i + 1) % 8];
  return [
    { coord: center, isCenter: true },
    { coord: { x: attackerPos.x + pdx, y: attackerPos.y + pdy }, isCenter: false },
    { coord: { x: attackerPos.x + ndx, y: attackerPos.y + ndy }, isCenter: false },
  ];
}

/**
 * Damage a Slash deals to a unit on one of its arc tiles: the central tile takes
 * the full computed damage; the two side tiles take 50% (floored at minimumDamage
 * so a glancing hit still lands). Single-sourced so the engine and the UI preview
 * agree exactly.
 */
export function slashHitDamage(fullDamage: number, isCenter: boolean, minimumDamage: number): number {
  return isCenter ? fullDamage : Math.max(minimumDamage, Math.round(fullDamage * 0.5));
}
