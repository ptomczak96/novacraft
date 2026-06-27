import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, getLegalActions,
  calculateOreIncome, calculatePlasmaIncome, cityProduction, cityPop, cityLevelForSupply,
  cityAt, canBuild, unitsHomedAt,
  createPRNG, nextRandom,
} from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { DataRegistry, GameConfig, GameState, Action, Coord, Unit, CityState } from './types.js';

function getConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...defaultConfig, fogOfWar: false, ...overrides };
}
function getRegistry(): DataRegistry {
  return buildRegistry();
}

function capitalOf(state: GameState, playerId = 0): CityState {
  const c = state.cities.find(c => c.isCapital && c.owner === playerId);
  if (!c) throw new Error('no capital');
  return c;
}

/** Turn an in-territory neighbour into an ore tile and return its coord. */
function makeOreTile(state: GameState, centre: Coord, dx: number, dy: number): Coord {
  const pos = { x: centre.x + dx, y: centre.y + dy };
  const tile = state.map.tiles[pos.y][pos.x];
  tile.terrain = 'plains';
  tile.isCity = false;
  tile.isResourceTile = true;
  tile.resourceKind = 'ore';
  return pos;
}

function makeLandTile(state: GameState, centre: Coord, dx: number, dy: number): Coord {
  const pos = { x: centre.x + dx, y: centre.y + dy };
  const tile = state.map.tiles[pos.y][pos.x];
  tile.terrain = 'plains';
  tile.isCity = false;
  tile.isResourceTile = false;
  tile.resourceKind = null;
  return pos;
}

describe('createGame economy init', () => {
  it('creates a level-1 capital per player with starting resources', () => {
    const registry = getRegistry();
    const state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 42);
    expect(state.players[0].ore).toBe(registry.economy.startingOre);
    expect(state.players[0].plasma).toBe(registry.economy.startingPlasma);
    const cap = capitalOf(state, 0);
    expect(cap.level).toBe(1);
    expect(unitsHomedAt(state, cap.id)).toBe(1); // starting warrior homed here
  });
});

describe('City production / pop (capacity) / supply→level', () => {
  it('capital produces 20 at L1 (+10/level); founded city produces 10', () => {
    const registry = getRegistry();
    const cap: CityState = { id: 1, position: { x: 0, y: 0 }, owner: 0, isCapital: true, level: 1, supply: 0 };
    const city: CityState = { id: 2, position: { x: 0, y: 0 }, owner: 0, isCapital: false, level: 1, supply: 0 };
    expect(cityProduction(cap, registry)).toBe(20);
    expect(cityProduction(city, registry)).toBe(10);
    cap.level = 3;
    expect(cityProduction(cap, registry)).toBe(40);
  });

  it('pop (unit capacity) = level + 1', () => {
    const registry = getRegistry();
    const city: CityState = { id: 1, position: { x: 0, y: 0 }, owner: 0, isCapital: false, level: 1, supply: 0 };
    expect(cityPop(city, registry)).toBe(2);
    city.level = 3;
    expect(cityPop(city, registry)).toBe(4);
  });

  it('supply thresholds 2/5/9/14/20 set the level', () => {
    const registry = getRegistry();
    expect(cityLevelForSupply(1, registry)).toBe(1);
    expect(cityLevelForSupply(2, registry)).toBe(2);
    expect(cityLevelForSupply(5, registry)).toBe(3);
    expect(cityLevelForSupply(9, registry)).toBe(4);
    expect(cityLevelForSupply(20, registry)).toBe(6);
    expect(cityLevelForSupply(999, registry)).toBe(6);
  });
});

describe('REB1 — mines (output + supply)', () => {
  it('a level-1 mine adds +10 ore output and +1 supply; two mines reach L2', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].ore = 200;
    const base = calculateOreIncome(state, 0, registry);

    const a = makeOreTile(state, cap.position, 1, 0);
    state = applyAction(state, { type: 'build', kind: 'mine', position: a }, registry);
    expect(cityAt(state, cap.position)!.supply).toBe(1);
    expect(calculateOreIncome(state, 0, registry)).toBe(base + 10); // +10 ore output

    const b = makeOreTile(state, cap.position, 0, 1);
    state = applyAction(state, { type: 'build', kind: 'mine', position: b }, registry);
    const capNow = cityAt(state, cap.position)!;
    expect(capNow.supply).toBe(2);
    expect(capNow.level).toBe(2); // hit the 2-supply threshold
    expect(cityPop(capNow, registry)).toBe(3); // capacity rose
  });

  it('upgrading a mine raises its output to 20 and supply to 3', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].ore = 200;
    const a = makeOreTile(state, cap.position, 1, 0);

    state = applyAction(state, { type: 'build', kind: 'mine', position: a }, registry);
    state = applyAction(state, { type: 'research', techId: 'drilling' }, registry); // Drilling unlocks mine L2
    const before = calculateOreIncome(state, 0, registry); // L1 city (20 base) + 10 mine = 30
    state = applyAction(state, { type: 'upgradeBuilding', position: a }, registry);
    expect(cityAt(state, cap.position)!.supply).toBe(3); // L2 mine = 3 supply
    expect(cityAt(state, cap.position)!.level).toBe(2); // 3 supply crosses the 2-threshold
    // +10 from mine output (10→20) AND +10 from the city leveling (base 20→30).
    expect(calculateOreIncome(state, 0, registry)).toBe(before + 20);
  });
});

