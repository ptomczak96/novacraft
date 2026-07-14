import { describe, it, expect } from 'vitest';
import { createGame, getLegalActions, previewCombat, effectiveAttackRange } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const fill = (s: GameState, t: string) => { for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) s.map.tiles[y][x].terrain = t; };
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });

describe('Stalker: Mountain Shooter 2', () => {
  const stalkerType = () => registry.unitTypes['stalker'];

  it('effectiveAttackRange is base 2 off a mountain, 3 on a mountain', () => {
    expect(effectiveAttackRange(stalkerType(), { terrain: 'plains' })).toBe(2);
    expect(effectiveAttackRange(stalkerType(), { terrain: 'mountain' })).toBe(3);
  });

  it('can only hit a range-3 target while standing on a mountain', () => {
    // Plains everywhere: range 2, so a target 3 tiles away is NOT attackable.
    let s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0; fill(s, 'plains');
    s.units.push(mk(1, 'stalker', 0, 3, 3), mk(2, 'warrior', 1, 6, 3)); // dist 3
    const offPlains = getLegalActions(s, registry, 0).some(a => a.type === 'attack' && a.unitId === 1);
    expect(offPlains).toBe(false);

    // Same board, but the Stalker's tile is a mountain → range 3 reaches it.
    let s2 = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    s2.units = []; s2.unitHomeCity = {}; s2.currentPlayer = 0; fill(s2, 'plains');
    s2.map.tiles[3][3].terrain = 'mountain';
    s2.units.push(mk(1, 'stalker', 0, 3, 3), mk(2, 'warrior', 1, 6, 3));
    const onMountain = getLegalActions(s2, registry, 0).some(a => a.type === 'attack' && a.unitId === 1);
    expect(onMountain).toBe(true);
  });

  it('deals +20% attack while on a mountain', () => {
    const dmgFrom = (terrain: string) => {
      const s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
      s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0; fill(s, 'plains');
      s.map.tiles[3][3].terrain = terrain;
      s.units.push(mk(1, 'stalker', 0, 3, 3), mk(2, 'defender', 1, 5, 3)); // DEF 3, within range 2
      return previewCombat(s.units[0], registry.unitTypes['stalker'], s.units[1], registry.unitTypes['defender'], s.map, registry, s.config.combatConfig).attackerDamage;
    };
    expect(dmgFrom('mountain')).toBeGreaterThan(dmgFrom('plains'));
  });

  it('can climb mountains (mountain_movement / mountain_shooter_2 grant access)', () => {
    const s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0; fill(s, 'plains');
    s.map.tiles[3][4].terrain = 'mountain';
    s.units.push(mk(1, 'stalker', 0, 3, 3));
    const canStep = getLegalActions(s, registry, 0).some(a => a.type === 'move' && a.unitId === 1 && a.to.x === 4 && a.to.y === 3);
    expect(canStep).toBe(true);
  });
});
