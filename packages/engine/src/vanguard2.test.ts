import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, getVisibleState } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit, UseAbilityAction } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const fill = (s: GameState, t: string) => { for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) s.map.tiles[y][x].terrain = t; };
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
const u = (s: GameState, id: number) => s.units.find(x => x.id === id);
const base = (current: 0 | 1 = 0) => {
  let s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
  s.units = []; s.unitHomeCity = {}; s.buildings = []; s.currentPlayer = current; fill(s, 'plains');
  return s;
};
const cast = (id: number, abilityId: string, x: number, y: number): UseAbilityAction => ({ type: 'useAbility', unitId: id, abilityId, target: { x, y } });

describe('Push engine — Vindrace Ram', () => {
  it('pushes an adjacent enemy LIGHT unit one tile away (into empty plains)', () => {
    let s = base(1);
    s.units.push(mk(1, 'vindrace', 1, 3, 3), mk(2, 'scout', 0, 4, 3));
    s = applyAction(s, cast(1, 'ram', 4, 3), registry);
    expect(u(s, 2)!.position).toEqual({ x: 5, y: 3 }); // shoved from (4,3) → (5,3)
  });

  it('a light unit shoved into a blocked tile takes 2 (and the bumped light unit too), both stay', () => {
    let s = base(1);
    s.units.push(mk(1, 'vindrace', 1, 3, 3), mk(2, 'scout', 0, 4, 3), mk(3, 'warrior', 0, 5, 3));
    const s2 = u(s, 2)!.hp, s3 = u(s, 3)!.hp;
    s = applyAction(s, cast(1, 'ram', 4, 3), registry);
    expect(u(s, 2)!.position).toEqual({ x: 4, y: 3 }); // stayed
    expect(u(s, 2)!.hp).toBe(s2 - 2);
    expect(u(s, 3)!.hp).toBe(s3 - 2); // bumped light unit also took 2
  });

  it('a light unit shoved into water DIES', () => {
    let s = base(1);
    s.map.tiles[3][5].terrain = 'water';
    s.units.push(mk(1, 'vindrace', 1, 3, 3), mk(2, 'scout', 0, 4, 3));
    s = applyAction(s, cast(1, 'ram', 4, 3), registry);
    expect(u(s, 2)).toBeUndefined();
  });

  it('a HEAVY unit is immune to the push', () => {
    let s = base(1);
    s.units.push(mk(1, 'vindrace', 1, 3, 3), mk(2, 'tank', 0, 4, 3));
    const hp = u(s, 2)!.hp;
    s = applyAction(s, cast(1, 'ram', 4, 3), registry);
    expect(u(s, 2)!.position).toEqual({ x: 4, y: 3 });
    expect(u(s, 2)!.hp).toBe(hp);
  });
});

describe('Titan — Percussive Shells', () => {
  it('center light unit takes a hit; adjacent light units are pushed; heavy units are immune', () => {
    let s = base(0);
    s.units.push(
      mk(1, 'titan', 0, 3, 3),
      mk(2, 'defender', 1, 5, 5), // impact center (light, tanky) — takes a hit, survives
      mk(3, 'scout', 1, 6, 5),    // neighbour (offset +1,0) → pushed to (7,5)
      mk(4, 'tank', 1, 5, 6),     // neighbour heavy → immune
    );
    const centerHp = u(s, 2)!.hp, tankHp = u(s, 4)!.hp;
    s = applyAction(s, cast(1, 'percussive_shells', 5, 5), registry);
    expect(u(s, 2)!.hp).toBeLessThan(centerHp);       // center took the hit
    expect(u(s, 3)!.position).toEqual({ x: 7, y: 5 }); // pushed outward
    expect(u(s, 4)!.position).toEqual({ x: 5, y: 6 }); // heavy unmoved
    expect(u(s, 4)!.hp).toBe(tankHp);
  });
});

describe('Combined Arms — light unit repeat-shot ×1.2 per target', () => {
  it('the 2nd light attack on the same target hits harder than the 1st', () => {
    const drop = (withTech: boolean) => {
      let s = base(0);
      if (withTech) s.players[0].researchedTechs = ['combined_arms'];
      s.units.push(mk(1, 'lancer', 0, 3, 3), mk(2, 'lancer', 0, 3, 4), { ...mk(3, 'defender', 1, 4, 3), hp: 20 });
      const before = u(s, 3)!.hp;
      s = applyAction(s, { type: 'attack', unitId: 1, targetId: 3 }, registry);
      const afterFirst = u(s, 3)!.hp;
      s = applyAction(s, { type: 'attack', unitId: 2, targetId: 3 }, registry);
      const afterSecond = u(s, 3)!.hp;
      return { first: before - afterFirst, second: afterFirst - afterSecond };
    };
    const withCA = drop(true);
    expect(withCA.second).toBeGreaterThan(withCA.first); // 2nd shot boosted
    const noCA = drop(false);
    expect(noCA.second).toBe(noCA.first); // no tech → identical
  });
});

describe('Sentinel', () => {
  it('cannot attack (attack 0) and flies over water', () => {
    const s = base(0);
    s.map.tiles[3][4].terrain = 'water';
    s.units.push(mk(1, 'sentinel', 0, 3, 3), mk(2, 'warrior', 1, 3, 4));
    const acts = getLegalActions(s, registry, 0).filter(a => 'unitId' in a && a.unitId === 1);
    expect(acts.some(a => a.type === 'attack')).toBe(false);
    expect(acts.some(a => a.type === 'move' && (a as any).to.x === 4 && (a as any).to.y === 3)).toBe(true); // over water
  });

  it('Detect II reveals a cloaked enemy at range 2 (where plain Detect would not)', () => {
    const s = base(0);
    s.units.push(mk(1, 'wraith', 0, 3, 3), mk(2, 'sentinel', 1, 3, 5)); // dist 2
    expect(getVisibleState(s, 1, registry).units.some(x => x.id === 1)).toBe(true);
  });

  it('Kinetic Shield absorbs the next hit on a friendly unit', () => {
    let s = base(0);
    s.units.push(mk(1, 'sentinel', 0, 3, 3), mk(2, 'warrior', 0, 4, 3), mk(3, 'warrior', 1, 5, 3));
    s = applyAction(s, cast(1, 'kinetic_shield', 4, 3), registry);
    expect(u(s, 2)!.statuses).toContain('shielded');
    const hp = u(s, 2)!.hp;
    s.currentPlayer = 1;
    s = applyAction(s, { type: 'attack', unitId: 3, targetId: 2 }, registry);
    expect(u(s, 2)!.hp).toBe(hp);                       // fully absorbed
    expect(u(s, 2)!.statuses ?? []).not.toContain('shielded'); // shield spent
  });

  it('Overwatch Network I gives an adjacent friendly ranged unit +1 attack range', () => {
    const canHit = (withSentinel: boolean) => {
      const s = base(0);
      s.units.push(mk(1, 'lancer', 0, 3, 3), mk(2, 'warrior', 1, 6, 3)); // dist 3, lancer range 2
      if (withSentinel) s.units.push(mk(3, 'sentinel', 0, 3, 4)); // adjacent friendly Sentinel
      return getLegalActions(s, registry, 0).some(a => a.type === 'attack' && a.unitId === 1 && a.targetId === 2);
    };
    expect(canHit(false)).toBe(false); // range 2 can't reach dist 3
    expect(canHit(true)).toBe(true);   // +1 from Overwatch → range 3
  });
});
