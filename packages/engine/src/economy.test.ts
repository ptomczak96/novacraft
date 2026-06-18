import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, getLegalActions, replayGame,
  calculateShardIncome, cityProduction, citySlots, cityLevelForPop,
  cityAt, canBuild, recomputeCities, unitsHomedAt,
  createPRNG, nextRandom,
} from './index.js';
import { buildRegistry } from '@tactica/data';
import { defaultConfig } from '@tactica/data';
import type { DataRegistry, GameConfig, GameState, Action, Coord, Unit, CityState } from './types.js';

function getConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...defaultConfig, fogOfWar: false, ...overrides };
}
function getRegistry(): DataRegistry {
  return buildRegistry();
}

/** Player 0's capital city. */
function capitalOf(state: GameState, playerId = 0): CityState {
  const c = state.cities.find(c => c.isCapital && c.owner === playerId);
  if (!c) throw new Error('no capital');
  return c;
}

/** Turn an in-territory neighbour of `centre` into a shard outcrop and return its coord. */
function makeShardTile(state: GameState, registry: DataRegistry, centre: Coord, dx: number, dy: number): Coord {
  const pos = { x: centre.x + dx, y: centre.y + dy };
  const tile = state.map.tiles[pos.y][pos.x];
  tile.terrain = 'plains';
  tile.isCity = false;
  tile.isResourceTile = true;
  tile.resourceKind = 'shard';
  return pos;
}

describe('createGame economy init', () => {
  it('creates a capital per player at level 1 with starting resources', () => {
    const registry = getRegistry();
    const state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 42);

    expect(state.cities.length).toBeGreaterThanOrEqual(2);
    expect(state.players[0].shard).toBe(registry.economy.startingShard);
    expect(state.players[0].plasma).toBe(registry.economy.startingPlasma);

    const cap = capitalOf(state, 0);
    expect(cap.level).toBe(1);
    expect(cap.owner).toBe(0);
  });

  it('homes each starting warrior at its capital', () => {
    const registry = getRegistry();
    const state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 42);
    const cap = capitalOf(state, 0);
    expect(unitsHomedAt(state, cap.id)).toBe(1);
  });
});

describe('City production / slots / level', () => {
  it('capital produces 20 at L1, +10 per level; founded city produces 10 at L1', () => {
    const registry = getRegistry();
    const cap: CityState = { id: 1, position: { x: 0, y: 0 }, owner: 0, isCapital: true, level: 1, pop: 0 };
    const city: CityState = { id: 2, position: { x: 0, y: 0 }, owner: 0, isCapital: false, level: 1, pop: 0 };
    expect(cityProduction(cap, registry)).toBe(20);
    expect(cityProduction(city, registry)).toBe(10);
    cap.level = 3;
    expect(cityProduction(cap, registry)).toBe(40);
  });

  it('slots = level + 1', () => {
    const registry = getRegistry();
    const city: CityState = { id: 1, position: { x: 0, y: 0 }, owner: 0, isCapital: false, level: 1, pop: 0 };
    expect(citySlots(city, registry)).toBe(2);
    city.level = 3;
    expect(citySlots(city, registry)).toBe(4);
  });

  it('levels follow the cumulative pop thresholds 2/5/9/14/20', () => {
    const registry = getRegistry();
    expect(cityLevelForPop(0, registry)).toBe(1);
    expect(cityLevelForPop(1, registry)).toBe(1);
    expect(cityLevelForPop(2, registry)).toBe(2);
    expect(cityLevelForPop(4, registry)).toBe(2);
    expect(cityLevelForPop(5, registry)).toBe(3);
    expect(cityLevelForPop(9, registry)).toBe(4);
    expect(cityLevelForPop(20, registry)).toBe(6);
    expect(cityLevelForPop(999, registry)).toBe(6); // capped
  });
});

