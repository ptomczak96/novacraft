import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, getVisibleState } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit, UseAbilityAction } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const plains = (s: GameState) => { for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) s.map.tiles[y][x].terrain = 'plains'; };
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
const base = (current = 0) => {
  let s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
  s.units = []; s.unitHomeCity = {}; s.currentPlayer = current; plains(s);
  return s;
};
const sees = (s: GameState, viewer: 0 | 1, id: number) =>
  getVisibleState(s, viewer, registry).units.some(u => u.id === id);

describe('Wraith: Cloak & Detect', () => {
  it('a cloaked wraith is hidden from the enemy (even with fog off) but visible to its owner', () => {
    const s = base();
    s.units.push(mk(1, 'wraith', 0, 3, 3), mk(2, 'warrior', 1, 6, 6));
    expect(sees(s, 0, 1)).toBe(true);  // owner sees it
    expect(sees(s, 1, 1)).toBe(false); // enemy does not
    expect(sees(s, 1, 2)).toBe(true);  // enemy still sees the (non-cloaked) warrior
  });

  it('an adjacent enemy Detect unit reveals the cloaked wraith', () => {
    const s = base();
    s.units.push(mk(1, 'wraith', 0, 3, 3), mk(2, 'seercaust', 1, 3, 4)); // seercaust has "detect", adjacent
    expect(sees(s, 1, 1)).toBe(true);
  });

  it('a non-adjacent Detect unit does NOT reveal it (detect range = 1 for now)', () => {
    const s = base();
    s.units.push(mk(1, 'wraith', 0, 3, 3), mk(2, 'seercaust', 1, 3, 6)); // 3 tiles away
    expect(sees(s, 1, 1)).toBe(false);
  });

  it('a "marked" wraith is exposed to the enemy', () => {
    const s = base();
    s.units.push({ ...mk(1, 'wraith', 0, 3, 3), statuses: ['marked'] }, mk(2, 'warrior', 1, 6, 6));
    expect(sees(s, 1, 1)).toBe(true);
  });
});

describe('Wraith: Stun', () => {
  const stun = (targetPos: { x: number; y: number }): UseAbilityAction =>
    ({ type: 'useAbility', unitId: 1, abilityId: 'stun', target: targetPos });

  it('offers Stun against enemies within range 3 (not allies, not out of range)', () => {
    const s = base();
    s.units.push(
      mk(1, 'wraith', 0, 3, 3),
      mk(2, 'warrior', 1, 6, 3),  // enemy, dist 3 → offered
      mk(3, 'warrior', 0, 4, 3),  // ally → not offered
      mk(4, 'warrior', 1, 7, 3),  // enemy, dist 4 → not offered
    );
    const acts = getLegalActions(s, registry, 0).filter(a => a.type === 'useAbility' && a.abilityId === 'stun') as UseAbilityAction[];
    const t = acts.map(a => `${a.target.x},${a.target.y}`);
    expect(t).toContain('6,3');
    expect(t).not.toContain('4,3');
    expect(t).not.toContain('7,3');
  });

  it('a stunned unit cannot move or attack on its next turn, then recovers', () => {
    let s = base(0);
    s.units.push(mk(1, 'wraith', 0, 3, 3), mk(2, 'warrior', 1, 5, 3));
    s = applyAction(s, stun({ x: 5, y: 3 }), registry);
    expect(s.units.find(u => u.id === 2)!.statuses).toContain('stunned');

    // Hive's turn: the stunned warrior gets no actions.
    s = applyAction(s, { type: 'endTurn' }, registry);
    expect(getLegalActions(s, registry, 1).some(a => 'unitId' in a && a.unitId === 2)).toBe(false);

    // End hive's turn (clears the stun) → back to vanguard → next hive turn it can act.
    s = applyAction(s, { type: 'endTurn' }, registry); // hive → vanguard
    expect(s.units.find(u => u.id === 2)!.statuses ?? []).not.toContain('stunned');
    s = applyAction(s, { type: 'endTurn' }, registry); // vanguard → hive again
    expect(getLegalActions(s, registry, 1).some(a => 'unitId' in a && a.unitId === 2)).toBe(true);
  });

  it('Plant Explosives (disabled placeholder) is never offered as an action', () => {
    const s = base();
    s.units.push(mk(1, 'wraith', 0, 3, 3), mk(2, 'warrior', 1, 4, 3));
    const acts = getLegalActions(s, registry, 0).filter(a => a.type === 'useAbility') as UseAbilityAction[];
    expect(acts.some(a => a.abilityId === 'plant_explosives')).toBe(false);
  });
});
