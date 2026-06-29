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
/**
 * Canonical Polytopia force computation. Attacker A hits defender D; BOTH the
 * attack damage and the retaliation (defenseResult) come from ONE force split,
 * using each side's CURRENT (pre-damage) HP. Rounding (half-up) happens only at
 * the final step.
 *
 *   attackForce   = A.attack  * (A.hp / A.maxHP)
 *   defenseForce  = D.defense * (D.hp / D.maxHP) * defenseBonus   // bonus on defense only
 *   total         = attackForce + defenseForce
 *   attackResult  = round( (attackForce  / total) * A.attack  * 4.5 )   // D loses this
 *   defenseResult = round( (defenseForce / total) * D.defense * 4.5 )   // A loses this (retaliation)
 */
export interface Forces {
  attackForce: number;
  defenseForce: number;
  totalForce: number;
  attackResult: number;
  defenseResult: number;
}

export function computeForces(
  attackStat: number,
  attackerHP: number,
  attackerMaxHP: number,
  defenceStat: number,
  defenderHP: number,
  defenderMaxHP: number,
  defenseBonus: number,
): Forces {
  const attackForce = attackStat * (attackerHP / attackerMaxHP);
  const defenseForce = defenceStat * (defenderHP / defenderMaxHP) * defenseBonus;
  const totalForce = attackForce + defenseForce;

  const attackResult = totalForce > 0 ? Math.round((attackForce / totalForce) * attackStat * 4.5) : 0;
  const defenseResult = totalForce > 0 ? Math.round((defenseForce / totalForce) * defenceStat * 4.5) : 0;

  return { attackForce, defenseForce, totalForce, attackResult, defenseResult };
}

/** Back-compat: the attack-side result only (D's HP loss from A's hit). */
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
  const f = computeForces(attackStat, attackerHP, attackerMaxHP, defenceStat, defenderHP, defenderMaxHP, defenseBonus);
  const finalDamage = Math.max(minimumDamage, f.attackResult);
  return {
    damage: finalDamage,
    breakdown: {
      attackForce: f.attackForce,
      defenseForce: f.defenseForce,
      totalForce: f.totalForce,
      terrainBonus: defenseBonus,
      terrainName: '',
      rawDamage: (f.attackForce / (f.totalForce || 1)) * attackStat * 4.5,
      finalDamage,
    },
  };
}

// A Fortified city acts as "walls" (there is no separate wall-building action):
// a unit standing in a fortified city gets ×3 to its defense force. This replaces
// any terrain bonus (it doesn't stack). A normal (un-fortified) city grants NO
// inherent defense bonus — only its terrain, like any other tile.
const FORTIFY_DEFENSE_MULTIPLIER = 3.0;

/**
 * Defense-force multiplier for the tile a unit defends on:
 *   ×3.0  fortified city ("walls")
 *   ×1.5  any city tile
 *   ×1.2  forest — but ONLY for LIGHT units (heavier units get no forest cover)
 *   ×1.0  everything else, incl. mountains and open ground
 */
export function getDefenseMultiplier(
  tile: Tile,
  terrain: { id: string; defenceBonus: number } | undefined,
  defenderType: { unitClass?: string; conditions?: string[] } | undefined,
): number {
  if (tile.fortified) return FORTIFY_DEFENSE_MULTIPLIER;
  if (tile.isCity) return 1.5;
  // Forest cover — light units only. Mountain cover — only "mountain_defense" units.
  if (terrain?.id === 'forest' && defenderType?.unitClass === 'light') return 1.2;
  if (terrain?.id === 'mountain' && defenderType?.conditions?.includes('mountain_defense')) return 1.2;
  return 1.0;
}

/** Build a terrain label for the combat breakdown. */
function getTerrainLabel(tile: Tile, terrain: { name: string } | undefined): string {
  const name = terrain?.name ?? 'Unknown';
  if (tile.fortified) return `${name} (Fortified)`;
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
  // Defender's tile gives the defense bonus (applied to defenseForce only).
  const defenderTile = map.tiles[defender.position.y][defender.position.x];
  const defenderTerrain = registry.terrainTypes[defenderTile.terrain];
  const defenderDefenseMultiplier = getDefenseMultiplier(defenderTile, defenderTerrain, defenderType);

  // "Corrosive" status on the defender: −20% to its defence stat (see docs/conditions.md).
  const corroded = defender.statuses?.includes('corrosive') ?? false;
  const effectiveDefence = defenderType.defence * (corroded ? 0.8 : 1);

  // "Mountain shooter": +20% attack while the attacker stands on a mountain.
  const attackerTile = map.tiles[attacker.position.y]?.[attacker.position.x];
  const mountainShooter = attackerTile?.terrain === 'mountain' && (attackerType.conditions?.includes('mountain_shooter') ?? false);
  const effectiveAttack = attackerType.attack * (mountainShooter ? 1.2 : 1);

  // ONE force split yields both the attack damage and the retaliation, from the
  // sides' current (pre-damage) HP. Canonical Polytopia: retaliation = defenseResult
  // (driven by the DEFENDER'S DEFENSE stat), not a fresh counter-attack.
  const f = computeForces(
    effectiveAttack, attacker.hp, attackerType.maxHP,
    effectiveDefence, defender.hp, defenderType.maxHP,
    defenderDefenseMultiplier,
  );

  // Attack: apply to the defender. (House rule: floor at config.minimumDamage so a
  // hit always lands; the spec's only mandated floor-to-skip is on retaliation.)
  const damageToDefender = Math.max(config.minimumDamage, f.attackResult);
  const attackBreakdown: CombatBreakdown = {
    attackForce: f.attackForce,
    defenseForce: f.defenseForce,
    totalForce: f.totalForce,
    terrainBonus: defenderDefenseMultiplier,
    terrainName: getTerrainLabel(defenderTile, defenderTerrain),
    rawDamage: (f.attackForce / (f.totalForce || 1)) * effectiveAttack * 4.5,
    finalDamage: damageToDefender,
  };

  const defenderHPAfter = defender.hp - damageToDefender;
  const defenderKilled = defenderHPAfter <= 0;

  // Retaliation = defenseResult, skipped if the defender died, the attacker is
  // outside the defender's range, or defenseResult rounds to 0.
  let damageToAttacker = 0;
  let retaliationBreakdown: CombatBreakdown | null = null;

  // Chebyshev distance — MUST match attack legality (pathfinding `inRange`), else a
  // diagonal melee attack (range 1) would wrongly skip retaliation.
  const dist = Math.max(
    Math.abs(attacker.position.x - defender.position.x),
    Math.abs(attacker.position.y - defender.position.y),
  );
  const attackerInDefenderRange = dist <= defenderType.attackRange;

  if (!defenderKilled && attackerInDefenderRange && f.defenseResult > 0) {
    damageToAttacker = f.defenseResult;
    retaliationBreakdown = {
      attackForce: f.attackForce,
      defenseForce: f.defenseForce,
      totalForce: f.totalForce,
      terrainBonus: defenderDefenseMultiplier,
      terrainName: getTerrainLabel(defenderTile, defenderTerrain),
      rawDamage: (f.defenseForce / (f.totalForce || 1)) * defenderType.defence * 4.5,
      finalDamage: damageToAttacker,
    };
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
