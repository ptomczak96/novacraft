// Public API
export { createGame, getLegalActions, getRecruitOptions, applyAction, getVisibleState, getResult, replayGame, computeScores } from './game.js';
export { resolveCombat, previewCombat, calculateDamage, computeForces, getDefenseMultiplier } from './combat.js';
export type { CombatResult, CombatBreakdown } from './combat.js';
export { getReachableTiles, distance, inRange } from './pathfinding.js';
export { computeVisibility } from './fog.js';
export { getModifier, ownedCityCount, techCost, techCostForPlayer, isTechAvailable, isUnitUnlocked } from './tech.js';
export {
  getUnitUpkeep, calculateUpkeep, settleEconomy,
  calculateOreIncome, calculatePlasmaIncome,
  cityProduction, cityPop, cityLevelForSupply, citySupplyProgress, cityAt, cityById, territoryCityAt,
  cityOwnsTile, citySupplyForLevel, cityCanLevelUp, levelUpChoices, LEVEL_CHOICE_MAX,
  isTileClaimable, isExpansionTileEligible, validateExpansion,
  unitsHomedAt, cityHasCapacity, cityHasCapacityFor, cityPopUsed, cityPopRaw,
  recomputeCities, buildingOutput, buildingSupply,
  getUnitPlasmaCost, canBuild, canBuildLocation, canUpgradeBuilding, upgradeCostFor, buildingCost, canFoundCity,
  resourceKindAt, buildingBlocked, playerEconomy,
} from './economy.js';
export { generateMap, loadMapFromJSON } from './mapgen.js';
export { createPRNG, nextRandom, nextInt, shuffle } from './prng.js';
export type * from './types.js';
