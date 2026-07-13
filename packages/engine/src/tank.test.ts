import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit, UseAbilityAction } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const plains = (s: GameState) => { for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) s.map.tiles[y][x].terrain = 'plains'; };
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
const u = (s: GameState, id: number) => s.units.find(x => x.id === id)!;
const base = () => {
  let s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
  s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0; plains(s);
  return s;
};
const assault = (): UseAbilityAction => ({ type: 'useAbility', unitId: 1, abilityId: 'assault_mode', target: { x: 0, y: 0 } });

describe('Tank: Assault Mode toggle', () => {
  it('offers a self-cast Assault Mode ability and morphs the tank, keeping id/hp/position', () => {
    let s = base();
    s.units.push({ ...mk(1, 'tank', 0, 3, 3), hp: 22 });
    const acts = getLegalActions(s, registry, 0).filter(a => a.type === 'useAbility') as UseAbilityAction[];
    expect(acts.some(a => a.abilityId === 'assault_mode')).toBe(true);

    s = applyAction(s, assault(), registry);
    const tank = u(s, 1);
    expect(tank.typeId).toBe('tank_assault'); // morphed
    expect(tank.hp).toBe(22);                  // hp preserved
    expect(tank.position).toEqual({ x: 3, y: 3 });
    expect(tank.hasAttacked).toBe(true);       // toggling spent the turn
  });

  it('toggling back to normal also spends a turn', () => {
    let s = base();
    s.units.push(mk(1, 'tank_assault', 0, 3, 3));
    s = applyAction(s, assault(), registry);
    expect(u(s, 1).typeId).toBe('tank');
    expect(u(s, 1).hasAttacked).toBe(true);
  });
});

describe('Tank: banded range (assault mode = range 2–3 only)', () => {
  it('an assault tank cannot target range 1, but can target range 2 and 3', () => {
    const canHitAt = (dist: number) => {
      const s = base();
      s.units.push(mk(1, 'tank_assault', 0, 3, 3), mk(2, 'warrior', 1, 3 + dist, 3));
      return getLegalActions(s, registry, 0).some(a => a.type === 'attack' && a.unitId === 1 && a.targetId === 2);
    };
    expect(canHitAt(1)).toBe(false); // too close (min 2)
    expect(canHitAt(2)).toBe(true);
    expect(canHitAt(3)).toBe(true);
    expect(canHitAt(4)).toBe(false); // beyond max (3)
  });

  it('a normal tank (range 2, no min) can hit range 1 and 2', () => {
    const canHitAt = (dist: number) => {
      const s = base();
      s.units.push(mk(1, 'tank', 0, 3, 3), mk(2, 'warrior', 1, 3 + dist, 3));
      return getLegalActions(s, registry, 0).some(a => a.type === 'attack' && a.unitId === 1 && a.targetId === 2);
    };
    expect(canHitAt(1)).toBe(true);
    expect(canHitAt(2)).toBe(true);
    expect(canHitAt(3)).toBe(false);
  });

  it('an adjacent attacker takes NO retaliation from an assault tank (out of its band)', () => {
    let s = base();
    s.currentPlayer = 1; // hive attacks
    s.units.push(mk(1, 'tank_assault', 0, 5, 5), mk(2, 'reaper', 1, 5, 4)); // adjacent (dist 1)
    const before = u(s, 2).hp;
    s = applyAction(s, { type: 'attack', unitId: 2, targetId: 1 }, registry);
    const reaper = s.units.find(x => x.id === 2);
    if (reaper) expect(reaper.hp).toBe(before); // no retaliation dealt
  });
});
