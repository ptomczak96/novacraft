import { describe, it, expect } from 'vitest';
import { createGame } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { Coord, GameState } from './types.js';

const registry = buildRegistry();
const config = { ...defaultConfig, fogOfWar: false };
const cheb = (a: Coord, b: Coord) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** All city/ruin centres on the map (each owns a 3x3 territory). */
function centres(state: GameState): Coord[] {
  const out: Coord[] = state.cities.map(c => ({ ...c.position }));
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (state.map.tiles[y][x].isRuin) out.push({ x, y });
    }
  }
  return out;
}

describe('Mapgen — ruins & territories', () => {
  it('no two city/ruin territories ever overlap (centres ≥ 3 apart) across many seeds', () => {
    for (let seed = 0; seed < 40; seed++) {
      const state = createGame(config, registry, ['vanguard', 'hive'], seed);
      const cs = centres(state);
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          expect(cheb(cs[i], cs[j])).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('generates ruins (foundable city sites)', () => {
    let totalRuins = 0;
    for (let seed = 0; seed < 10; seed++) {
      const state = createGame(config, registry, ['vanguard', 'hive'], seed);
      totalRuins += centres(state).length - state.cities.length;
    }
    expect(totalRuins).toBeGreaterThan(0); // ruins do get placed
  });

  it('every capital has its plasma vent + ore in its territory', () => {
    const state = createGame(config, registry, ['vanguard', 'hive'], 7);
    for (const cap of state.cities.filter(c => c.isCapital)) {
      let ore = 0, plasma = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const t = state.map.tiles[cap.position.y + dy]?.[cap.position.x + dx];
          if (t?.resourceKind === 'ore') ore++;
          if (t?.resourceKind === 'plasma') plasma++;
        }
      }
      expect(plasma).toBe(1); // 1 plasma vent per capital
      expect(ore).toBe(2); // 2 ore per capital
    }
  });

  it('is deterministic — same seed produces an identical map', () => {
    const a = createGame(config, registry, ['vanguard', 'hive'], 314);
    const b = createGame(config, registry, ['vanguard', 'hive'], 314);
    expect(JSON.stringify(a.map)).toBe(JSON.stringify(b.map));
  });

  it('"Double Resources" spawns more resources across the map', () => {
    const count = (s: GameState) => {
      let n = 0;
      for (const row of s.map.tiles) for (const t of row) if (t.isResourceTile) n++;
      return n;
    };
    let normal = 0, doubled = 0;
    for (const seed of [1, 7, 42, 100, 314]) {
      normal += count(createGame(config, registry, ['vanguard', 'hive'], seed));
      doubled += count(createGame({ ...config, mapgen: { doubleResources: true } }, registry, ['vanguard', 'hive'], seed));
    }
    expect(doubled).toBeGreaterThan(normal);
  });
});
