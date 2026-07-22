import { describe, it, expect } from 'vitest';
import { createGame, applyAction, techCostForPlayer, cityPop } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const capOf = (s: GameState, p = 0) => s.cities.find(c => c.isCapital && c.owner === p)!;
const research = (s: GameState, id: string) => applyAction(s, { type: 'research', techId: id }, registry);

// Relocate player-0's first unit to a fresh ruin on a genuinely empty tile and found there.
function foundAt(s: GameState) {
  s.currentPlayer = 0;
  const u = s.units.find(x => x.owner === 0)!;
  // Find a tile with no city (and not a capital position) to avoid clashing.
  let pos = { x: 0, y: 0 };
  outer: for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) {
    if (s.map.tiles[y][x].isCity) continue;
    if (s.cities.some(c => c.position.x === x && c.position.y === y)) continue;
    pos = { x, y }; break outer;
  }
  u.position = { ...pos }; u.hasMoved = false;
  const t = s.map.tiles[pos.y][pos.x];
  t.terrain = 'plains'; t.isCity = false; t.isResourceTile = false; t.isRuin = true; t.owner = null;
  s.players[0].ore = 5000;
  const ns = applyAction(s, { type: 'foundCity', position: pos }, registry);
  return ns.cities.find(c => c.position.x === pos.x && c.position.y === pos.y);
}

describe('New economy techs', () => {
  it('R&D reduces future research cost by 10%', () => {
    let s = createGame(cfg(), registry, ['vanguard','hive'], 7);
    s.players[0].ore = 5000;
    s = research(s, 'prospecting'); s = research(s, 'cross_border'); s = research(s, 'rnd');
    expect(techCostForPlayer(s, 0, registry.techs['mine_2'], registry)).toBe(Math.round(50 * 0.9));
  });

  it('Colonial Charter → founded cities start at level 2 (else level 1)', () => {
    expect(foundAt(createGame(cfg(), registry, ['vanguard','hive'], 7))?.level).toBe(1);
    let s = createGame(cfg(), registry, ['vanguard','hive'], 7);
    s.players[0].ore = 5000;
    s = research(s, 'plasma_1'); s = research(s, 'plasma_2'); s = research(s, 'colonial_charter');
    expect(foundAt(s)?.level).toBe(2);
  });

  it('Habitation Domes → +1 pop cap on cities', () => {
    let s = createGame(cfg(), registry, ['vanguard','hive'], 7);
    const cap = capOf(s);
    const before = cityPop(cap, registry, s);
    s.players[0].ore = 5000;
    s = research(s, 'prospecting'); s = research(s, 'cross_border'); s = research(s, 'habitation_domes');
    expect(cityPop(cap, registry, s)).toBe(before + 1);
  });
});
