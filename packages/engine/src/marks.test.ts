import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, getVisibleState } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, techTreeEnabled: false, ...o });
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
const u = (s: GameState, id: number) => s.units.find(x => x.id === id);
const base = (o: Partial<GameConfig> = {}) => { // vanguard = player 0, hive = player 1
  const s = createGame(cfg(o), registry, ['vanguard', 'hive'], 7); s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0;
  for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) { const t = s.map.tiles[y][x]; if (!t.isCity) t.terrain = 'plains'; t.isResourceTile = false; }
  return s;
};
const marksOf = (s: GameState, viewer: number, id: number) => getVisibleState(s, viewer, registry).units.find(x => x.id === id)?.marks ?? [];

describe('Tracer Round — placement, duration, visibility', () => {
  it('a Medic plants a 3-turn tracer on an enemy', () => {
    let s = base();
    s.units.push(mk(1, 'medic', 0, 4, 4), mk(2, 'scuttling', 1, 5, 4));
    const cast = getLegalActions(s, registry, 0).find((a: any) => a.type === 'useAbility' && a.unitId === 1 && a.abilityId === 'tracer_round' && a.target.x === 5 && a.target.y === 4) as any;
    expect(cast).toBeTruthy();
    s = applyAction(s, cast, registry);
    const m = u(s, 2)!.marks!;
    expect(m.length).toBe(1);
    expect(m[0]).toMatchObject({ kind: 'tracer', owner: 0, turnsLeft: 3 });
  });

  it('the placer always sees the mark; the marked team only WITH detect', () => {
    let s = base();
    s.units.push(mk(1, 'medic', 0, 4, 4), mk(2, 'scuttling', 1, 5, 4));
    s = applyAction(s, { type: 'useAbility', unitId: 1, abilityId: 'tracer_round', target: { x: 5, y: 4 } } as any, registry);
    expect(marksOf(s, 0, 2).length).toBe(1);   // vanguard (placer) sees it
    expect(marksOf(s, 1, 2).length).toBe(0);   // hive (marked team) — no detector → hidden
    // A hive Seercaust (detect) adjacent to the scuttling reveals the mark to hive.
    s.units.push(mk(3, 'seercaust', 1, 6, 4));
    expect(marksOf(s, 1, 2).length).toBe(1);   // now hive sees it
  });

  it('a tracer reveals the traced enemy’s 3×3 to the placer through fog', () => {
    let s = base({ fogOfWar: true });
    s.units.push(mk(1, 'medic', 0, 4, 4), mk(2, 'scuttling', 1, 5, 4));
    s = applyAction(s, { type: 'useAbility', unitId: 1, abilityId: 'tracer_round', target: { x: 5, y: 4 } } as any, registry);
    s.units = s.units.filter(x => x.id !== 1); // medic leaves — only the tracer keeps sight now
    const vs = getVisibleState(s, 0, registry);
    expect(vs.visibility[4][5]).toBe('visible');      // the scuttling's tile
    expect(vs.visibility[4][6]).toBe('visible');      // a tile in its 3×3
    expect(vs.units.some(x => x.id === 2)).toBe(true); // and the unit itself
  });

  it('ticks down each of the marked unit’s turns and clears at 0', () => {
    let s = base();
    s.units.push(mk(1, 'medic', 0, 4, 4), mk(2, 'scuttling', 1, 5, 4));
    s = applyAction(s, { type: 'useAbility', unitId: 1, abilityId: 'tracer_round', target: { x: 5, y: 4 } } as any, registry);
    s = applyAction(s, { type: 'endTurn' }, registry); // p0 ends — no tick (not the marked team's turn)
    expect(u(s, 2)!.marks![0].turnsLeft).toBe(3);
    s = applyAction(s, { type: 'endTurn' }, registry); // p1 (hive) ends → 3→2
    expect(u(s, 2)!.marks![0].turnsLeft).toBe(2);
    s = applyAction(s, { type: 'endTurn' }, registry); s = applyAction(s, { type: 'endTurn' }, registry); // →1
    s = applyAction(s, { type: 'endTurn' }, registry); s = applyAction(s, { type: 'endTurn' }, registry); // →0, removed
    expect(u(s, 2)!.marks ?? []).toEqual([]);
  });
});

