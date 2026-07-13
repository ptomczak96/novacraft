import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, getVisibleState } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit, UseAbilityAction, MoveAction } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const plains = (s: GameState) => { for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) s.map.tiles[y][x].terrain = 'plains'; };
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
const u = (s: GameState, id: number) => s.units.find(x => x.id === id);
const base = (current = 1) => {
  let s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
  s.units = []; s.unitHomeCity = {}; s.buildings = []; s.currentPlayer = current; plains(s);
  return s;
};
const selfCast = (id: number, abilityId: string, pos: { x: number; y: number }): UseAbilityAction =>
  ({ type: 'useAbility', unitId: id, abilityId, target: pos });
const moves = (s: GameState, id: number) => getLegalActions(s, registry, s.currentPlayer)
  .filter(a => a.type === 'move' && 'unitId' in a && a.unitId === id).map(a => `${(a as any).to.x},${(a as any).to.y}`);

describe('Wyrm: Burrow / Erupt morph', () => {
  it('Burrow morphs wyrm → wyrm_burrowed (hidden stats), keeping id/hp; ends turn', () => {
    let s = base(1);
    s.units.push({ ...mk(1, 'wyrm', 1, 3, 3), hp: 24 });
    expect(getLegalActions(s, registry, 1).some(a => a.type === 'useAbility' && a.abilityId === 'burrow')).toBe(true);
    s = applyAction(s, selfCast(1, 'burrow', { x: 3, y: 3 }), registry);
    expect(u(s, 1)!.typeId).toBe('wyrm_burrowed');
    expect(u(s, 1)!.hp).toBe(24);
    expect(u(s, 1)!.hasAttacked).toBe(true);
  });

  it('a burrowed wyrm is invisible to the enemy unless an enemy Detect unit is adjacent', () => {
    let s = base(1);
    s.units.push(mk(1, 'wyrm_burrowed', 1, 3, 3), mk(2, 'warrior', 0, 8, 8));
    expect(getVisibleState(s, 0, registry).units.some(x => x.id === 1)).toBe(false); // hidden
    // Put an adjacent Detect unit (seercaust) → revealed.
    s.units.push(mk(3, 'seercaust', 0, 3, 4));
    expect(getVisibleState(s, 0, registry).units.some(x => x.id === 1)).toBe(true);
  });

  it('a burrowed wyrm cannot attack (only Erupt)', () => {
    const s = base(1);
    s.units.push(mk(1, 'wyrm_burrowed', 1, 3, 3), mk(2, 'warrior', 0, 4, 3));
    const acts = getLegalActions(s, registry, 1).filter(a => 'unitId' in a && a.unitId === 1);
    expect(acts.some(a => a.type === 'attack')).toBe(false);
    expect(acts.some(a => a.type === 'useAbility' && a.abilityId === 'erupt')).toBe(true);
  });
});

describe('Wyrm: co-tile occupancy & Erupt kill', () => {
  it('a burrowed wyrm may move onto an enemy tile; a normal unit may not', () => {
    const s = base(1);
    s.units.push(mk(1, 'wyrm_burrowed', 1, 3, 3), mk(2, 'warrior', 0, 4, 3));
    expect(moves(s, 1)).toContain('4,3'); // burrowed can move under the enemy

    const s2 = base(1);
    s2.units.push(mk(1, 'reaper', 1, 3, 3), mk(2, 'warrior', 0, 4, 3));
    expect(moves(s2, 1)).not.toContain('4,3'); // normal unit blocked by the enemy
  });

  it('a burrowed enemy wyrm does NOT block an enemy unit (it can move on top, unknowingly)', () => {
    const s = base(0); // vanguard's turn
    s.units.push(mk(1, 'warrior', 0, 3, 3), mk(2, 'wyrm_burrowed', 1, 4, 3));
    expect(moves(s, 1)).toContain('4,3'); // warrior may step onto the hidden wyrm
  });

  it('cannot burrow-move under resource tiles or cities', () => {
    const s = base(1);
    s.map.tiles[3][4].isResourceTile = true;
    s.map.tiles[3][2].isCity = true;
    s.units.push(mk(1, 'wyrm_burrowed', 1, 3, 3));
    const m = moves(s, 1);
    expect(m).not.toContain('4,3'); // resource tile
    expect(m).not.toContain('2,3'); // city
    expect(m).toContain('3,4');     // normal plains ok
  });

  it('Erupt kills the enemy sharing the wyrm’s tile and surfaces (morph back), ending the turn', () => {
    let s = base(1);
    s.units.push(mk(1, 'wyrm_burrowed', 1, 5, 5), { ...mk(2, 'defender', 0, 5, 5), hp: 20 }); // co-located
    s = applyAction(s, selfCast(1, 'erupt', { x: 5, y: 5 }), registry);
    expect(u(s, 2)).toBeUndefined();       // killed regardless of HP
    expect(u(s, 1)!.typeId).toBe('wyrm');  // surfaced
    expect(u(s, 1)!.hasAttacked).toBe(true);
  });

  it('Erupt on an empty tile just surfaces (no kill)', () => {
    let s = base(1);
    s.units.push(mk(1, 'wyrm_burrowed', 1, 5, 5));
    s = applyAction(s, selfCast(1, 'erupt', { x: 5, y: 5 }), registry);
    expect(u(s, 1)!.typeId).toBe('wyrm');
  });
});

