import type { GameState, PlayerId, PlayerState, DataRegistry, TechDef } from './types.js';

// ════════════════════════════════════════════════════════════════════════
//  Tech module: research availability, city-scaled cost, and the generic
//  modifier reader other modules use. Tech effects are DATA (tech-tree.json)
//  read through getModifier(); each system names the tech it gates in its own
//  data (e.g. economy's techRequired). No tech ids are hardcoded here.
// ════════════════════════════════════════════════════════════════════════

/**
 * Sum of a named globalModifier across all techs a player has researched.
 * Shared reader — economy/combat/pathing call this; they never check tech ids.
 */
export function getModifier(player: PlayerState, registry: DataRegistry, modifierName: string): number {
  let total = 0;
  for (const techId of player.researchedTechs) {
    const tech = registry.techs[techId];
    if (!tech) continue;
    for (const effect of tech.effects) {
      if (effect.type === 'globalModifier' && effect.params['modifier'] === modifierName) {
        total += (effect.params['value'] as number) || 0;
      }
    }
  }
  return total;
}

/** Number of cities a player currently owns. */
export function ownedCityCount(state: GameState, playerId: PlayerId): number {
  return state.cities.filter(c => c.owner === playerId).length;
}

/** Ore cost to research a tech of `level` while owning `cities` cities. */
export function techCost(level: number, cities: number, registry: DataRegistry): number {
  const cfg = registry.techConfig;
  const base = cfg.costBaseByLevel[level - 1] ?? 0;
  const perCity = cfg.costPerCityByLevel[level - 1] ?? 0;
  return base + perCity * Math.max(0, cities - 1);
}

export function techCostForPlayer(state: GameState, playerId: PlayerId, tech: TechDef, registry: DataRegistry): number {
  return techCost(tech.level, ownedCityCount(state, playerId), registry);
}

/**
 * Whether `playerId` may research `tech` right now (ignoring affordability).
 * Branch-unlock rule: a level-1 tech is always available; a level-n tech needs
 * at least one researched tech in the SAME branch at level n-1. Any explicit
 * `prerequisites` must also be satisfied.
 */
export function isTechAvailable(state: GameState, playerId: PlayerId, tech: TechDef, registry: DataRegistry): boolean {
  const player = state.players[playerId];
  if (tech.locked) return false; // preview-only techs can't be researched yet
  if (player.researchedTechs.includes(tech.id)) return false;
  if (tech.level > registry.techConfig.maxLevel) return false;

  if (tech.level > 1) {
    const hasLowerInBranch = player.researchedTechs.some(id => {
      const t = registry.techs[id];
      return t && t.branch === tech.branch && t.level === tech.level - 1;
    });
    if (!hasLowerInBranch) return false;
  }

  if (tech.prerequisites && tech.prerequisites.length > 0) {
    if (!tech.prerequisites.every(p => player.researchedTechs.includes(p))) return false;
  }

  return true;
}

/**
 * Whether a unit type is recruitable for a player. A unit is "tech-locked" if
 * any tech has an `unlockUnit` effect naming it; such a unit is available only
 * once the player has researched at least one tech that unlocks it. Units named
 * by no tech (e.g. Warrior, Scout) are always available.
 */
export function isUnitUnlocked(state: GameState, playerId: PlayerId, unitTypeId: string, registry: DataRegistry): boolean {
  const unlockers: string[] = [];
  for (const [techId, tech] of Object.entries(registry.techs)) {
    for (const eff of tech.effects) {
      if (eff.type === 'unlockUnit' && eff.params['unit'] === unitTypeId) unlockers.push(techId);
    }
  }
  if (unlockers.length === 0) return true;
  const researched = state.players[playerId].researchedTechs;
  return unlockers.some(t => researched.includes(t));
}