describe('REB2 — refineries (output + supply per adjacent same-city mine)', () => {
  it('produces +10 ore and +1 supply per adjacent mine', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].ore = 400;

    const m1 = makeOreTile(state, cap.position, 1, 0);
    const m2 = makeOreTile(state, cap.position, 1, 1);
    const proc = makeLandTile(state, cap.position, 0, 1); // adjacent to both mines
    state = applyAction(state, { type: 'build', kind: 'mine', position: m1 }, registry);
    state = applyAction(state, { type: 'build', kind: 'mine', position: m2 }, registry);
    // Refinery is gated behind the Refineries tech (L2 → needs an L1 first).
    state = applyAction(state, { type: 'research', techId: 'prospecting' }, registry);
    state = applyAction(state, { type: 'research', techId: 'refineries' }, registry);

    const oreBefore = calculateOreIncome(state, 0, registry);
    const supplyBefore = cityAt(state, cap.position)!.supply;
    expect(canBuild(state, registry, 0, 'refinery', proc)).toBe(true);
    state = applyAction(state, { type: 'build', kind: 'refinery', position: proc }, registry);

    expect(calculateOreIncome(state, 0, registry)).toBe(oreBefore + 20); // +10 per mine x2
    expect(cityAt(state, cap.position)!.supply).toBe(supplyBefore + 2); // +1 per mine x2
  });
});

describe('Unit pop (capacity)', () => {
  it('blocks recruiting at a full city and frees on unit removal', () => {
    const registry = getRegistry();
    const state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].ore = 100;
    state.units = []; state.unitHomeCity = {};
    const homed = (id: number, x: number, y: number): Unit =>
      ({ id, typeId: 'warrior', owner: 0, position: { x, y }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    state.units.push(homed(101, cap.position.x + 2, cap.position.y));
    state.units.push(homed(102, cap.position.x + 3, cap.position.y));
    state.unitHomeCity[101] = cap.id;
    state.unitHomeCity[102] = cap.id;

    expect(getLegalActions(state, registry, 0).filter(a => a.type === 'recruit').length).toBe(0); // 2/2 full
    state.units = state.units.filter(u => u.id !== 102);
    delete state.unitHomeCity[102];
    expect(getLegalActions(state, registry, 0).filter(a => a.type === 'recruit').length).toBeGreaterThan(0);
  });
});

describe('Capture frees the new owner’s slots (Bug 1)', () => {
  it('clears the previous owner’s home-city links when a city is captured', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const enemyCap = capitalOf(state, 1);
    // Player 1's warrior is homed at the enemy capital.
    expect(unitsHomedAt(state, enemyCap.id)).toBe(1);

    // Move the enemy's unit off the city tile (still homed there), put a player-0
    // unit on the city, and capture it (capture is now an explicit action).
    const enemyUnit = state.units.find(u => state.unitHomeCity[u.id] === enemyCap.id)!;
    enemyUnit.position = { x: enemyCap.position.x, y: enemyCap.position.y - 1 };
    state.units.push({ id: 999, typeId: 'warrior', owner: 0, position: { ...enemyCap.position }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    state = applyAction(state, { type: 'captureCity', unitId: 999 }, registry);

    const captured = cityAt(state, enemyCap.position)!;
    expect(captured.owner).toBe(0);
    expect(unitsHomedAt(state, captured.id)).toBe(0); // enemy ghosts released
  });
});

describe('Resources & recruiting costs', () => {
  it('recruiting deducts ore and plasma and assigns a home city', () => {
    const registry = getRegistry();
    registry.economy = { ...registry.economy, unitPlasmaCost: { warrior: 3 } };
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = capitalOf(state, 0);
    state.units = []; state.unitHomeCity = {};
    state.players[0].ore = 50;
    state.players[0].plasma = 10;

    const recruit = getLegalActions(state, registry, 0).find(a => a.type === 'recruit' && a.unitTypeId === 'warrior');
    expect(recruit).toBeTruthy();
    state = applyAction(state, recruit!, registry);
    expect(state.players[0].ore).toBe(50 - registry.unitTypes['warrior'].cost);
    expect(state.players[0].plasma).toBe(10 - 3);
    const u = state.units[state.units.length - 1];
    expect(state.unitHomeCity[u.id]).toBe(cap.id);
  });

  it('hides recruits the player cannot afford in plasma', () => {
    const registry = getRegistry();
    registry.economy = { ...registry.economy, unitPlasmaCost: { warrior: 99 } };
    const state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    state.units = []; state.unitHomeCity = {};
    state.players[0].ore = 100; state.players[0].plasma = 0;
    expect(getLegalActions(state, registry, 0).filter(a => a.type === 'recruit' && a.unitTypeId === 'warrior').length).toBe(0);
  });
});

describe('Income split', () => {
  it('ore income = city base + ore buildings; plasma income starts at 0', () => {
    const registry = getRegistry();
    const state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    expect(calculateOreIncome(state, 0, registry)).toBe(cityProduction(capitalOf(state, 0), registry));
    expect(calculatePlasmaIncome(state, 0, registry)).toBe(0);
  });
});

describe('Determinism with the economy', () => {
  it('replaying a game that builds/levels cities reproduces identical state', () => {
    const registry = getRegistry();
    const config = getConfig({ turnLimit: 25 });

    const setup = (s: GameState) => {
      for (const cap of s.cities) {
        makeOreTile(s, cap.position, 1, 0);
        makeOreTile(s, cap.position, 0, 1);
      }
      for (const p of s.players) p.ore = 80;
    };

    let state = createGame(config, registry, ['ironclad', 'sylvan'], 314);
    setup(state);
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

    let replay = createGame(config, registry, ['ironclad', 'sylvan'], 314);
    setup(replay);
    for (const action of actions) replay = applyAction(replay, action, registry);

    expect(JSON.stringify(replay.players)).toBe(JSON.stringify(state.players));
    expect(JSON.stringify(replay.cities)).toBe(JSON.stringify(state.cities));
    expect(JSON.stringify(replay.buildings)).toBe(JSON.stringify(state.buildings));
  });
});

describe('Founding a city', () => {
  it('claims the full 3x3 territory (ownership), not just the centre tile', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['ironclad', 'sylvan'], 7);
    const pos = { x: 6, y: 6 }; // open space, away from the corner capitals
    state.map.tiles[pos.y][pos.x].isRuin = true;
    state.map.tiles[pos.y][pos.x].isCity = false;
    state.units.push({ id: 500, typeId: 'warrior', owner: 0, position: { ...pos }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    state.players[0].ore = 50;

    state = applyAction(state, { type: 'foundCity', position: pos }, registry);

    expect(state.cities.some(c => c.position.x === pos.x && c.position.y === pos.y && c.owner === 0)).toBe(true);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        expect(state.map.tiles[pos.y + dy][pos.x + dx].owner).toBe(0);
      }
    }
  });
});

