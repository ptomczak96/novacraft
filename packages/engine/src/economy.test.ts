import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, getLegalActions, getRecruitOptions,
  calculateOreIncome, calculatePlasmaIncome, cityProduction, cityPop, cityLevelForSupply,
  cityAt, canBuild, unitsHomedAt, cityCanLevelUp,
  validateExpansion, isExpansionTileEligible, territoryCityAt,
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
    const state = createGame(getConfig(), registry, ['vanguard', 'hive'], 42);
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
    const cap: CityState = { id: 1, position: { x: 0, y: 0 }, owner: 0, isCapital: true, level: 1, supply: 0, incomeBonus: 0, popBonus: 0, bonusSupply: 0, fortified: false, extraTerritory: [] };
    const city: CityState = { id: 2, position: { x: 0, y: 0 }, owner: 0, isCapital: false, level: 1, supply: 0, incomeBonus: 0, popBonus: 0, bonusSupply: 0, fortified: false, extraTerritory: [] };
    expect(cityProduction(cap, registry)).toBe(20);
    expect(cityProduction(city, registry)).toBe(10);
    cap.level = 3;
    expect(cityProduction(cap, registry)).toBe(40);
  });

  it('pop (unit capacity) = level + 1', () => {
    const registry = getRegistry();
    const city: CityState = { id: 1, position: { x: 0, y: 0 }, owner: 0, isCapital: false, level: 1, supply: 0, incomeBonus: 0, popBonus: 0, bonusSupply: 0, fortified: false, extraTerritory: [] };
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
  it('a level-1 mine adds +10 ore output and +1 supply; two mines unlock + accept L2', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].ore = 200;
    const base = calculateOreIncome(state, 0, registry);

    const a = makeOreTile(state, cap.position, 1, 0);
    state = applyAction(state, { type: 'build', kind: 'mine', position: a }, registry);
    expect(cityAt(state, cap.position)!.supply).toBe(1);
    expect(calculateOreIncome(state, 0, registry)).toBe(base + 10); // +10 ore output

    const b = makeOreTile(state, cap.position, 0, 1);
    state = applyAction(state, { type: 'build', kind: 'mine', position: b }, registry);
    let capNow = cityAt(state, cap.position)!;
    expect(capNow.supply).toBe(2);
    expect(capNow.level).toBe(1); // threshold met, but not yet accepted
    expect(cityCanLevelUp(capNow, registry)).toBe(true);

    // Accept L2, choosing +1 pop.
    state = applyAction(state, { type: 'levelUpCity', cityId: capNow.id, choice: 'pop' }, registry);
    capNow = cityAt(state, cap.position)!;
    expect(capNow.level).toBe(2);
    expect(cityPop(capNow, registry)).toBe(4); // popBase 2 + (level-1)=1 + popBonus 1
  });

  it('upgrading a mine raises its output to 20 and supply to 2 (level stays 1 until accepted)', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    state.players[0].ore = 200;
    const a = makeOreTile(state, cap.position, 1, 0);

    state = applyAction(state, { type: 'build', kind: 'mine', position: a }, registry);
    state = applyAction(state, { type: 'research', techId: 'drilling' }, registry); // Drilling unlocks mine L2
    const before = calculateOreIncome(state, 0, registry); // L1 city (20 base) + 10 mine = 30
    state = applyAction(state, { type: 'upgradeBuilding', position: a }, registry);

    const city = cityAt(state, cap.position)!;
    expect(city.supply).toBe(2); // L2 mine = 2 supply
    expect(city.level).toBe(1); // supply met, but leveling is now the player's choice
    // Only the mine's extra output so far — no level-base bump until accepted.
    expect(calculateOreIncome(state, 0, registry)).toBe(before + 10);

    // Accept the level-up, choosing the income reward.
    state = applyAction(state, { type: 'levelUpCity', cityId: city.id, choice: 'income' }, registry);
    const leveled = cityAt(state, cap.position)!;
    expect(leveled.level).toBe(2);
    // +10 base (20→30) AND +20 income bonus, on top of the mine's +10.
    expect(calculateOreIncome(state, 0, registry)).toBe(before + 10 + 10 + 20);
  });
});