describe('Plant Explosives — 2 turns then detonate (5 attack)', () => {
  it('detonates for a 5-attack hit at the end of 2 marked-unit turns', () => {
    let s = base();
    s.units.push(mk(1, 'wraith', 0, 4, 4), { ...mk(2, 'behemoth', 1, 5, 4) }); // behemoth def 3, hp 40
    const cast = getLegalActions(s, registry, 0).find((a: any) => a.abilityId === 'plant_explosives' && a.target.x === 5 && a.target.y === 4) as any;
    expect(cast).toBeTruthy();
    s = applyAction(s, cast, registry);
    expect(u(s, 2)!.marks![0]).toMatchObject({ kind: 'explosive', turnsLeft: 2 });
    s = applyAction(s, { type: 'endTurn' }, registry); // p0
    s = applyAction(s, { type: 'endTurn' }, registry); // p1 → 2→1
    expect(u(s, 2)!.hp).toBe(40);                       // not yet
    s = applyAction(s, { type: 'endTurn' }, registry); // p0
    s = applyAction(s, { type: 'endTurn' }, registry); // p1 → 1→0 → DETONATE
    expect(u(s, 2)!.hp).toBeLessThan(40);              // took the 5-attack detonation
    expect(u(s, 2)!.hp).toBeGreaterThan(0);            // behemoth (40 HP, def 3) survives it
    expect(u(s, 2)!.marks ?? []).toEqual([]);          // mark consumed on detonation
  });
});

describe('Removing a mark', () => {
  const traced = () => {
    let s = base();
    s.units.push(mk(1, 'medic', 0, 4, 4), mk(2, 'scuttling', 1, 5, 4), mk(3, 'seercaust', 1, 6, 4));
    s = applyAction(s, { type: 'useAbility', unitId: 1, abilityId: 'tracer_round', target: { x: 5, y: 4 } } as any, registry);
    s.currentPlayer = 1; // hive's turn
    return s;
  };

  it('an adjacent detecting ally removes it and spends its attack; cannot remove its own', () => {
    let s = traced();
    const rm = getLegalActions(s, registry, 1).filter((a: any) => a.type === 'removeMark') as any[];
    expect(rm.some(a => a.unitId === 3 && a.target.x === 5 && a.target.y === 4)).toBe(true); // seercaust can remove
    expect(rm.some(a => a.unitId === 2)).toBe(false); // the scuttling can't remove its OWN mark
    s = applyAction(s, rm.find(a => a.unitId === 3)!, registry);
    expect(u(s, 2)!.marks ?? []).toEqual([]);   // gone
    expect(u(s, 3)!.hasAttacked).toBe(true);    // consumed the seercaust's attack/cast
  });

  it('cannot remove after already attacking, and no offer without detect', () => {
    // No detector: a plain warrior adjacent can't remove (mark not detect-visible to hive).
    let s = base();
    s.units.push(mk(1, 'medic', 0, 4, 4), mk(2, 'scuttling', 1, 5, 4), mk(4, 'warrior', 1, 6, 4));
    s = applyAction(s, { type: 'useAbility', unitId: 1, abilityId: 'tracer_round', target: { x: 5, y: 4 } } as any, registry);
    s.currentPlayer = 1;
    expect(getLegalActions(s, registry, 1).some((a: any) => a.type === 'removeMark')).toBe(false);
    // With a detector but the remover already attacked → not offered.
    let s2 = traced();
    u(s2, 3)!.hasAttacked = true;
    expect(getLegalActions(s2, registry, 1).some((a: any) => a.type === 'removeMark' && a.unitId === 3)).toBe(false);
  });
});
