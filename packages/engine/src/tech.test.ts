import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, getLegalActions,
  techCost, isTechAvailable, isUnitUnlocked, getModifier, calculateOreIncome,
  canBuild, canUpgradeBuilding, cityAt,
} from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { DataRegistry, GameConfig, GameState, Coord, CityState } from './types.js';

function getRegistry(): DataRegistry { return buildRegistry(); }
function getConfig(o: Partial<GameConfig> = {}): GameConfig { return { ...defaultConfig, fogOfWar: false, ...o }; }
function capitalOf(s: GameState, p = 0): CityState {
  const c = s.cities.find(c => c.isCapital && c.owner === p);
  if (!c) throw new Error('no capital'); return c;
}
function makeTile(s: GameState, c: Coord, dx: number, dy: number, kind: 'ore' | 'plasma' | null): Coord {
  const pos = { x: c.x + dx, y: c.y + dy };
  const t = s.map.tiles[pos.y][pos.x];
  t.terrain = 'plains'; t.isCity = false;
  t.isResourceTile = kind !== null; t.resourceKind = kind;
  return pos;
}

describe('Tech cost scales with city count', () => {
  it('L1/L2/L3 = 50/60/70 at one city, +10/+20/+30 per extra city', () => {
    const r = getRegistry();
    expect([techCost(1, 1, r), techCost(2, 1, r), techCost(3, 1, r)]).toEqual([50, 60, 70]);
    expect([techCost(1, 2, r), techCost(2, 2, r), techCost(3, 2, r)]).toEqual([60, 80, 100]);
    expect([techCost(1, 3, r), techCost(2, 3, r), techCost(3, 3, r)]).toEqual([70, 100, 130]);
  });
});

describe('Branch-unlock rule', () => {
  it('L2 techs are locked until an L1 in the same branch is researched', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    state.players[0].ore = 200;

    expect(isTechAvailable(state, 0, r.techs['drilling'], r)).toBe(true);
    expect(isTechAvailable(state, 0, r.techs['prospecting'], r)).toBe(true);
    expect(isTechAvailable(state, 0, r.techs['slag_wash'], r)).toBe(false);
    expect(isTechAvailable(state, 0, r.techs['plasma_tap'], r)).toBe(false);

    state = applyAction(state, { type: 'research', techId: 'prospecting' }, r);
    expect(state.players[0].researchedTechs).toContain('prospecting');
    expect(isTechAvailable(state, 0, r.techs['slag_wash'], r)).toBe(true);
    expect(isTechAvailable(state, 0, r.techs['plasma_tap'], r)).toBe(true);
    expect(isTechAvailable(state, 0, r.techs['refineries'], r)).toBe(true);
  });
});

describe('Research deducts the city-scaled cost', () => {
  it('one city: L1 costs 50; two cities: L1 costs 60', () => {
    const r = getRegistry();
    let s1 = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    s1.players[0].ore = 80;
    s1 = applyAction(s1, { type: 'research', techId: 'drilling' }, r);
    expect(s1.players[0].ore).toBe(30); // 80 - 50

    let s2 = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    s2.players[0].ore = 80;
    s2.cities.push({ id: 999, position: { x: 0, y: 0 }, owner: 0, isCapital: false, level: 1, supply: 0, incomeBonus: 0, popBonus: 0, bonusSupply: 0, fortified: false, extraTerritory: [] });
    s2 = applyAction(s2, { type: 'research', techId: 'drilling' }, r);
    expect(s2.players[0].ore).toBe(20); // 80 - 60 (two cities)
  });
});

describe('Slag Wash boosts mine output', () => {
  it('+10% to mine output once researched', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].ore = 300;
    const a = makeTile(state, cap.position, 1, 0, 'ore');
    state = applyAction(state, { type: 'build', kind: 'mine', position: a }, r);

    const before = calculateOreIncome(state, 0, r);
    expect(getModifier(state.players[0], r, 'mineOutputBonus')).toBe(0);
    state = applyAction(state, { type: 'research', techId: 'prospecting' }, r); // unlock L2
    state = applyAction(state, { type: 'research', techId: 'slag_wash' }, r);
    expect(getModifier(state.players[0], r, 'mineOutputBonus')).toBe(0.1);
    expect(calculateOreIncome(state, 0, r)).toBe(before + 1); // 10 -> 11
  });
});

describe('Tech gates on buildings', () => {
  it('extractor is buildable on a plasma vent with no tech (mirrors the mine)', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].ore = 300;
    const p = makeTile(state, cap.position, 1, 0, 'plasma');
    // No tech gate: an owned plasma vent is buildable immediately, like a mine on ore.
    expect(canBuild(state, r, 0, 'extractor', p)).toBe(true);
  });

  it('Refineries gates the refinery', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].ore = 400;
    const m = makeTile(state, cap.position, 1, 0, 'ore');
    state = applyAction(state, { type: 'build', kind: 'mine', position: m }, r);
    const ref = makeTile(state, cap.position, 0, 1, null); // land, adjacent to the mine
    expect(canBuild(state, r, 0, 'refinery', ref)).toBe(false);
    state = applyAction(state, { type: 'research', techId: 'prospecting' }, r);
    state = applyAction(state, { type: 'research', techId: 'refineries' }, r);
    expect(canBuild(state, r, 0, 'refinery', ref)).toBe(true);
  });

  it('Drilling gates the mine L2 upgrade', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].ore = 400;
    const m = makeTile(state, cap.position, 1, 0, 'ore');
    state = applyAction(state, { type: 'build', kind: 'mine', position: m }, r);
    expect(canUpgradeBuilding(state, r, 0, m)).toBe(false); // no Drilling
    state = applyAction(state, { type: 'research', techId: 'drilling' }, r);
    expect(canUpgradeBuilding(state, r, 0, m)).toBe(true);
  });
});

describe('Armory branch', () => {
  it('L2 Armory techs unlock after any L1 Armory tech', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    state.players[0].ore = 300;
    expect(isTechAvailable(state, 0, r.techs['small_arms'], r)).toBe(true);
    expect(isTechAvailable(state, 0, r.techs['forge'], r)).toBe(false);
    state = applyAction(state, { type: 'research', techId: 'small_arms' }, r);
    expect(isTechAvailable(state, 0, r.techs['forge'], r)).toBe(true);
    expect(isTechAvailable(state, 0, r.techs['mech_bay'], r)).toBe(true);
  });

  it('locked L3 techs are never researchable', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    state.players[0].ore = 1000;
    state = applyAction(state, { type: 'research', techId: 'small_arms' }, r);
    state = applyAction(state, { type: 'research', techId: 'forge' }, r); // L2 done → L3 prereq met
    expect(isTechAvailable(state, 0, r.techs['reactive_plating'], r)).toBe(false); // but locked
    const research = getLegalActions(state, r, 0).filter(a => a.type === 'research').map(a => (a as { techId: string }).techId);
    expect(research).not.toContain('reactive_plating');
    expect(research).not.toContain('replicator');
  });

  it('tech-locks units behind unlockUnit techs', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    expect(isUnitUnlocked(state, 0, 'warrior', r)).toBe(true); // not gated by any tech
    expect(isUnitUnlocked(state, 0, 'marksman', r)).toBe(false); // gated by Small Arms
    state.players[0].ore = 100;
    state = applyAction(state, { type: 'research', techId: 'small_arms' }, r);
    expect(isUnitUnlocked(state, 0, 'marksman', r)).toBe(true);
  });
});