describe('REB2 — refineries (output + supply per adjacent same-city mine)', () => {
  it('produces +10 ore and +1 supply per adjacent mine', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
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
    const state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
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
    let state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
    const enemyCap = capitalOf(state, 1);
    // Reset the enemy's units to a single controlled defender homed at the capital
    // (the city centre tile is left free for the capturer).
    for (const u of state.units.filter(u => u.owner === 1)) delete state.unitHomeCity[u.id];
    state.units = state.units.filter(u => u.owner !== 1);
    const enemyUnit: Unit = { id: 888, typeId: 'warrior', owner: 1, position: { x: enemyCap.position.x, y: enemyCap.position.y - 1 }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} };
    state.units.push(enemyUnit);
    state.unitHomeCity[888] = enemyCap.id;
    expect(unitsHomedAt(state, enemyCap.id)).toBe(1);

    // Put a player-0 unit on the (now empty) city tile and capture it.
    state.units.push({ id: 999, typeId: 'warrior', owner: 0, position: { ...enemyCap.position }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    state = applyAction(state, { type: 'captureCity', unitId: 999 }, registry);

    const captured = cityAt(state, enemyCap.position)!;
    expect(captured.owner).toBe(0);
    expect(state.unitHomeCity[enemyUnit.id]).toBeUndefined(); // enemy ghost released
    // The capturer re-homes to the captured city (its pop transfers here).
    expect(state.unitHomeCity[999]).toBe(captured.id);
    expect(unitsHomedAt(state, captured.id)).toBe(1); // just the capturer now
  });

  it('a unit re-homes to the city it founds (pop transfers off its old home)', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    const pos = { x: 6, y: 6 };
    state.map.tiles[pos.y][pos.x].isRuin = true;
    state.map.tiles[pos.y][pos.x].isCity = false;
    state.players[0].ore = 50;
    // A unit homed at the capital, standing on the ruin (already moved last turn).
    state.units.push({ id: 700, typeId: 'warrior', owner: 0, position: { ...pos }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    state.unitHomeCity[700] = cap.id;
    const capHomedBefore = unitsHomedAt(state, cap.id);

    state = applyAction(state, { type: 'foundCity', position: pos }, registry);
    const founded = cityAt(state, pos)!;
    expect(state.unitHomeCity[700]).toBe(founded.id);          // re-homed to the new city
    expect(unitsHomedAt(state, founded.id)).toBe(1);           // counts against the new city
    expect(unitsHomedAt(state, cap.id)).toBe(capHomedBefore - 1); // freed from the capital
  });
});

describe('Resources & recruiting costs', () => {
  it('recruiting deducts ore and plasma and assigns a home city', () => {
    const registry = getRegistry();
    registry.economy = { ...registry.economy, unitPlasmaCost: { warrior: 3 } };
    let state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
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
    const state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
    state.units = []; state.unitHomeCity = {};
    state.players[0].ore = 100; state.players[0].plasma = 0;
    expect(getLegalActions(state, registry, 0).filter(a => a.type === 'recruit' && a.unitTypeId === 'warrior').length).toBe(0);
  });

  it('getRecruitOptions lists all buildable units with an affordable flag', () => {
    const registry = getRegistry();
    const state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    state.units = []; state.unitHomeCity = {}; // free the city tile
    state.players[0].ore = 20; // can afford warrior (20), not scout (30) or lancer (50)

    const opts = getRecruitOptions(state, registry, 0, cap.position);
    const byId = Object.fromEntries(opts.map(o => [o.unitTypeId, o]));
    expect(byId['scout']).toBeTruthy();           // shown even though unaffordable
    expect(byId['scout'].affordable).toBe(false);  // 30 > 20
    expect(byId['warrior'].affordable).toBe(true); // 20 <= 20
    expect(byId['lancer'].affordable).toBe(false); // 50 > 20
  });
});

describe('Income split', () => {
  it('ore income = city base + ore buildings; plasma income starts at 0', () => {
    const registry = getRegistry();
    const state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
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

    let state = createGame(config, registry, ['vanguard', 'hive'], 314);
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

    let replay = createGame(config, registry, ['vanguard', 'hive'], 314);
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
    let state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
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

  it('cannot found on the same turn a unit moved onto the ruin (only the turn after)', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
    const pos = { x: 6, y: 6 };
    state.map.tiles[pos.y][pos.x].isRuin = true;
    state.map.tiles[pos.y][pos.x].isCity = false;
    // A unit that just moved onto the ruin this turn (hasMoved = true).
    state.units.push({ id: 502, typeId: 'warrior', owner: 0, position: { ...pos }, hp: 15, hasMoved: true, hasAttacked: false, abilityCooldowns: {} });
    state.players[0].ore = 50;

    // Same turn: founding is neither offered nor applied.
    expect(getLegalActions(state, registry, 0).some(a => a.type === 'foundCity')).toBe(false);
    const before = state.cities.length;
    state = applyAction(state, { type: 'foundCity', position: pos }, registry);
    expect(state.cities.length).toBe(before);

    // Following turn (hasMoved reset): founding now works.
    state.units.find(u => u.id === 502)!.hasMoved = false;
    expect(getLegalActions(state, registry, 0).some(a => a.type === 'foundCity')).toBe(true);
    state = applyAction(state, { type: 'foundCity', position: pos }, registry);
    expect(state.cities.some(c => c.position.x === pos.x && c.position.y === pos.y && c.owner === 0)).toBe(true);
  });
});

describe('City leveling (choice-based)', () => {
  // Build N mines around the capital so supply reaches `target`.
  function buildMines(state: GameState, registry: DataRegistry, cap: CityState, n: number): GameState {
    const offsets = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    state.players[0].ore = 1000;
    for (let i = 0; i < n; i++) {
      const pos = makeOreTile(state, cap.position, offsets[i][0], offsets[i][1]);
      state = applyAction(state, { type: 'build', kind: 'mine', position: pos }, registry);
    }
    return state;
  }

  it('rejects a choice that is not offered for the target level', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    state = buildMines(state, registry, cap, 2); // supply 2 → L2 available (income | pop)
    const city = cityAt(state, cap.position)!;
    // 'fortify' is an L3 choice, not valid for reaching L2 → no-op.
    state = applyAction(state, { type: 'levelUpCity', cityId: city.id, choice: 'fortify' }, registry);
    expect(cityAt(state, cap.position)!.level).toBe(1);
  });

  it('the +3 supply choice persists and counts toward further leveling', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    state = buildMines(state, registry, cap, 5); // 5 mines = 5 supply (≥ L3 threshold 5)
    let city = cityAt(state, cap.position)!;
    state = applyAction(state, { type: 'levelUpCity', cityId: city.id, choice: 'income' }, registry); // L2
    city = cityAt(state, cap.position)!;
    state = applyAction(state, { type: 'levelUpCity', cityId: city.id, choice: 'fortify' }, registry); // L3
    city = cityAt(state, cap.position)!;
    expect(city.level).toBe(3);
    expect(city.fortified).toBe(true);
    // Now at L3 (threshold 5, supply 5). Choosing +3 supply at L4 needs supply ≥ 9.
    state = applyAction(state, { type: 'levelUpCity', cityId: city.id, choice: 'supply' }, registry);
    // supply was only 5 (< 9) so L4 is not yet available → no-op.
    expect(cityAt(state, cap.position)!.level).toBe(3);
  });

  it('level-up bonuses survive capture (economic value transfers unchanged)', () => {
    const registry = getRegistry();
    let state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
    const cap = capitalOf(state, 0);
    state = buildMines(state, registry, cap, 2);
    let city = cityAt(state, cap.position)!;
    state = applyAction(state, { type: 'levelUpCity', cityId: city.id, choice: 'income' }, registry);
    city = cityAt(state, cap.position)!;
    expect(city.incomeBonus).toBe(20);

    // Simulate capture by flipping owner (capture path only changes owner).
    city.owner = 1;
    const after = cityAt(state, cap.position)!;
    expect(after.level).toBe(2);
    expect(after.incomeBonus).toBe(20); // bonus stays with the city
    expect(cityProduction(after, registry)).toBe(20 + 10 + 20); // capital base + level + bonus
  });
});