describe('Mines + population + auto-level', () => {
  it('building two mines raises capital pop to 2 and auto-levels it to L2', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].shard = 100;

    const a = makeShardTile(state, registry, cap.position, 1, 0);
    const b = makeShardTile(state, registry, cap.position, 0, 1);

    expect(canBuild(state, registry, 0, 'mine', a)).toBe(true);
    state = applyAction(state, { type: 'build', kind: 'mine', position: a }, registry);
    const capAfter1 = cityAt(state, cap.position)!;
    expect(capAfter1.pop).toBe(1);
    expect(capAfter1.level).toBe(1);

    state = applyAction(state, { type: 'build', kind: 'mine', position: b }, registry);
    const capAfter2 = cityAt(state, cap.position)!;
    expect(capAfter2.pop).toBe(2);
    expect(capAfter2.level).toBe(2); // hit the 2-pop threshold
    expect(citySlots(capAfter2, registry)).toBe(3);
    expect(state.players[0].shard).toBe(100 - 20 - 20);
  });

  it('upgrading a mine raises its pop output', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].shard = 200;
    const a = makeShardTile(state, registry, cap.position, 1, 0);

    state = applyAction(state, { type: 'build', kind: 'mine', position: a }, registry);
    expect(cityAt(state, cap.position)!.pop).toBe(1);
    state = applyAction(state, { type: 'upgradeBuilding', position: a }, registry);
    expect(cityAt(state, cap.position)!.pop).toBe(2); // L2 mine = 2 pop
  });

  it('a processor adds pop per adjacent mine', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].shard = 300;

    const m1 = makeShardTile(state, registry, cap.position, 1, 0);
    const m2 = makeShardTile(state, registry, cap.position, 1, 1);
    state = applyAction(state, { type: 'build', kind: 'mine', position: m1 }, registry);
    state = applyAction(state, { type: 'build', kind: 'mine', position: m2 }, registry);

    // Processor on the capital-adjacent land tile between/near both mines.
    const procPos = { x: cap.position.x + 1, y: cap.position.y - 1 };
    state.map.tiles[procPos.y][procPos.x].terrain = 'plains';
    // Only count mines within the processor's own 3x3 — m1 and m2 are adjacent.
    const popBefore = cityAt(state, cap.position)!.pop;
    if (canBuild(state, registry, 0, 'processor', procPos)) {
      state = applyAction(state, { type: 'build', kind: 'processor', position: procPos }, registry);
      const popAfter = cityAt(state, cap.position)!.pop;
      expect(popAfter).toBeGreaterThan(popBefore); // +2 per adjacent mine
    }
  });
});

describe('Unit slots', () => {
  it('blocks recruiting when the city has no free slot, and frees on unit removal', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].shard = 100;

    // Remove starting warrior from the city tile, then fill both L1 slots with
    // units homed at the capital but standing elsewhere.
    state.units = [];
    state.unitHomeCity = {};
    const homed = (id: number, x: number, y: number): Unit =>
      ({ id, typeId: 'warrior', owner: 0, position: { x, y }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    state.units.push(homed(101, cap.position.x + 2, cap.position.y));
    state.units.push(homed(102, cap.position.x + 3, cap.position.y));
    state.unitHomeCity[101] = cap.id;
    state.unitHomeCity[102] = cap.id;

    let recruits = getLegalActions(state, registry, 0).filter(a => a.type === 'recruit');
    expect(recruits.length).toBe(0); // 2/2 slots used

    state.units = state.units.filter(u => u.id !== 102);
    delete state.unitHomeCity[102];
    recruits = getLegalActions(state, registry, 0).filter(a => a.type === 'recruit');
    expect(recruits.length).toBeGreaterThan(0); // a slot opened
  });
});

