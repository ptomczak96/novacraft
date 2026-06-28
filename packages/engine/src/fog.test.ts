import { describe, it, expect } from 'vitest';
import { createGame, getVisibleState } from './index.js';
import { recordSight } from './fog.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { DataRegistry, GameConfig, GameState, Unit, Tile } from './types.js';

const blankTile = (): Tile => ({ terrain: 'plains', owner: null, isCity: false, isResourceTile: false });

function getRegistry(): DataRegistry { return buildRegistry(); }
function fogConfig(o: Partial<GameConfig> = {}): GameConfig {
  return { ...defaultConfig, fogOfWar: true, ...o };
}
function unitOf(state: GameState, playerId = 0): Unit {
  const u = state.units.find(u => u.owner === playerId);
  if (!u) throw new Error('no unit');
  return u;
}

describe('Fog of war — visibility radius (square / Chebyshev)', () => {
  it('a visibility-1 unit reveals the full 3×3 square incl. diagonals', () => {
    const registry = getRegistry();
    const state = createGame(fogConfig(), registry, ['ironclad', 'sylvan'], 7);
    // Park the unit centrally on open ground so its 3×3 is on-map and unblocked.
    const u = unitOf(state, 0);
    u.position = { x: 6, y: 6 };
    for (let y = 4; y <= 8; y++) for (let x = 4; x <= 8; x++) state.map.tiles[y][x].terrain = 'plains';

    const vis = getVisibleState(state, 0, registry).visibility;
    // Diagonals (excluded by a Manhattan/diamond radius 1) must be visible here.
    expect(vis[7][7]).toBe('visible');
    expect(vis[5][5]).toBe('visible');
    expect(vis[6][6]).toBe('visible');
    // A tile two out is not currently seen and was never explored → cloud.
    expect(vis[6][9]).toBe('hidden');
  });

  it("an owned city's territory is visible", () => {
    const registry = getRegistry();
    const state = createGame(fogConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = state.cities.find(c => c.isCapital && c.owner === 0)!;
    const vis = getVisibleState(state, 0, registry).visibility;
    expect(vis[cap.position.y][cap.position.x]).toBe('visible');
  });
});

describe('Fog of war — explored memory (cloud vs fog)', () => {
  it('a previously-seen tile out of sight shows as explored (fog), not hidden (cloud)', () => {
    const registry = getRegistry();
    const state = createGame(fogConfig(), registry, ['ironclad', 'sylvan'], 7);
    // Simulate having discovered a far tile, now out of current sight.
    state.memory[0].tiles[9][9] = blankTile();
    const vis = getVisibleState(state, 0, registry).visibility;
    expect(vis[9][9]).toBe('explored'); // remembered terrain/structures
    expect(vis[8][8]).toBe('hidden');   // never seen → cloud
  });

  it('hides enemy units on explored (fog) tiles, shows them only when visible', () => {
    const registry = getRegistry();
    const state = createGame(fogConfig(), registry, ['ironclad', 'sylvan'], 7);
    const own = unitOf(state, 0);
    own.position = { x: 6, y: 6 };

    // Enemy A on a fog tile (remembered but not currently visible) → hidden.
    state.memory[0].tiles[9][9] = blankTile();
    state.units.push({ id: 900, typeId: 'warrior', owner: 1, position: { x: 9, y: 9 }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
    // Enemy B adjacent to our unit (currently visible) → shown.
    state.units.push({ id: 901, typeId: 'warrior', owner: 1, position: { x: 7, y: 6 }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });

    const vs = getVisibleState(state, 0, registry);
    expect(vs.units.some(u => u.id === 900)).toBe(false); // hidden on fog
    expect(vs.units.some(u => u.id === 901)).toBe(true);  // visible nearby
  });

  it('a building seen then destroyed while in fog still shows (last-seen snapshot)', () => {
    const registry = getRegistry();
    const state = createGame(fogConfig(), registry, ['ironclad', 'sylvan'], 7);
    const own = unitOf(state, 0);
    own.position = { x: 6, y: 6 };
    // A building on a tile our unit can currently see, then record it into memory.
    state.buildings.push({ id: 77, kind: 'mine', position: { x: 6, y: 7 }, level: 1, cityId: null });
    recordSight(state, 0, registry);

    // Unit walks away → (6,7) is no longer visible; the building is "destroyed".
    own.position = { x: 1, y: 1 };
    state.buildings = state.buildings.filter(b => b.id !== 77);

    const vs = getVisibleState(state, 0, registry);
    const tx = 6, ty = 7;
    expect(vs.visibility[ty][tx]).toBe('explored'); // fog, not cloud
    expect(vs.buildings.some(b => b.id === 77)).toBe(true); // remembered building persists
  });

  it('the capital reveals a 5×5 square (radius 2)', () => {
    const registry = getRegistry();
    const state = createGame(fogConfig(), registry, ['ironclad', 'sylvan'], 7);
    const cap = state.cities.find(c => c.isCapital && c.owner === 0)!;
    const vis = getVisibleState(state, 0, registry).visibility;
    // A tile 2 out from the capital centre (and on-map) is visible.
    const { x, y } = cap.position;
    const probe = { x: x + (x < 6 ? 2 : -2), y: y + (y < 6 ? 2 : -2) };
    expect(vis[probe.y][probe.x]).toBe('visible');
  });
});
