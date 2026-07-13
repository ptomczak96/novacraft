import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, getLegalActions, getRecruitOptions,
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

  it('the refinery has no tech gate — buildable as soon as a mine is adjacent', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].ore = 400;
    const m = makeTile(state, cap.position, 1, 0, 'ore');
    const ref = makeTile(state, cap.position, 0, 1, null); // land, adjacent to the mine site
    expect(canBuild(state, r, 0, 'refinery', ref)).toBe(false); // no mine yet
    state = applyAction(state, { type: 'build', kind: 'mine', position: m }, r);
    expect(canBuild(state, r, 0, 'refinery', ref)).toBe(true);  // mine adjacent, no tech needed
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
  it('Armory DAG: Mech Bay needs Forge (not Small Arms); Crucible needs Forge', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    state.players[0].ore = 1000;
    // small_arms and forge are both L1 roots (available from the start).
    expect(isTechAvailable(state, 0, r.techs['small_arms'], r)).toBe(true);
    expect(isTechAvailable(state, 0, r.techs['forge'], r)).toBe(true);
    // Mech Bay / Crucible are gated behind Forge specifically.
    expect(isTechAvailable(state, 0, r.techs['mech_bay'], r)).toBe(false);
    state = applyAction(state, { type: 'research', techId: 'small_arms' }, r);
    expect(isTechAvailable(state, 0, r.techs['mech_bay'], r)).toBe(false); // small_arms doesn't unlock it
    state = applyAction(state, { type: 'research', techId: 'forge' }, r);
    expect(isTechAvailable(state, 0, r.techs['mech_bay'], r)).toBe(true);
    expect(isTechAvailable(state, 0, r.techs['crucible'], r)).toBe(true);
  });

  it('Composite Plating (OR-prereq) unlocks from EITHER Crucible or Mech Bay', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    state.players[0].ore = 5000;
    state = applyAction(state, { type: 'research', techId: 'forge' }, r);
    expect(isTechAvailable(state, 0, r.techs['composite_plating'], r)).toBe(false); // neither yet
    state = applyAction(state, { type: 'research', techId: 'mech_bay' }, r);
    expect(isTechAvailable(state, 0, r.techs['composite_plating'], r)).toBe(true); // via Mech Bay alone
  });

  it('recruit options SHOW tech-locked units flagged locked (not hidden) when tech tree is ON', () => {
    const r = getRegistry();
    const state = createGame(getConfig(), r, ['vanguard', 'hive'], 7); // tech tree ON (gated)
    state.units = []; state.unitHomeCity = {};
    const cap = state.cities.find(c => c.isCapital && c.owner === 0)!;
    const opts = getRecruitOptions(state, r, 0, cap.position);
    const tank = opts.find(o => o.unitTypeId === 'tank');
    expect(tank).toBeTruthy();          // shown, not hidden
    expect(tank!.locked).toBe(true);    // but flagged locked
    expect(tank!.lockedBy).toContain('Crucible');
    expect(opts.find(o => o.unitTypeId === 'warrior')!.locked).toBeFalsy(); // base unit not locked
  });

  it('tech-locks units behind unlockUnit techs (Small Arms → Lancer/Bulwark; Crucible → Tank)', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    expect(isUnitUnlocked(state, 0, 'warrior', r)).toBe(true); // not gated by any tech
    expect(isUnitUnlocked(state, 0, 'lancer', r)).toBe(false); // gated by Small Arms
    expect(isUnitUnlocked(state, 0, 'tank', r)).toBe(false);   // gated by Crucible
    state.players[0].ore = 1000;
    state = applyAction(state, { type: 'research', techId: 'small_arms' }, r);
    expect(isUnitUnlocked(state, 0, 'lancer', r)).toBe(true);
    expect(isUnitUnlocked(state, 0, 'defender', r)).toBe(true);
  });

  it('tech tree OFF (techTreeEnabled:false) unlocks all gated units from the start', () => {
    const r = getRegistry();
    // OFF: every gated unit is unlocked without researching anything.
    const off = createGame(getConfig({ techTreeEnabled: false }), r, ['vanguard', 'hive'], 7);
    expect(off.players[0].researchedTechs.length).toBeGreaterThan(0); // pre-researched
    expect(isUnitUnlocked(off, 0, 'tank', r)).toBe(true);
    expect(isUnitUnlocked(off, 0, 'marksman', r)).toBe(true);
    // Default (gated) still hides them.
    const on = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    expect(on.players[0].researchedTechs.length).toBe(0);
    expect(isUnitUnlocked(on, 0, 'tank', r)).toBe(false);
  });
});
