import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, getVisibleState, cityPopUsed } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, CityState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const hiveCap = (s: GameState): CityState => s.cities.find(c => c.isCapital && c.owner === 1)!;
function clearPlayer1(state: GameState) {
  for (const u of state.units.filter(u => u.owner === 1)) delete state.unitHomeCity[u.id];
  state.units = state.units.filter(u => u.owner !== 1);
}

describe('Hive: starting units', () => {
  it('Hive starts with 2 scuttlings (no warrior) and cannot build warriors', () => {
    const state = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    const p1 = state.units.filter(u => u.owner === 1);
    expect(p1.length).toBe(2);
    expect(p1.every(u => u.typeId === 'scuttling')).toBe(true);
    const cap = hiveCap(state);
    expect(p1.every(u => state.unitHomeCity[u.id] === cap.id)).toBe(true); // both homed at the capital
    expect(cityPopUsed(state, cap.id, registry)).toBe(1); // pair = 1 pop
    expect(registry.factions['hive'].unitTypes.includes('warrior')).toBe(false); // can't build warriors
    // Vanguard still starts with a single warrior.
    const p0 = state.units.filter(u => u.owner === 0);
    expect(p0.length).toBe(1);
    expect(p0[0].typeId).toBe('warrior');
  });
});

describe('Hive: Scuttlings (paired, 0.5 pop)', () => {
  it('recruiting spawns a PAIR on territory (not the centre), counting 1 pop total', () => {
    let state = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    const cap = hiveCap(state);
    clearPlayer1(state); // free the capital tile + pop
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = state.map.tiles[cap.position.y + dy]?.[cap.position.x + dx];
      if (t) t.terrain = 'plains';
    }
    state.currentPlayer = 1;
    state.players[1].ore = 100;

    const recruit = getLegalActions(state, registry, 1).find(a => a.type === 'recruit' && a.unitTypeId === 'scuttling');
    expect(recruit).toBeTruthy();
    state = applyAction(state, recruit!, registry);

    const scuttlings = state.units.filter(u => u.typeId === 'scuttling' && u.owner === 1);
    expect(scuttlings.length).toBe(2); // a pair
    for (const s of scuttlings) {
      expect(s.position.x === cap.position.x && s.position.y === cap.position.y).toBe(false); // not the centre
      expect(state.unitHomeCity[s.id]).toBe(cap.id);
    }
    expect(cityPopUsed(state, cap.id, registry)).toBe(1); // pair = 1 pop

    state.units = state.units.filter(u => u.id !== scuttlings[0].id); // one dies
    expect(cityPopUsed(state, cap.id, registry)).toBe(1); // lone 0.5 rounds up → still 1
    state.units = state.units.filter(u => u.id !== scuttlings[1].id); // both gone
    expect(cityPopUsed(state, cap.id, registry)).toBe(0);
  });

  it('Sacrificial Founder: a scuttling that founds a city dies', () => {
    let state = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    state.currentPlayer = 1;
    const pos = { x: 6, y: 6 };
    state.map.tiles[pos.y][pos.x].isRuin = true;
    state.map.tiles[pos.y][pos.x].isCity = false;
    state.players[1].ore = 50;
    const sc: Unit = { id: 800, typeId: 'scuttling', owner: 1, position: { ...pos }, hp: 10, hasMoved: false, hasAttacked: false, abilityCooldowns: {} };
    state.units.push(sc);
    state.unitHomeCity[800] = hiveCap(state).id;

    const before = state.cities.length;
    state = applyAction(state, { type: 'foundCity', position: pos }, registry);
    expect(state.cities.length).toBe(before + 1);       // city was founded
    expect(state.units.some(u => u.id === 800)).toBe(false); // founder consumed
    expect(state.unitHomeCity[800]).toBeUndefined();
  });
});

describe('Hive: Scuttling bump (blind reveal)', () => {
  it('bumping a hidden enemy reveals it without moving; the reveal clears at end of turn', () => {
    const state = createGame(cfg({ fogOfWar: true }), registry, ['vanguard', 'hive'], 7);
    clearPlayer1(state);
    state.currentPlayer = 1;
    state.units.push({ id: 700, typeId: 'scuttling', owner: 1, position: { x: 6, y: 6 }, hp: 10, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    state.units.push({ id: 701, typeId: 'warrior', owner: 0, position: { x: 7, y: 6 }, hp: 10, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    for (let y = 4; y <= 8; y++) for (let x = 4; x <= 8; x++) state.map.tiles[y][x].terrain = 'plains';

    // The blind scuttling can't see the adjacent hidden enemy yet…
    expect(getVisibleState(state, 1, registry).units.some(u => u.id === 701)).toBe(false);
    // …but it has a "bump" move targeting the enemy tile.
    const bump = getLegalActions(state, registry, 1).find(a => a.type === 'move' && a.unitId === 700 && a.to.x === 7 && a.to.y === 6);
    expect(bump).toBeTruthy();

    const after = applyAction(state, bump!, registry);
    expect(after.units.find(u => u.id === 700)!.position).toEqual({ x: 6, y: 6 }); // stayed put
    const vs = getVisibleState(after, 1, registry);
    expect(vs.units.some(u => u.id === 701)).toBe(true);     // enemy revealed this turn
    expect(vs.visibility[6][7]).toBe('explored');            // bumped tile is now fog

    const next = applyAction(after, { type: 'endTurn' }, registry);
    expect(next.revealedTiles[1].length).toBe(0);            // reveal cleared (fog returns)
  });
});

describe('Hive: Squinting eyes (fog vision)', () => {
  it('L2: inner 3×3 is visible, the surrounding 5×5 ring is fog, beyond is cloud', () => {
    const state = createGame(cfg({ fogOfWar: true }), registry, ['vanguard', 'hive'], 7);
    for (const u of state.units.filter(u => u.owner === 1)) delete state.unitHomeCity[u.id];
    state.units = state.units.filter(u => u.owner !== 1);
    state.units.push({ id: 600, typeId: 'hive_scout', owner: 1, position: { x: 6, y: 6 }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    for (let y = 3; y <= 9; y++) for (let x = 3; x <= 9; x++) state.map.tiles[y][x].terrain = 'plains';

    const vis = getVisibleState(state, 1, registry).visibility;
    expect(vis[6][6]).toBe('visible');  // own tile
    expect(vis[6][7]).toBe('visible');  // inner ring (dist 1)
    expect(vis[6][8]).toBe('explored'); // outer ring (dist 2) → fog
    expect(vis[6][9]).toBe('hidden');   // beyond range 2 → cloud
  });
});
