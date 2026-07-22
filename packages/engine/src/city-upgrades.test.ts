import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getVisibleState, getLegalActions, calculatePlasmaIncome, getRecruitOptions } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const cap = (s: GameState, p = 0) => s.cities.find(c => c.isCapital && c.owner === p)!;
// Force a capital to `level` and ready to reach level+1, then apply a choice.
const levelChoice = (s: GameState, choice: string, level: number) => {
  const c = cap(s); c.level = level; c.supply = 999; s.currentPlayer = 0; s.players[0].ore = 9999;
  return applyAction(s, { type: 'levelUpCity', cityId: c.id, choice: choice as any }, registry);
};

describe('City level-up rewards (new)', () => {
  it('Plasma (+10/turn)', () => {
    let s = createGame(cfg(), registry, ['vanguard','hive'], 7);
    const before = calculatePlasmaIncome(s, 0, registry);
    s = levelChoice(s, 'plasma', 6);
    expect(cap(s).plasmaBonus).toBe(10);
    expect(calculatePlasmaIncome(s, 0, registry)).toBe(before + 10);
  });

  it('Conscription → recruit 20% cheaper', () => {
    let s = createGame(cfg(), registry, ['vanguard','hive'], 7);
    s.units = s.units.filter(u => !(u.position.x === cap(s).position.x && u.position.y === cap(s).position.y)); // free city tile
    const warriorCost = registry.unitTypes['warrior'].cost;
    s = levelChoice(s, 'conscription', 5);
    const opt = getRecruitOptions(s, registry, 0, cap(s).position).find(o => o.unitTypeId === 'warrior')!;
    expect(opt.cost).toBe(Math.round(warriorCost * 0.8));
  });

  it('Muster → recruited unit can move (not attack) the turn built', () => {
    let s = createGame(cfg(), registry, ['vanguard','hive'], 7);
    s.units = s.units.filter(u => u.owner !== 0); // clear player-0 units incl. the one on the city tile
    s = levelChoice(s, 'muster', 4);
    s.players[0].ore = 9999;
    s = applyAction(s, { type: 'recruit', unitTypeId: 'warrior', cityPosition: cap(s).position }, registry);
    const built = s.units.find(u => u.owner === 0 && u.typeId === 'warrior')!;
    expect(built.hasMoved).toBe(false);   // can move
    expect(built.hasAttacked).toBe(true); // but not attack
  });

  it('Detect → exposes a cloaked enemy in the city 3×3', () => {
    let s = createGame(cfg(), registry, ['vanguard','hive'], 7);
    const c = cap(s, 0);
    // an enemy cloaked wraith adjacent to the capital
    s.units.push({ id: 900, typeId:'wraith', owner:1, position:{x:c.position.x+1, y:c.position.y}, hp:15, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
    expect(getVisibleState(s, 0, registry).units.some(u => u.id===900)).toBe(false); // cloaked → hidden
    s = levelChoice(s, 'detect', 4);
    expect(getVisibleState(s, 0, registry).units.some(u => u.id===900)).toBe(true); // now exposed
  });

  it('Hero is never offered as a legal level-up action', () => {
    let s = createGame(cfg(), registry, ['vanguard','hive'], 7);
    const c = cap(s); c.level = 5; c.supply = 999; s.currentPlayer = 0;
    const acts = getLegalActions(s, registry, 0).filter(a => a.type==='levelUpCity' && (a as any).cityId===c.id);
    // reaching L6 = { hero, conscription } → only conscription is offered.
    expect(acts.map((a:any)=>a.choice)).toEqual(['conscription']);
  });
});