describe('Territory expansion (L4 reward, anti-snake rule)', () => {
  // A synthetic L3 city at (6,6) ready to reach L4, on cleared open land.
  function setup() {
    const registry = getRegistry();
    const state = createGame(getConfig(), registry, ['vanguard', 'hive'], 7);
    // Clear a 7x7 patch around (6,6) so nothing (ruins/resources) blocks claims.
    for (let y = 3; y <= 9; y++) for (let x = 3; x <= 9; x++) {
      const t = state.map.tiles[y][x];
      t.terrain = 'plains'; t.isCity = false; t.isRuin = false;
      t.isResourceTile = false; t.resourceKind = null; t.owner = null;
    }
    const city: CityState = {
      id: 50, position: { x: 6, y: 6 }, owner: 0, isCapital: false,
      level: 3, supply: 9, incomeBonus: 0, popBonus: 0, bonusSupply: 9,
      fortified: false, extraTerritory: [],
    };
    state.cities.push(city);
    return { registry, state, city };
  }

  it('a straight 3-tile line is rejected (no single-tile tendrils)', () => {
    const { registry, state, city } = setup();
    // (8,6)-(9,6)-(10,6): only the first touches the base 3x3 by ≥2.
    expect(validateExpansion(state, registry, city, [{ x: 8, y: 6 }, { x: 9, y: 6 }, { x: 10, y: 6 }])).toBe(false);
  });

  it('an L-shaped set passes (each tile has ≥2 owned neighbours in some order)', () => {
    const { registry, state, city } = setup();
    // (8,6) touches (7,5/6/7); (8,7) touches (7,6),(7,7),(8,6); (9,6) touches (8,6),(8,7).
    const tiles = [{ x: 9, y: 6 }, { x: 8, y: 7 }, { x: 8, y: 6 }]; // deliberately out of order
    expect(validateExpansion(state, registry, city, tiles)).toBe(true);
  });

  it('a tile with only one owned neighbour is ineligible', () => {
    const { registry, state, city } = setup();
    expect(isExpansionTileEligible(state, registry, city, { x: 8, y: 6 }, [])).toBe(true);  // 3 base neighbours
    expect(isExpansionTileEligible(state, registry, city, { x: 9, y: 6 }, [])).toBe(false); // 0 owned neighbours
  });

  it('expandTerritory levels to 4 and claims the 3 tiles as real territory', () => {
    const { registry, state, city } = setup();
    const tiles = [{ x: 8, y: 6 }, { x: 8, y: 7 }, { x: 9, y: 6 }];
    const next = applyAction(state, { type: 'expandTerritory', cityId: city.id, tiles }, registry);
    const c = next.cities.find(cc => cc.id === city.id)!;
    expect(c.level).toBe(4);
    expect(c.extraTerritory.length).toBe(3);
    // A claimed tile now belongs to this city's territory and flips ownership.
    expect(territoryCityAt(next, registry, { x: 9, y: 6 })?.id).toBe(city.id);
    expect(next.map.tiles[6][9].owner).toBe(0);
  });

  it('rejects an invalid expansion (no level-up, no claim)', () => {
    const { registry, state, city } = setup();
    const tiles = [{ x: 8, y: 6 }, { x: 9, y: 6 }, { x: 10, y: 6 }]; // a line → invalid
    const next = applyAction(state, { type: 'expandTerritory', cityId: city.id, tiles }, registry);
    const c = next.cities.find(cc => cc.id === city.id)!;
    expect(c.level).toBe(3);
    expect(c.extraTerritory.length).toBe(0);
  });
});

