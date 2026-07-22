import type { Unit, UnitType, GameMap, CombatConfig, DataRegistry, Tile } from './types.js';
import type { PRNGState } from './prng.js';

/** A single named multiplier applied to attack or defence (buff or debuff). */
export interface CombatMod {
  label: string; // e.g. "Combined Arms", "City", "Corrosive I"
  mult: number;  // e.g. 1.2, 1.5, 0.8
}

export interface CombatBreakdown {
  attackForce: number;
  defenseForce: number;
  totalForce: number;
  terrainBonus: number;     // the defenseBonus multiplier (1.0 or 1.5)
  terrainName: string;      // e.g. "Forest", "Plains (City)"
  rawDamage: number;        // before rounding/min
  finalDamage: number;      // after rounding/min
  // Granular buff/debuff breakdown (for the combat log). Effective = base × all mods.
  baseAttack: number;       // attacker's printed attack stat
  effectiveAttack: number;  // after attackMods (mountain shooter, bile, combined arms…)
  attackMods: CombatMod[];  // only mods that changed it (mult ≠ 1)
  baseDefence: number;      // defender's printed defence stat
  effectiveDefence: number; // after defenceMods (terrain/city/fortify, corrosive, bile)
  defenceMods: CombatMod[]; // only mods that changed it (mult ≠ 1)
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
      baseAttack: attackStat,
      effectiveAttack: attackStat,
      attackMods: [],
      baseDefence: defenceStat,
      effectiveDefence: defenceStat * defenseBonus,
      defenceMods: [],
    },
  };
}

// A Fortified city acts as "walls" (there is no separate wall-building action):
// a unit standing in a fortified city gets ×3 to its defense force. This replaces
// any terrain bonus (it doesn't stack). A normal (un-fortified) city grants ×1.5.
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

/**
 * A unit's effective attack range from a given tile. "Mountain shooter 2" grants
 * +1 attack range while the unit stands on a mountain (see docs/conditions.md).
 */
export function effectiveAttackRange(
  unitType: { attackRange: number; conditions?: string[] },
  tile: { terrain: string } | undefined,
): number {
  const onMountain = tile?.terrain === 'mountain';
  const bonus = onMountain && (unitType.conditions?.includes('mountain_shooter_2') ?? false) ? 1 : 0;
  return unitType.attackRange + bonus;
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
  attackMultiplier: number = 1, // e.g. Combined Arms repeat-shot ×1.2
): CombatResult {
  // Defender's tile gives the defense bonus (applied to defenseForce only).
  const defenderTile = map.tiles[defender.position.y][defender.position.x];
  const defenderTerrain = registry.terrainTypes[defenderTile.terrain];
  const defenderDefenseMultiplier = getDefenseMultiplier(defenderTile, defenderTerrain, defenderType);

  // "Corrosive" condition on the defender: cuts its defence stat (see docs/conditions.md).
  // corrosive_1 → −20%, corrosive_2 → −30% (does not stack; the higher level wins).
  const statuses = defender.statuses ?? [];
  const corrosionMult = statuses.includes('corrosive_2') ? 0.7 : statuses.includes('corrosive_1') ? 0.8 : 1;

  // "Spray Bile" (infected tile): friendly units (owner === bile.owner) get DEF ×1.2;
  // enemies get DEF ×0.8. See docs/conditions.md.
  const defBileMult = defenderTile.bile ? (defenderTile.bile.owner === defender.owner ? 1.2 : 0.8) : 1;
  const effectiveDefence = defenderType.defence * corrosionMult * defBileMult;

  // "Mountain shooter" / "Mountain shooter 2": +20% attack while on a mountain.
  const attackerTile = map.tiles[attacker.position.y]?.[attacker.position.x];
  const attackerOnMountain = attackerTile?.terrain === 'mountain';
  const mountainShooter = attackerOnMountain && ((attackerType.conditions?.includes('mountain_shooter') || attackerType.conditions?.includes('mountain_shooter_2')) ?? false);
  // Bile attack buff: friendly units on an infected tile get ATK ×1.2 (enemies: no change).
  const atkBileMult = attackerTile?.bile && attackerTile.bile.owner === attacker.owner ? 1.2 : 1;
  const effectiveAttack = attackerType.attack * (mountainShooter ? 1.2 : 1) * atkBileMult * attackMultiplier;

  // ── Granular buff/debuff mods (for the combat log) ──
  const attackMods: CombatMod[] = [];
  if (mountainShooter) attackMods.push({ label: 'Mountain Shooter', mult: 1.2 });
  if (atkBileMult !== 1) attackMods.push({ label: 'Spray Bile', mult: atkBileMult });
  if (attackMultiplier !== 1) attackMods.push({ label: 'Combined Arms', mult: attackMultiplier });

  const defenceMods: CombatMod[] = [];
  if (defenderDefenseMultiplier !== 1) defenceMods.push({ label: getTerrainLabel(defenderTile, defenderTerrain), mult: defenderDefenseMultiplier });
  if (corrosionMult !== 1) defenceMods.push({ label: statuses.includes('corrosive_2') ? 'Corrosive II' : 'Corrosive I', mult: corrosionMult });
  if (defBileMult !== 1) defenceMods.push({ label: defBileMult > 1 ? 'Spray Bile (ally)' : 'Spray Bile (enemy)', mult: defBileMult });

  // Effective defence INCLUDING the terrain/city/fortify force multiplier (display only —
  // the force calc applies the terrain multiplier to defenseForce, same product).
  const modInfo = {
    baseAttack: attackerType.attack,
    effectiveAttack,
    attackMods,
    baseDefence: defenderType.defence,
    effectiveDefence: defenderType.defence * corrosionMult * defBileMult * defenderDefenseMultiplier,
    defenceMods,
  };

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
    ...modInfo,
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
  // Banded range: the defender can only retaliate if the attacker is within its
  // [minAttackRange, effective max] band (a range-3–4 assault Tank can't hit adjacent).
  const defenderMinRange = defenderType.minAttackRange ?? 1;
  const attackerInDefenderRange = dist >= defenderMinRange && dist <= effectiveAttackRange(defenderType, defenderTile);

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
      ...modInfo,
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