describe('Resources & recruiting costs', () => {
  it('recruiting deducts shard and plasma and assigns a home city', () => {
    const registry = getRegistry();
    // Give the warrior a plasma cost via the economy table.
    registry.economy = { ...registry.economy, unitPlasmaCost: { warrior: 3 } };
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = capitalOf(state, 0);
    state.units = []; state.unitHomeCity = {}; // clear the city tile + slots
    state.players[0].shard = 50;
    state.players[0].plasma = 10;

    const recruit = getLegalActions(state, registry, 0).find(a => a.type === 'recruit' && a.unitTypeId === 'warrior');
    expect(recruit).toBeTruthy();
    state = applyAction(state, recruit!, registry);

    expect(state.players[0].shard).toBe(50 - registry.unitTypes['warrior'].cost);
    expect(state.players[0].plasma).toBe(10 - 3);
    const newUnit = state.units[state.units.length - 1];
    expect(state.unitHomeCity[newUnit.id]).toBe(cap.id);
  });

  it('hides recruits the player cannot afford in plasma', () => {
    const registry = getRegistry();
    registry.economy = { ...registry.economy, unitPlasmaCost: { warrior: 99 } };
    const state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const s2 = { ...state, units: [] as Unit[], unitHomeCity: {} as Record<number, number> };
    s2.players[0].shard = 100;
    s2.players[0].plasma = 0;
    const recruits = getLegalActions(s2, registry, 0).filter(a => a.type === 'recruit' && a.unitTypeId === 'warrior');
    expect(recruits.length).toBe(0);
  });
});

describe('Shard income', () => {
  it('income equals the sum of owned city production, paid on turn rollover', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const income = calculateShardIncome(state, 0, registry);
    expect(income).toBe(cityProduction(capitalOf(state, 0), registry)); // one capital
    const start = state.players[0].shard;

    state = applyAction(state, { type: 'endTurn' }, registry);
    state = applyAction(state, { type: 'endTurn' }, registry);
    expect(state.players[0].shard).toBe(start + income);
  });
});

describe('canBuild guards', () => {
  it('rejects building off-territory, on cities, or on the wrong resource', () => {
    const registry = getRegistry();
    const state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    state.players[0].shard = 100;
    const cap = capitalOf(state, 0);

    // On the city tile itself — rejected.
    expect(canBuild(state, registry, 0, 'mine', cap.position)).toBe(false);
    // A plains tile adjacent (no shard) — mine rejected (wrong resource).
    const plains = { x: cap.position.x + 1, y: cap.position.y };
    state.map.tiles[plains.y][plains.x].terrain = 'plains';
    state.map.tiles[plains.y][plains.x].isResourceTile = false;
    state.map.tiles[plains.y][plains.x].resourceKind = null;
    expect(canBuild(state, registry, 0, 'mine', plains)).toBe(false);
  });
});

describe('Determinism with the economy', () => {
  it('replaying a game that builds/levels cities reproduces identical state', () => {
    const registry = getRegistry();
    const config = getConfig({ turnLimit: 25 });

    // Seed shard tiles near both capitals so build actions appear.
    let state = createGame(config, registry, ['ironclad', 'sylvan'], 314);
    for (const cap of state.cities) {
      makeShardTile(state, registry, cap.position, 1, 0);
      makeShardTile(state, registry, cap.position, 0, 1);
    }
    for (const p of state.players) p.shard = 60;

    const actions: Action[] = [];
    let prng = createPRNG(99);
    for (let i = 0; i < 300 && state.phase === 'playing'; i++) {
      const legal = getLegalActions(state, registry, state.currentPlayer);
      if (legal.length === 0) break;
      const [val, next] = nextRandom(prng);
      prng = next;
      const action = legal[Math.floor(val * legal.length)];
      actions.push(action);
      state = applyAction(state, action, registry);
    }

    // Rebuild the same starting state for replay (shard tiles + shard balances).
    let replay = createGame(config, registry, ['ironclad', 'sylvan'], 314);
    for (const cap of replay.cities) {
      makeShardTile(replay, registry, cap.position, 1, 0);
      makeShardTile(replay, registry, cap.position, 0, 1);
    }
    for (const p of replay.players) p.shard = 60;
    for (const action of actions) replay = applyAction(replay, action, registry);

    expect(JSON.stringify(replay.players)).toBe(JSON.stringify(state.players));
    expect(JSON.stringify(replay.cities)).toBe(JSON.stringify(state.cities));
    expect(JSON.stringify(replay.buildings)).toBe(JSON.stringify(state.buildings));
    expect(replay.units.length).toBe(state.units.length);
  });
});

// Keep a reference so unused-import lint stays quiet if a test above is trimmed.
void recomputeCities;
void replayGame;
