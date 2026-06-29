import { describe, it, expect } from 'vitest';
import { createGame, getVisibleState, getReachableTiles, getLegalActions } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: true, ...o });
const scout = (id: number, x: number, y: number): Unit =>
  ({ id, typeId: 'scout', owner: 0, position: { x, y }, hp: 10, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });

describe('Condition: mountain_restricted', () => {
  it('a scout cannot move onto an adjacent mountain (but can onto plains)', () => {
    const state = createGame({ ...defaultConfig, fogOfWar: false }, registry, ['vanguard', 'hive'], 7);
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) state.map.tiles[y][x].terrain = 'plains';
    state.map.tiles[5][6].terrain = 'mountain'; // east of (5,5)
    const u = scout(500, 5, 5);
    const reach = getReachableTiles(u, registry.unitTypes['scout'], state.map, [u], registry, 0);
    expect(reach.has('6,5')).toBe(false); // mountain → restricted
    expect(reach.has('4,5')).toBe(true);  // plains → fine
  });
});

describe('Mountains: default impassable; only mountain-condition units climb', () => {
  const reachFor = (state: ReturnType<typeof createGame>, typeId: string) => {
    const u = { id: 1, typeId, owner: 0, position: { x: 5, y: 5 }, hp: 10, hasMoved: false, hasAttacked: false, abilityCooldowns: {} };
    return getReachableTiles(u, registry.unitTypes[typeId], state.map, [u], registry, 0);
  };
  it('warriors can’t climb; Bulwark/Lancer/Scab can', () => {
    const state = createGame({ ...defaultConfig, fogOfWar: false }, registry, ['vanguard', 'hive'], 7);
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) state.map.tiles[y][x].terrain = 'plains';
    state.map.tiles[5][6].terrain = 'mountain'; // adjacent, east
    expect(reachFor(state, 'warrior').has('6,5')).toBe(false); // default: can't climb
    expect(reachFor(state, 'defender').has('6,5')).toBe(true); // Bulwark — mountain_defense
    expect(reachFor(state, 'lancer').has('6,5')).toBe(true); // mountain_shooter
    expect(reachFor(state, 'scab').has('6,5')).toBe(true); // mountain_sight
  });

  it('mountain_sight: the Scab sees radius 2 while on a mountain', () => {
    const state = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    state.units = state.units.filter(u => u.owner !== 1);
    state.units.push({ id: 1, typeId: 'scab', owner: 1, position: { x: 5, y: 5 }, hp: 10, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) state.map.tiles[y][x].terrain = 'plains';
    state.map.tiles[5][5].terrain = 'mountain'; // the Scab's own tile
    const vis = getVisibleState(state, 1, registry).visibility;
    expect(vis[5][7]).toBe('visible'); // distance 2 — only visible because vis becomes 2 on a mountain
  });
});

describe('Condition: frazzled', () => {
  it('caps movement at 1 when inside an enemy’s attack range', () => {
    const state = createGame({ ...defaultConfig, fogOfWar: false }, registry, ['vanguard', 'hive'], 7);
    for (let y = 2; y <= 8; y++) for (let x = 2; x <= 8; x++) state.map.tiles[y][x].terrain = 'plains';
    const scout = { id: 1, typeId: 'hive_scout', owner: 1, position: { x: 5, y: 5 }, hp: 10, hasMoved: false, hasAttacked: false, abilityCooldowns: {} };

    // No enemy nearby → full movement (2) reaches a tile 2 away.
    const far = getReachableTiles(scout, registry.unitTypes['hive_scout'], state.map, [scout], registry, 0);
    expect(far.has('7,5')).toBe(true);

    // A melee enemy adjacent → frazzled → movement 1 (can't reach 2 away).
    const enemy = { id: 2, typeId: 'warrior', owner: 0, position: { x: 6, y: 5 }, hp: 10, hasMoved: false, hasAttacked: false, abilityCooldowns: {} };
    const near = getReachableTiles(scout, registry.unitTypes['hive_scout'], state.map, [scout, enemy], registry, 0);
    expect(near.has('3,5')).toBe(false); // 2 tiles west — out of reach now
    expect(near.has('4,5')).toBe(true);  // 1 tile west — still reachable
  });
});

describe('Condition: impotent_founder', () => {
  it('a scout cannot found a city, but a warrior on the same ruin can', () => {
    const state = createGame({ ...defaultConfig, fogOfWar: false }, registry, ['vanguard', 'hive'], 7);
    const pos = { x: 6, y: 6 };
    state.map.tiles[pos.y][pos.x].isRuin = true;
    state.map.tiles[pos.y][pos.x].isCity = false;
    state.players[0].ore = 50;

    state.units.push({ id: 600, typeId: 'scout', owner: 0, position: { ...pos }, hp: 10, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    expect(getLegalActions(state, registry, 0).some(a => a.type === 'foundCity')).toBe(false);

    state.units = state.units.filter(u => u.id !== 600);
    state.units.push({ id: 601, typeId: 'warrior', owner: 0, position: { ...pos }, hp: 10, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    expect(getLegalActions(state, registry, 0).some(a => a.type === 'foundCity')).toBe(true);
  });
});

describe('Condition: low_horizons', () => {
  it('a mountain blocks the scout’s sight beyond it (sees the mountain, not past)', () => {
    const state = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    state.units = state.units.filter(u => u.owner !== 0); // isolate the scout's sight
    state.units.push(scout(501, 5, 5));
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) state.map.tiles[y][x].terrain = 'plains';
    state.map.tiles[5][6].terrain = 'mountain'; // east, distance 1

    const vis = getVisibleState(state, 0, registry).visibility;
    expect(vis[5][6]).toBe('visible'); // the mountain tile itself
    expect(vis[5][7]).toBe('hidden');  // tile beyond the mountain — blocked
    expect(vis[5][3]).toBe('visible'); // open ground the other way, within radius 2
  });

  it('only mountains block (forests do NOT) — fixes the scout 5×5 gaps', () => {
    const state = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    state.units = state.units.filter(u => u.owner !== 0);
    state.units.push(scout(502, 5, 5));
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) state.map.tiles[y][x].terrain = 'plains';
    state.map.tiles[5][6].terrain = 'forest'; // a forest between the scout and (5,7)
    const vis = getVisibleState(state, 0, registry).visibility;
    expect(vis[5][7]).toBe('visible'); // forest does not block — tile beyond is still seen
  });
});
