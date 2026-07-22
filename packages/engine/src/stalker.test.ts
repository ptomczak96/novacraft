import { describe, it, expect } from 'vitest';
import { createGame, getLegalActions, previewAttack, effectiveAttackRange } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const fill = (s: GameState, t: string) => { for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) s.map.tiles[y][x].terrain = t; };
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });

describe('Stalker: Mountain Shooter 2 (granted by Precision Targeting)', () => {
  const stalkerType = () => registry.unitTypes['stalker'];
  const withMS2 = () => ({ ...stalkerType(), conditions: [...(stalkerType().conditions ?? []), 'mountain_shooter_2'] });

  it('the BASE Stalker has range 2 even on a mountain (no baked-in bonus)', () => {
    expect(effectiveAttackRange(stalkerType(), { terrain: 'plains' })).toBe(2);
    expect(effectiveAttackRange(stalkerType(), { terrain: 'mountain' })).toBe(2);
  });

  it('Mountain Shooter II grants +1 range on a mountain (range 3)', () => {
    expect(effectiveAttackRange(withMS2(), { terrain: 'plains' })).toBe(2);
    expect(effectiveAttackRange(withMS2(), { terrain: 'mountain' })).toBe(3);
  });

  it('a Stalker on a mountain can hit range 3 ONLY once Precision Targeting is researched', () => {
    // Tech tree OFF pre-researches everything (incl. Precision Targeting) → the grant applies.
    const withTech = createGame(cfg({ techTreeEnabled: false }), registry, ['vanguard', 'hive'], 7);
    withTech.units = []; withTech.unitHomeCity = {}; withTech.currentPlayer = 0; fill(withTech, 'plains');
    withTech.map.tiles[3][3].terrain = 'mountain';
    withTech.units.push(mk(1, 'stalker', 0, 3, 3), mk(2, 'warrior', 1, 6, 3)); // dist 3
    expect(getLegalActions(withTech, registry, 0).some(a => a.type === 'attack' && a.unitId === 1)).toBe(true);

    // Tech tree ON, nothing researched → base Stalker on a mountain still has range 2.
    const noTech = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    noTech.units = []; noTech.unitHomeCity = {}; noTech.currentPlayer = 0; fill(noTech, 'plains');
    noTech.map.tiles[3][3].terrain = 'mountain';
    noTech.units.push(mk(1, 'stalker', 0, 3, 3), mk(2, 'warrior', 1, 6, 3));
    expect(getLegalActions(noTech, registry, 0).some(a => a.type === 'attack' && a.unitId === 1)).toBe(false);
  });

  it('with Mountain Shooter II, a Stalker deals +20% attack while on a mountain', () => {
    const dmgFrom = (terrain: string) => {
      const s = createGame(cfg({ techTreeEnabled: false }), registry, ['vanguard', 'hive'], 7); // grant applied
      s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0; fill(s, 'plains');
      s.map.tiles[3][3].terrain = terrain;
      s.units.push(mk(1, 'stalker', 0, 3, 3), mk(2, 'defender', 1, 5, 3)); // DEF 3, within range 2
      return previewAttack(s, 1, 2, registry)!.attackerDamage;
    };
    expect(dmgFrom('mountain')).toBeGreaterThan(dmgFrom('plains'));
  });

  it('can still climb mountains (base mountain_movement)', () => {
    const s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0; fill(s, 'plains');
    s.map.tiles[3][4].terrain = 'mountain';
    s.units.push(mk(1, 'stalker', 0, 3, 3));
    const canStep = getLegalActions(s, registry, 0).some(a => a.type === 'move' && a.unitId === 1 && a.to.x === 4 && a.to.y === 3);
    expect(canStep).toBe(true);
  });
});