describe('Wyrm: Burrow/Erupt tile restrictions', () => {
  it('cannot Burrow on a city, mountain, or building tile', () => {
    const onCity = () => {
      const s = base(1); s.map.tiles[3][3].isCity = true;
      s.units.push(mk(1, 'wyrm', 1, 3, 3));
      return getLegalActions(s, registry, 1).some(a => a.type === 'useAbility' && a.abilityId === 'burrow');
    };
    const onBuilding = () => {
      const s = base(1);
      s.buildings.push({ id: 1, kind: 'mine', position: { x: 3, y: 3 }, owner: 1, level: 1 } as any);
      s.units.push(mk(1, 'wyrm', 1, 3, 3));
      return getLegalActions(s, registry, 1).some(a => a.type === 'useAbility' && a.abilityId === 'burrow');
    };
    const onPlains = () => {
      const s = base(1);
      s.units.push(mk(1, 'wyrm', 1, 3, 3));
      return getLegalActions(s, registry, 1).some(a => a.type === 'useAbility' && a.abilityId === 'burrow');
    };
    expect(onCity()).toBe(false);
    expect(onBuilding()).toBe(false);
    expect(onPlains()).toBe(true);
  });

  it('cannot Erupt on a city tile (defensive: applyAction is a no-op)', () => {
    let s = base(1); s.map.tiles[3][3].isCity = true;
    s.units.push(mk(1, 'wyrm_burrowed', 1, 3, 3));
    s = applyAction(s, selfCast(1, 'erupt', { x: 3, y: 3 }), registry);
    expect(u(s, 1)!.typeId).toBe('wyrm_burrowed'); // did not surface
  });
});

describe('Blind/burrowed "bump into impassable terrain" movement', () => {
  const moveActs = (s: GameState, id: number) =>
    getLegalActions(s, registry, s.currentPlayer).filter(a => a.type === 'move' && 'unitId' in a && a.unitId === id) as MoveAction[];

  it('burrowed Wyrm: an impassable DESTINATION becomes a bump target (land short + reveal), not a normal move', () => {
    const s = base(1);
    s.map.tiles[3][5].terrain = 'mountain'; // (5,3), the far tile
    s.units.push(mk(1, 'wyrm_burrowed', 1, 3, 3));
    const acts = moveActs(s, 1);
    expect(acts.some(a => !a.bumpReveal && a.to.x === 4 && a.to.y === 3)).toBe(true);  // (4,3) normal
    expect(acts.some(a => !a.bumpReveal && a.to.x === 5 && a.to.y === 3)).toBe(false); // (5,3) not a normal stop
    const bump = acts.find(a => a.bumpReveal && a.bumpReveal.x === 5 && a.bumpReveal.y === 3);
    expect(bump).toBeDefined();
    expect(bump!.to).not.toEqual({ x: 5, y: 3 }); // lands on a valid tile short of it
  });

  it('burrowed Wyrm passes UNDER an intermediate impassable to reach the tile beyond', () => {
    const s = base(1);
    // Mountain wall at column x=4 (rows 2–4): the only route to (5,3) is under it.
    s.map.tiles[2][4].terrain = 'mountain';
    s.map.tiles[3][4].terrain = 'mountain';
    s.map.tiles[4][4].terrain = 'mountain';
    s.units.push(mk(1, 'wyrm_burrowed', 1, 3, 3));
    expect(moveActs(s, 1).some(a => !a.bumpReveal && a.to.x === 5 && a.to.y === 3)).toBe(true);

    // A normal unit (reaper, MOV 2) is blocked by the same wall.
    const s2 = base(1);
    s2.map.tiles[2][4].terrain = 'mountain';
    s2.map.tiles[3][4].terrain = 'mountain';
    s2.map.tiles[4][4].terrain = 'mountain';
    s2.units.push(mk(9, 'reaper', 1, 3, 3));
    expect(moveActs(s2, 9).some(a => a.to.x === 5 && a.to.y === 3)).toBe(false);
  });

  it('scuttling: an adjacent mountain is a selectable bump target (stay + reveal), not a normal move', () => {
    const s = base(1);
    s.map.tiles[3][4].terrain = 'mountain';
    s.units.push(mk(1, 'scuttling', 1, 3, 3));
    const acts = moveActs(s, 1);
    const bump = acts.find(a => a.bumpReveal && a.bumpReveal.x === 4 && a.bumpReveal.y === 3);
    expect(bump).toBeDefined();
    expect(bump!.to).toEqual({ x: 3, y: 3 });                                          // MOV 1 → stays put
    expect(acts.some(a => !a.bumpReveal && a.to.x === 4 && a.to.y === 3)).toBe(false); // not a normal move
  });

  it('applying a bump move lands on `to` and reveals the impassable tile', () => {
    let s = base(1);
    s.map.tiles[3][5].terrain = 'mountain';
    s.units.push(mk(1, 'wyrm_burrowed', 1, 3, 3));
    const bump = moveActs(s, 1).find(a => a.bumpReveal && a.bumpReveal.x === 5 && a.bumpReveal.y === 3)!;
    s = applyAction(s, bump, registry);
    expect(u(s, 1)!.position).toEqual(bump.to);
    expect(u(s, 1)!.hasMoved).toBe(true);
    expect((s.revealedTiles[1] ?? []).some(t => t.x === 5 && t.y === 3)).toBe(true);
  });
});

describe('Tank movement adjustment', () => {
  it('normal tank moves 1; assault tank moves 0', () => {
    expect(registry.unitTypes['tank'].movement).toBe(1);
    expect(registry.unitTypes['tank_assault'].movement).toBe(0);
  });
});
