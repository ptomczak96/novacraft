import type { Unit, UnitType, GameMap, CombatConfig, DataRegistry, Tile } from './types.js';
import type { PRNGState } from './prng.js';

export interface CombatBreakdown {
  attackForce: number;
  defenseForce: number;
  totalForce: number;
  terrainBonus: number;     // the defenseBonus multiplier (1.0 or 1.5)
  terrainName: string;      // e.g. "Forest", "Plains (City)"
  rawDamage: number;        // before rounding/min
  finalDamage: number;      // after rounding/min
}

export interface CombatResult {
  attackerDamage: number;        // damage dealt TO defender
  defenderRetaliation: number;   // damage dealt TO attacker
  defenderKilled: boolean;
  attackerKilled: boolean;
  prng: PRNGState;
  attackBreakdown: CombatBreakdown;
  retaliationBreakdown: CombatBreakdown | null;
}

/**
 * Polytopia force-ratio combat formula.
 *
 *   attackForce  = attackStat  * (attackerHP / attackerMaxHP)
 *   defenseForce = defenceStat * (defenderHP / defenderMaxHP) * defenseBonus
 *   totalForce   = attackForce + defenseForce
 *   damage       = round((attackForce / totalForce) * attackStat * 4.5)
 *   minimum      = config.minimumDamage (1)
 */
export function calculateDamage(
  attackStat: number,
  attackerHP: number,
  attackerMaxHP: number,
  defenceStat: number,
  defenderHP: number,
  defenderMaxHP: number,
  defenseBonus: number,
  minimumDamage: number,
): { damage: number; breakdown: CombatBreakdown } {
  const attackForce = attackStat * (attackerHP / attackerMaxHP);
  const defenseForce = defenceStat * (defenderHP / defenderMaxHP) * defenseBonus;
  const totalForce = attackForce + defenseForce;

  const rawDamage = (attackForce / totalForce) * attackStat * 4.5;
  const finalDamage = Math.max(minimumDamage, Math.round(rawDamage));

  return {
    damage: finalDamage,
    breakdown: {
      attackForce,
      defenseForce,
      totalForce,
      terrainBonus: defenseBonus,
      terrainName: '', // filled by caller
      rawDamage,
      finalDamage,
    },
  };
}

/** Determine the Polytopia defense multiplier for a tile. */
function getDefenseMultiplier(tile: Tile, terrain: { defenceBonus: number } | undefined): number {
  if (tile.isCity) return 1.5;
  if (terrain && terrain.defenceBonus > 0) return 1.5;
  return 1.0;
}

/** Build a terrain label for the combat breakdown. */
function getTerrainLabel(tile: Tile, terrain: { name: string } | undefined): string {
  const name = terrain?.name ?? 'Unknown';
  return tile.isCity ? `${name} (City)` : name;
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
  // Defender terrain
  const defenderTile = map.tiles[defender.position.y][defender.position.x];
  const defenderTerrain = registry.terrainTypes[defenderTile.terrain];
  const defenderDefenseMultiplier = getDefenseMultiplier(defenderTile, defenderTerrain);

  // Attacker deals damage to defender
  const { damage: damageToDefender, breakdown: attackBreakdown } = calculateDamage(
    attackerType.attack,
    attacker.hp,
    attackerType.maxHP,
    defenderType.defence,
    defender.hp,
    defenderType.maxHP,
    defenderDefenseMultiplier,
    config.minimumDamage,
  );
  attackBreakdown.terrainName = getTerrainLabel(defenderTile, defenderTerrain);

  const defenderHPAfter = defender.hp - damageToDefender;
  const defenderKilled = defenderHPAfter <= 0;

  // Retaliation: only if defender survives AND attacker is within defender's attack range
  let damageToAttacker = 0;
  let retaliationBreakdown: CombatBreakdown | null = null;

  if (!defenderKilled) {
    const dist = Math.abs(attacker.position.x - defender.position.x) +
                 Math.abs(attacker.position.y - defender.position.y);

    if (dist <= defenderType.attackRange) {
      const attackerTile = map.tiles[attacker.position.y][attacker.position.x];
      const attackerTerrain = registry.terrainTypes[attackerTile.terrain];
      const attackerDefenseMultiplier = getDefenseMultiplier(attackerTile, attackerTerrain);

      // Retaliation uses defender's POST-DAMAGE HP (natural Polytopia scaling)
      const { damage, breakdown } = calculateDamage(
        defenderType.attack,
        defenderHPAfter,       // reduced HP
        defenderType.maxHP,
        attackerType.defence,
        attacker.hp,
        attackerType.maxHP,
        attackerDefenseMultiplier,
        config.minimumDamage,
      );
      damageToAttacker = damage;
      retaliationBreakdown = breakdown;
      retaliationBreakdown.terrainName = getTerrainLabel(attackerTile, attackerTerrain);
    }
  }

  const attackerHPAfter = attacker.hp - damageToAttacker;
  const attackerKilled = attackerHPAfter <= 0;

  return {
    attackerDamage: damageToDefender,
    defenderRetaliation: damageToAttacker,
    defenderKilled,
    attackerKilled,
    prng, // Polytopia formula is deterministic — PRNG passes through unchanged
    attackBreakdown,
    retaliationBreakdown,
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
): CombatResult {
  return resolveCombat(attacker, attackerType, defender, defenderType, map, registry, config, { seed: 0, state: 0 });
}
