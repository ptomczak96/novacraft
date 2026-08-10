import {
  isExpansionTileEligible, enumerateVolleyGrids, wyrmStrikePairs,
} from '@tactica/engine';
import type { Coord, GameState, DataRegistry, CityState } from '@tactica/engine';

/**
 * Tile-picker eligibility helpers shared by BOTH renderers (2D iso canvas and
 * the GEN 8 voxel arena). Game logic only — no drawing. Everything derives
 * from engine helpers so UI and engine agree exactly on legal shapes.
 * (Hoisted out of IsoCanvas so the 3D renderer's click routing can reuse it.)
 */

/** Greedily keep the picks that still form a valid chain (drops any tile
 *  orphaned when an earlier pick it depended on is removed). */
export function coherentSubset(
  state: GameState, registry: DataRegistry, city: CityState, picks: Coord[],
): Coord[] {
  const accepted: Coord[] = [];
  const remaining = [...picks];
  let progress = true;
  while (remaining.length && progress) {
    progress = false;
    for (let i = 0; i < remaining.length; i++) {
      if (isExpansionTileEligible(state, registry, city, remaining[i], accepted)) {
        accepted.push(remaining[i]);
        remaining.splice(i, 1);
        progress = true;
        break;
      }
    }
  }
  return accepted;
}

/** Ballistic Volley picker: tiles still tickable given current picks (any tile
 *  that, together with the picks, fits one legal 2×2 grid) + completion. */
export function volleyPicker(
  state: GameState, registry: DataRegistry,
  sel: { unitId: number; abilityId: string; picks: Coord[] },
): { eligible: Coord[]; done: boolean } {
  const unit = state.units.find(u => u.id === sel.unitId);
  const ability = unit && registry.unitTypes[unit.typeId]?.abilities.find(a => a.id === sel.abilityId);
  if (!unit || !ability) return { eligible: [], done: false };
  const grids = enumerateVolleyGrids(unit.position, state.map.width, state.map.height, ability.minRange ?? 0, ability.range ?? 0);
  const has = (g: Coord[], c: Coord) => g.some(t => t.x === c.x && t.y === c.y);
  const candidates = grids.filter(g => sel.picks.every(p => has(g, p)));
  const done = sel.picks.length === 4 && candidates.length > 0;
  if (done || sel.picks.length >= 4) return { eligible: [], done };
  const seen = new Set(sel.picks.map(p => `${p.x},${p.y}`));
  const eligible: Coord[] = [];
  for (const g of candidates) for (const c of g) {
    const k = `${c.x},${c.y}`;
    if (!seen.has(k)) { seen.add(k); eligible.push(c); }
  }
  return { eligible, done };
}

/** Wyrm strike picker: pick 1 = primary (within the Wyrm's 3×3); pick 2 = a
 *  cell touching the primary. */
export function strikePicker(
  state: GameState, registry: DataRegistry,
  sel: { unitId: number; picks: Coord[] },
): { eligible: Coord[]; done: boolean } {
  const unit = state.units.find(u => u.id === sel.unitId);
  if (!unit) return { eligible: [], done: false };
  if (sel.picks.length >= 2) return { eligible: [], done: true };
  const pairs = wyrmStrikePairs(unit.position, state.map.width, state.map.height);
  const same = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y;
  const seen = new Set<string>();
  const eligible: Coord[] = [];
  const push = (c: Coord) => { const k = `${c.x},${c.y}`; if (!seen.has(k)) { seen.add(k); eligible.push(c); } };
  if (sel.picks.length === 0) {
    for (const [p] of pairs) push(p);
  } else {
    const primary = sel.picks[0];
    for (const [p, q] of pairs) if (same(p, primary)) push(q);
  }
  return { eligible, done: false };
}
