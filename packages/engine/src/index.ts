// Public API
export { createGame, getLegalActions, applyAction, getVisibleState, getResult, replayGame, computeScores, calculateIncome } from './game.js';
export { resolveCombat, previewCombat, calculateDamage } from './combat.js';
export type { CombatResult, CombatBreakdown } from './combat.js';
export { getReachableTiles, distance, inRange } from './pathfinding.js';
export { computeVisibility } from './fog.js';
export {
  getUnitUpkeep, calculateUpkeep, settleEconomy,
  calculateShardIncome, calculatePlasmaIncome,
  cityProduction, citySlots, cityLevelForPop, cityAt, cityById, territoryCityAt,
  unitsHomedAt, cityHasFreeSlot, recomputeCities, buildingPop,
  getUnitPlasmaCost, canBuild, canUpgradeBuilding, upgradeCostFor, canFoundCity,
  resourceKindAt,
} from './economy.js';
export { generateMap, loadMapFromJSON } from './mapgen.js';
export { createPRNG, nextRandom, nextInt, shuffle } from './prng.js';
export type * from './types.js';
