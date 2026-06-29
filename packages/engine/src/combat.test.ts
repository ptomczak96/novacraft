import { describe, it, expect } from 'vitest';
import { previewCombat } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameMap, Unit, UnitType } from './types.js';

const registry = buildRegistry();
const combatConfig = defaultConfig.combatConfig;

// A generic unit type (atk 5 / def 5 / 20 HP, melee) with per-test overrides.
function ut(over: Partial<UnitType> = {}): UnitType {
  return {
    id: 't', name: 'T', faction: 'shared', cost: 0, maxHP: 20, attack: 5, defence: 5,
    movement: 2, attackRange: 1, visibility: 1, abilities: [], traits: [], ...over,
  };
}
function unit(id: number, hp: number, x: number, y: number): Unit {
  return { id, typeId: 't', owner: id, position: { x, y }, hp, hasMoved: false, hasAttacked: false, abilityCooldowns: {} };
}
function plainsMap(w = 6, h = 6): GameMap {
  return {
    width: w, height: h,
    tiles: Array.from({ length: h }, () => Array.from({ length: w }, () => ({
      terrain: 'plains', owner: null, isCity: false, isResourceTile: false,
    }))),
  };
}
const fight = (aType: UnitType, dType: UnitType, map: GameMap, a: Unit, d: Unit) =>
  previewCombat(a, aType, d, dType, map, registry, combatConfig);

describe('Combat — Polytopia force formula (spec)', () => {
  it('equal full-HP duel: both deal equal damage and survive, retaliation happens', () => {
    const map = plainsMap();
    const r = fight(ut(), ut(), map, unit(0, 20, 0, 0), unit(1, 20, 1, 0));
    // attackForce 5, defenseForce 5, total 10 → both = round(0.5*5*4.5)=11
    expect(r.attackerDamage).toBe(11);
    expect(r.defenderRetaliation).toBe(11);
    expect(r.defenderKilled).toBe(false);
    expect(r.attackerKilled).toBe(false);
    expect(r.retaliationBreakdown).not.toBeNull();
  });

  it('a diagonal melee attack still triggers retaliation (Chebyshev, matches attack range)', () => {
    const map = plainsMap();
    // Attacker (0,0) and defender (1,1) are diagonally adjacent — Chebyshev distance 1.
    const r = fight(ut(), ut(), map, unit(0, 20, 0, 0), unit(1, 20, 1, 1));
    expect(r.defenderRetaliation).toBeGreaterThan(0);
    expect(r.retaliationBreakdown).not.toBeNull();
  });

  it('retaliation is driven by the defender’s DEFENSE, not its attack', () => {
    const map = plainsMap();
    // Defender has huge attack but tiny defense → retaliation must be tiny.
    const r = fight(ut(), ut({ attack: 20, defence: 1 }), map, unit(0, 20, 0, 0), unit(1, 20, 1, 0));
    // defenseForce = 1, total = 6, defenseResult = round((1/6)*1*4.5) = round(0.75) = 1
    expect(r.defenderRetaliation).toBe(1);
  });

  it('ranged attacker outside the defender’s range takes no retaliation', () => {
    const map = plainsMap();
    const ranged = ut({ attackRange: 2 });
    const melee = ut({ attackRange: 1 });
    const r = fight(ranged, melee, map, unit(0, 20, 0, 0), unit(1, 20, 2, 0)); // dist 2 > defender range 1
    expect(r.defenderKilled).toBe(false);
    expect(r.defenderRetaliation).toBe(0);
    expect(r.retaliationBreakdown).toBeNull();
  });

  it('defensive terrain (forest ×1.5) reduces damage to the defender', () => {
    const plains = plainsMap();
    const forest = plainsMap();
    forest.tiles[0][1].terrain = 'forest';
    const onPlains = fight(ut(), ut(), plains, unit(0, 20, 0, 0), unit(1, 20, 1, 0)).attackerDamage;
    const onForest = fight(ut(), ut(), forest, unit(0, 20, 0, 0), unit(1, 20, 1, 0)).attackerDamage;
    expect(onForest).toBeLessThan(onPlains);
    expect(onForest).toBe(9); // defenseForce 7.5, total 12.5 → round(0.4*5*4.5)=9
  });

  it('forest gives LIGHT units only ×1.2 cover (heavier units still ×1.5)', () => {
    const map = plainsMap();
    map.tiles[0][1].terrain = 'forest';
    const light = fight(ut(), ut({ unitClass: 'light' }), map, unit(0, 20, 0, 0), unit(1, 20, 1, 0));
    expect(light.attackBreakdown.terrainBonus).toBe(1.2);
    const heavy = fight(ut(), ut({ unitClass: 'heavy' }), map, unit(0, 20, 0, 0), unit(1, 20, 1, 0));
    expect(heavy.attackBreakdown.terrainBonus).toBe(1.5);
  });

  it('the corrosive status cuts the defender’s effective defence (−20%)', () => {
    const map = plainsMap();
    const tough = ut({ defence: 10 }); // high def so the 20% cut survives rounding
    const normal = fight(ut(), tough, map, unit(0, 20, 0, 0), unit(1, 20, 1, 0)).attackerDamage;
    const corroded = fight(ut(), tough, map, unit(0, 20, 0, 0), { ...unit(1, 20, 1, 0), statuses: ['corrosive'] }).attackerDamage;
    expect(corroded).toBeGreaterThan(normal);
  });

  it('a non-fortified city still gives ×1.5 defense', () => {
    const map = plainsMap();
    map.tiles[0][1].isCity = true;
    const r = fight(ut(), ut(), map, unit(0, 20, 0, 0), unit(1, 20, 1, 0));
    expect(r.attackBreakdown.terrainBonus).toBe(1.5);
  });

  it('a fortified city gives ×3 defense (more than terrain, less damage taken)', () => {
    const map = plainsMap();
    map.tiles[0][1].isCity = true;
    map.tiles[0][1].fortified = true;
    const r = fight(ut(), ut(), map, unit(0, 20, 0, 0), unit(1, 20, 1, 0));
    expect(r.attackBreakdown.terrainBonus).toBe(3);
    // defenseForce 15, total 20 → round(0.25*5*4.5)=6
    expect(r.attackerDamage).toBe(6);
  });

  it('low-HP attacker deals less (HP scaling)', () => {
    const map = plainsMap();
    const full = fight(ut(), ut(), map, unit(0, 20, 0, 0), unit(1, 20, 1, 0)).attackerDamage;
    const hurt = fight(ut(), ut(), map, unit(0, 10, 0, 0), unit(1, 20, 1, 0)).attackerDamage; // half HP
    expect(hurt).toBeLessThan(full);
  });

  it('a lethal hit kills the defender and skips retaliation', () => {
    const map = plainsMap();
    const r = fight(ut({ attack: 10 }), ut({ defence: 1 }), map, unit(0, 20, 0, 0), unit(1, 5, 1, 0));
    expect(r.defenderKilled).toBe(true);
    expect(r.defenderRetaliation).toBe(0);
    expect(r.retaliationBreakdown).toBeNull();
  });
});