describe('Melee advance on kill', () => {
  it('a melee unit moves onto the tile of a unit it kills (ranged does not)', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['ironclad', 'sylvan'], 7);
    state.units = [];
    const aPos = { x: 5, y: 5 }, dPos = { x: 6, y: 5 };
    state.units.push({ id: 1, typeId: 'warrior', owner: 0, position: { ...aPos }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    state.units.push({ id: 2, typeId: 'scout', owner: 1, position: { ...dPos }, hp: 1, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    state = applyAction(state, { type: 'attack', unitId: 1, targetId: 2 }, r);
    expect(state.units.find(u => u.id === 2)).toBeUndefined(); // defender killed
    expect(state.units.find(u => u.id === 1)!.position).toEqual(dPos); // warrior advanced
  });
});

describe('City capture', () => {
  function putUnitOnEnemyCap(state: GameState, hasMoved: boolean) {
    const enemyCap = state.cities.find(c => c.owner === 1)!;
    state.units = state.units.filter(u => !(u.position.x === enemyCap.position.x && u.position.y === enemyCap.position.y));
    state.units.push({ id: 700, typeId: 'warrior', owner: 0, position: { ...enemyCap.position }, hp: 15, hasMoved, hasAttacked: false, abilityCooldowns: {} });
    return enemyCap;
  }

  it('capture is offered only when the unit did not move onto the city this turn', () => {
    const r = getRegistry();
    const moved = createGame(getConfig(), r, ['ironclad', 'sylvan'], 7);
    putUnitOnEnemyCap(moved, true);
    expect(getLegalActions(moved, r, 0).some(a => a.type === 'captureCity')).toBe(false);

    const settled = createGame(getConfig(), r, ['ironclad', 'sylvan'], 7);
    putUnitOnEnemyCap(settled, false);
    expect(getLegalActions(settled, r, 0).some(a => a.type === 'captureCity' && a.unitId === 700)).toBe(true);
  });

  it('capturing transfers the city and its 3x3 territory to the captor', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['ironclad', 'sylvan'], 7);
    const enemyCap = putUnitOnEnemyCap(state, false);
    state = applyAction(state, { type: 'captureCity', unitId: 700 }, r);
    expect(state.cities.find(c => c.id === enemyCap.id)!.owner).toBe(0);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = state.map.tiles[enemyCap.position.y + dy]?.[enemyCap.position.x + dx];
        if (t) expect(t.owner).toBe(0);
      }
    }
  });
});