describe('Melee advance on kill', () => {
  it('a melee unit moves onto the tile of a unit it kills (ranged does not)', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
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
    const moved = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    putUnitOnEnemyCap(moved, true);
    expect(getLegalActions(moved, r, 0).some(a => a.type === 'captureCity')).toBe(false);

    const settled = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    putUnitOnEnemyCap(settled, false);
    expect(getLegalActions(settled, r, 0).some(a => a.type === 'captureCity' && a.unitId === 700)).toBe(true);
  });

  it('capturing transfers the city and its 3x3 territory to the captor', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
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

describe('City capture — full move→endTurn→capture flow', () => {
  it('capture is offered the turn AFTER moving onto an undefended enemy city', () => {
    const r = getRegistry();
    let state = createGame(getConfig(), r, ['vanguard', 'hive'], 7);
    const enemyCap = state.cities.find(c => c.owner === 1)!;
    // Undefend it (remove the enemy unit on the tile), put a player-0 unit adjacent.
    state.units = state.units.filter(u => !(u.position.x === enemyCap.position.x && u.position.y === enemyCap.position.y));
    // Keep player 1 alive elsewhere so undefending the city doesn't end the game.
    state.units.push({ id: 801, typeId: 'warrior', owner: 1, position: { x: enemyCap.position.x, y: enemyCap.position.y - 2 }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    state.units.push({ id: 800, typeId: 'warrior', owner: 0, position: { x: enemyCap.position.x - 1, y: enemyCap.position.y }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });

    // Move onto the city this turn → capture NOT yet available.
    state = applyAction(state, { type: 'move', unitId: 800, to: { ...enemyCap.position } }, r);
    expect(getLegalActions(state, r, 0).some(a => a.type === 'captureCity' && a.unitId === 800)).toBe(false);

    // Cycle: player 0 ends, player 1 ends → back to player 0.
    state = applyAction(state, { type: 'endTurn' }, r);
    state = applyAction(state, { type: 'endTurn' }, r);
    expect(state.currentPlayer).toBe(0);
    expect(getLegalActions(state, r, 0).some(a => a.type === 'captureCity' && a.unitId === 800)).toBe(true);
  });
});
