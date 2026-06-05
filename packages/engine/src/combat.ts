import type { Unit, UnitType, GameMap, CombatConfig, DataRegistry } from './types.js';
import type { PRNGState } from './prng.js';
import { nextRandom } from './prng.js';

export interface CombatResult {
  attackerDamage: number; // damage dealt TO defender
  defenderRetaliation: number; // damage dealt TO attacker
  defenderKilled: boolean;
  attackerKilled: boolean;
  prng: PRNGState;
}

export function calculateDamage(
  attackerAttack: number,
  attackerHP: number,
  attackerMaxHP: number,
  defenderDefence: number,
  terrainDefenceBonus: number,
  config: CombatConfig,
  prng: PRNGState,
  isRetaliation: boolean = false,
): [number, PRNGState] {
  let attack = attackerAttack;
  if (isRetaliation) {
    attack = attack * config.retaliationMultiplier;
  }

  let damage = attack;
  if (config.hpScaling) {
    damage = damage * (attackerHP / attackerMaxHP);
  }

  // Apply terrain defence modifier
  damage = damage * (1 - terrainDefenceBonus);

  // Subtract defender's defence
  damage = damage - defenderDefence;

  // Apply variance if configured
  let currentPrng = prng;
  if (config.damageVariance > 0) {
    const [roll, next] = nextRandom(prng);
    currentPrng = next;
    const varianceFactor = 1 + (roll * 2 - 1) * config.damageVariance;
    damage = damage * varianceFactor;
  }

  damage = Math.max(config.minimumDamage, Math.floor(damage));
  return [damage, currentPrng];
}

export function resolveCombat(
  attacker: Unit,
  attackerType: UnitType,
  defender: Unit,
  defenderType: UnitType,
  map: GameMap,
  registry: DataRegistry,
  config: CombatConfig,
  prng: PRNGState,
): CombatResult {
  const defenderTile = map.tiles[defender.position.y][defender.position.x];
  const defenderTerrain = registry.terrainTypes[defenderTile.terrain];
  const defenderTerrainBonus = defenderTerrain ? defenderTerrain.defenceBonus : 0;

  // Attacker deals damage
  const [attackerDamage, prng2] = calculateDamage(
    attackerType.attack,
    attacker.hp,
    attackerType.maxHP,
    defenderType.defence,
    defenderTerrainBonus,
    config,
    prng,
    false,
  );

  const defenderHPAfter = defender.hp - attackerDamage;
  const defenderKilled = defenderHPAfter <= 0;

  // Retaliation: only if defender survives and attacker is within defender's range
  let defenderRetaliation = 0;
  let prng3 = prng2;

  if (!defenderKilled) {
    const dist = Math.abs(attacker.position.x - defender.position.x) +
                 Math.abs(attacker.position.y - defender.position.y);

    if (dist <= defenderType.attackRange) {
      const attackerTile = map.tiles[attacker.position.y][attacker.position.x];
      const attackerTerrain = registry.terrainTypes[attackerTile.terrain];
      const attackerTerrainBonus = attackerTerrain ? attackerTerrain.defenceBonus : 0;

      [defenderRetaliation, prng3] = calculateDamage(
        defenderType.attack,
        defenderHPAfter,
        defenderType.maxHP,
        attackerType.defence,
        attackerTerrainBonus,
        config,
        prng2,
        true,
      );
    }
  }

  const attackerHPAfter = attacker.hp - defenderRetaliation;
  const attackerKilled = attackerHPAfter <= 0;

  return {
    attackerDamage,
    defenderRetaliation,
    defenderKilled,
    attackerKilled,
    prng: prng3,
  };
}

/** Preview combat result without modifying state. */
export function previewCombat(
  attacker: Unit,
  attackerType: UnitType,
  defender: Unit,
  defenderType: UnitType,
  map: GameMap,
  registry: DataRegistry,
  config: CombatConfig,
): { damageToDefender: number; damageToAttacker: number; defenderKilled: boolean; attackerKilled: boolean } {
  // For preview, use a throwaway PRNG state (only matters if damageVariance > 0)
  const result = resolveCombat(attacker, attackerType, defender, defenderType, map, registry, config, { seed: 0, state: 0 });
  return {
    damageToDefender: result.attackerDamage,
    damageToAttacker: result.defenderRetaliation,
    defenderKilled: result.defenderKilled,
    attackerKilled: result.attackerKilled,
  };
}
