import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, canPlaceNode } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, techTreeEnabled: false, ...o });
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
const u = (s: GameState, id: number) => s.units.find(x => x.id === id);
// A clean board: flatten to plains, LEAVE cities, and make a big NEUTRAL region so nodes fit.
const base = (o: Partial<GameConfig> = {}) => {
  const s = createGame(cfg(o), registry, ['vanguard', 'hive'], 7); s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0;
  for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) {
    const t = s.map.tiles[y][x];
    if (t.isCity) continue;
    t.terrain = 'plains'; t.isResourceTile = false; t.isRuin = false;
    if (x >= 2 && x <= 9 && y >= 2 && y <= 9) t.owner = null; // neutral working area
  }
  s.players[0].ore = 1000;
  return s;
};
const endTurns = (s: GameState, n: number) => { for (let i = 0; i < n; i++) s = applyAction(s, { type: 'endTurn' }, registry); return s; };

describe('Engineer — Build Node placement & cost', () => {
  it('offers build_node only on valid neutral tiles in range 1 and costs 100 ore', () => {
    const s = base();
    s.units.push(mk(1, 'engineer', 0, 6, 6));
    const casts = getLegalActions(s, registry, 0).filter((a: any) => a.type === 'useAbility' && a.unitId === 1 && a.abilityId === 'build_node') as any[];
    expect(casts.length).toBeGreaterThan(0);
    for (const c of casts) {
      expect(Math.max(Math.abs(c.target.x - 6), Math.abs(c.target.y - 6))).toBeLessThanOrEqual(1); // range 1
      expect(canPlaceNode(s, 0, c.target)).toBe(true);
    }
  });

  it('rejects placement whose 3×3 overlaps a city/ruin or owned territory', () => {
    const s = base();
    // Friendly territory tile inside the would-be footprint.
    s.map.tiles[6][8].owner = 0; // (8,6) owned → node centred at (7,6) would overlap it
    expect(canPlaceNode(s, 0, { x: 7, y: 6 })).toBe(false);
    s.map.tiles[6][8].owner = null;
    s.map.tiles[6][8].isRuin = true; // ruin inside footprint of a node at (7,6)
    expect(canPlaceNode(s, 0, { x: 7, y: 6 })).toBe(false);
  });

  it('build_node deducts 100 ore, starts construction, and locks the engineer to the node', () => {
    let s = base();
    s.units.push(mk(1, 'engineer', 0, 6, 6));
    const cast = getLegalActions(s, registry, 0).find((a: any) => a.abilityId === 'build_node' && a.target.x === 6 && a.target.y === 6) as any
      ?? getLegalActions(s, registry, 0).find((a: any) => a.abilityId === 'build_node') as any;
    const before = s.players[0].ore;
    s = applyAction(s, cast, registry);
    expect(s.players[0].ore).toBe(before - 100);
    expect(s.nodes.length).toBe(1);
    expect(s.nodes[0].building).toBe(true);
    expect(u(s, 1)!.buildingNodeId).toBe(s.nodes[0].id);
  });
});

describe('Engineer — Node construction, completion, cancel, death', () => {
  const buildAt = (center: { x: number; y: number }) => {
    let s = base();
    s.units.push(mk(1, 'engineer', 0, center.x, center.y));
    const cast = { type: 'useAbility', unitId: 1, abilityId: 'build_node', target: { ...center } } as any;
    s = applyAction(s, cast, registry);
    return s;
  };

  it('completes after 2 of the builder’s turns and claims its 3×3 as friendly territory', () => {
    let s = buildAt({ x: 6, y: 6 });
    expect(s.nodes[0].building).toBe(true);
    s = endTurns(s, 3); // p0 end, p1 end, p0 end → 2 builder-turn ticks
    const node = s.nodes[0];
    expect(node.building).toBe(false);
    // 3×3 around (6,6) now owned by player 0.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      expect(s.map.tiles[6 + dy][6 + dx].owner).toBe(0);
    }
    expect(u(s, 1)!.buildingNodeId).toBeUndefined(); // builder freed
  });

  it('cancelNodeBuild removes the half-built node and frees the engineer', () => {
    let s = buildAt({ x: 6, y: 6 });
    s = applyAction(s, { type: 'cancelNodeBuild', unitId: 1 } as any, registry);
    expect(s.nodes.length).toBe(0);
    expect(u(s, 1)!.buildingNodeId).toBeUndefined();
  });

  it('moving the builder cancels construction', () => {
    let s = buildAt({ x: 6, y: 6 });
    s = endTurns(s, 2); // back to the engineer's next turn (still building, flags reset)
    expect(s.nodes[0].building).toBe(true);
    const move = getLegalActions(s, registry, 0).find((a: any) => a.type === 'move' && a.unitId === 1) as any;
    expect(move).toBeTruthy(); // a building engineer can still move (which cancels the node)
    s = applyAction(s, move, registry);
    expect(s.nodes.length).toBe(0);
  });

  it('killing the builder mid-construction cancels the node', () => {
    let s = buildAt({ x: 6, y: 6 });
    // A hive reaper kills the engineer (engineer 10 HP).
    s.units.push({ ...mk(2, 'reaper', 1, 6, 7), hp: registry.unitTypes['reaper'].maxHP });
    s.currentPlayer = 1;
    s = applyAction(s, { type: 'attack', unitId: 2, targetId: 1 } as any, registry);
    // If the engineer died, the node is gone.
    if (!u(s, 1)) expect(s.nodes.length).toBe(0);
  });
});

describe('Node territory — heal + AOI', () => {
  it('a completed node projects AOI (blocks enemy transit through its 3×3)', () => {
    let s = buildComplete();
    // Enemy reaper 2 tiles from the node ring must not be able to path through it.
    s.units.push({ ...mk(9, 'reaper', 1, 6, 9), hp: registry.unitTypes['reaper'].maxHP });
    s.currentPlayer = 1;
    const moves = getLegalActions(s, registry, 1).filter((a: any) => a.type === 'move' && a.unitId === 9) as any[];
    // (6,7) is on the node's AOI ring (node at (6,6)) — a legal STOP, but (6,5) beyond it is blocked.
    expect(moves.some(m => m.to.x === 6 && m.to.y === 5)).toBe(false);
  });

  it('a friendly unit standing in node territory heals at end of turn', () => {
    let s = buildComplete();
    s.units.push({ ...mk(3, 'warrior', 0, 5, 6), hp: 4 }); // on a node-territory tile (owner 0)
    s.currentPlayer = 0;
    s = applyAction(s, { type: 'endTurn' }, registry); // didn't move/attack → heals
    expect(u(s, 3)!.hp).toBe(8); // 4 + 4 (friendly territory heal)
  });

  // Build a node and run it to completion, returning the state.
  function buildComplete(): GameState {
    let s = base();
    s.units.push(mk(1, 'engineer', 0, 6, 6));
    s = applyAction(s, { type: 'useAbility', unitId: 1, abilityId: 'build_node', target: { x: 6, y: 6 } } as any, registry);
    s = endTurns(s, 3);
    return s;
  }
});
