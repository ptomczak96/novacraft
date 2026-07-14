import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, getSlashArc, slashHitDamage } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit, SlashAction } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const plains = (s: GameState) => { for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) s.map.tiles[y][x].terrain = 'plains'; };
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
const hp = (s: GameState, id: number) => s.units.find(u => u.id === id)?.hp;

describe('getSlashArc geometry', () => {
  it('an orthogonal centre yields the two diagonal side tiles (its ring-neighbours)', () => {
    // Unit at (1,1); centre East = (2,1) → sides (2,0) and (2,2).
    const arc = getSlashArc({ x: 1, y: 1 }, { x: 2, y: 1 });
    expect(arc[0]).toEqual({ coord: { x: 2, y: 1 }, isCenter: true });
    const sides = arc.slice(1).map(a => a.coord).sort((a, b) => a.y - b.y);
    expect(sides).toEqual([{ x: 2, y: 0 }, { x: 2, y: 2 }]);
    expect(arc.slice(1).every(a => !a.isCenter)).toBe(true);
  });

  it('a corner (diagonal) centre yields its orthogonal ring-neighbours, not every adjacent tile', () => {
    // Unit at (1,1); centre SE corner = (2,2) → sides (2,1) and (1,2).
    const arc = getSlashArc({ x: 1, y: 1 }, { x: 2, y: 2 });
    expect(arc[0].coord).toEqual({ x: 2, y: 2 });
    const sides = arc.slice(1).map(a => a.coord);
    expect(sides).toContainEqual({ x: 2, y: 1 });
    expect(sides).toContainEqual({ x: 1, y: 2 });
    expect(sides).not.toContainEqual({ x: 1, y: 0 }); // the over-selection bug would add this
  });
});

describe('slashHitDamage split', () => {
  it('centre takes full damage; sides take 50% floored at minimumDamage', () => {
    expect(slashHitDamage(6, true, 1)).toBe(6);
    expect(slashHitDamage(6, false, 1)).toBe(3);
    expect(slashHitDamage(1, false, 1)).toBe(1); // floor keeps a glancing hit
  });
});

describe('Vindrace Slash (engine)', () => {
  const base = () => {
    let s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    s.units = []; s.unitHomeCity = {}; s.currentPlayer = 1; plains(s);
    return s;
  };

  it('offers Slash (not a normal attack) and no single-target attack for the Vindrace', () => {
    const s = base();
    s.units.push(mk(1, 'vindrace', 1, 3, 3), mk(2, 'warrior', 0, 4, 3));
    const acts = getLegalActions(s, registry, 1).filter(a => 'unitId' in a && a.unitId === 1);
    expect(acts.some(a => a.type === 'slash')).toBe(true);
    expect(acts.some(a => a.type === 'attack')).toBe(false);
  });

  it('hits all three arc tiles: centre 100%, sides 50%', () => {
    let s = base();
    // Vindrace at (3,3); slash centre East (4,3). Arc = (4,3) centre, (4,2)/(4,4) sides.
    s.units.push(
      mk(1, 'vindrace', 1, 3, 3),
      mk(2, 'defender', 0, 4, 3), // centre (tanky enough to survive & measure)
      mk(3, 'defender', 0, 4, 2), // side
      mk(4, 'defender', 0, 4, 4), // side
    );
    const before = registry.unitTypes['defender'].maxHP;
    s = applyAction(s, { type: 'slash', unitId: 1, target: { x: 4, y: 3 } } as SlashAction, registry);
    const centreDmg = before - hp(s, 2)!;
    const sideDmg = before - hp(s, 3)!;
    expect(centreDmg).toBeGreaterThan(0);
    expect(sideDmg).toBeGreaterThan(0);
    expect(sideDmg).toBe(slashHitDamage(centreDmg, false, s.config.combatConfig.minimumDamage));
    expect(before - hp(s, 4)!).toBe(sideDmg); // both sides equal
  });

  it('hits enemies only — a friendly unit in the arc is untouched', () => {
    let s = base();
    s.units.push(
      mk(1, 'vindrace', 1, 3, 3),
      mk(2, 'defender', 0, 4, 3),  // enemy centre
      mk(5, 'reaper', 1, 4, 2),    // friendly side — must be unharmed
    );
    const reaperHP = hp(s, 5);
    s = applyAction(s, { type: 'slash', unitId: 1, target: { x: 4, y: 3 } } as SlashAction, registry);
    expect(hp(s, 5)).toBe(reaperHP);
    expect(hp(s, 2)!).toBeLessThan(registry.unitTypes['defender'].maxHP);
  });

  it('provokes no retaliation — the Vindrace takes no damage', () => {
    let s = base();
    s.units.push(mk(1, 'vindrace', 1, 3, 3), mk(2, 'warrior', 0, 4, 3));
    const vhp = hp(s, 1);
    s = applyAction(s, { type: 'slash', unitId: 1, target: { x: 4, y: 3 } } as SlashAction, registry);
    expect(hp(s, 1)).toBe(vhp);
    // Slashing spends the turn: no further move/slash offered.
    const acts = getLegalActions(s, registry, 1).filter(a => 'unitId' in a && a.unitId === 1);
    expect(acts.some(a => a.type === 'slash' || a.type === 'move')).toBe(false);
  });

  it('removes a unit killed by the slash', () => {
    let s = base();
    s.units.push(mk(1, 'vindrace', 1, 3, 3), { ...mk(2, 'scuttling', 0, 4, 3), hp: 1 });
    s = applyAction(s, { type: 'slash', unitId: 1, target: { x: 4, y: 3 } } as SlashAction, registry);
    expect(s.units.find(u => u.id === 2)).toBeUndefined();
  });
});
