import type { Bot } from './types.js';
import type { Action, VisibleState, DataRegistry, Unit } from '@tactica/engine';
import { previewCombat, createPRNG, nextRandom, getUnitUpkeep } from '@tactica/engine';
import { getLegalActionsFromVisible } from './randomBot.js';

interface GreedyWeights {
  damageWeight: number;
  killWeight: number;
  captureWeight: number;
  incomeWeight: number;
  safetyWeight: number;
  exploreWeight: number;
  healWeight: number;
}

const DEFAULT_WEIGHTS: GreedyWeights = {
  damageWeight: 10,
  killWeight: 25,
  captureWeight: 30,
  incomeWeight: 8,
  safetyWeight: 5,
  exploreWeight: 2,
  healWeight: 3,
};

export class GreedyBot implements Bot {
  name = 'greedy';
  private weights: GreedyWeights;
  private prng;

  constructor(weights: GreedyWeights = DEFAULT_WEIGHTS, seed: number = 54321) {
    this.weights = weights;
    this.prng = createPRNG(seed);
  }

  chooseAction(visibleState: VisibleState, registry: DataRegistry): Action {
    const actions = getLegalActionsFromVisible(visibleState, registry);
    if (actions.length <= 1) return actions[0] || { type: 'endTurn' };

    let bestScore = -Infinity;
    let bestAction: Action = { type: 'endTurn' };

    for (const action of actions) {
      let score = 0;

      switch (action.type) {
        case 'attack': {
          const attacker = visibleState.units.find(u => u.id === action.unitId);
          const defender = visibleState.units.find(u => u.id === action.targetId);
          if (attacker && defender) {
            const at = registry.unitTypes[attacker.typeId];
            const dt = registry.unitTypes[defender.typeId];
            if (at && dt) {
              const result = previewCombat(
                attacker, at, defender, dt,
                visibleState.map, registry, visibleState.config.combatConfig,
              );
              score += result.attackerDamage * this.weights.damageWeight;
              if (result.defenderKilled) {
                score += dt.cost * this.weights.killWeight;
              }
              // Penalty for taking damage
              score -= result.defenderRetaliation * this.weights.safetyWeight;
              if (result.attackerKilled) {
                score -= at.cost * this.weights.killWeight;
              }
            }
          }
          break;
        }

        case 'move': {
          const unit = visibleState.units.find(u => u.id === action.unitId);
          if (unit) {
            const tile = visibleState.map.tiles[action.to.y][action.to.x];
            // Prefer moving toward cities
            if (tile.isCity && tile.owner !== visibleState.currentPlayer) {
              score += this.weights.captureWeight;
            }
            // Prefer resource tiles
            if (tile.isResourceTile && tile.owner !== visibleState.currentPlayer) {
              score += this.weights.incomeWeight;
            }
            // Prefer moving toward nearest enemy
            const nearestEnemy = findNearestEnemy(unit, visibleState);
            if (nearestEnemy) {
              const ut = registry.unitTypes[unit.typeId];
              const currentDist = Math.abs(unit.position.x - nearestEnemy.position.x) +
                                  Math.abs(unit.position.y - nearestEnemy.position.y);
              const newDist = Math.abs(action.to.x - nearestEnemy.position.x) +
                              Math.abs(action.to.y - nearestEnemy.position.y);
              if (newDist < currentDist) {
                score += this.weights.exploreWeight * (currentDist - newDist);
              }
              // If unit is ranged, prefer staying at range
              if (ut && ut.attackRange > 1 && newDist === ut.attackRange) {
                score += this.weights.safetyWeight;
              }
            }
            // Small explore bonus for visibility
            if (visibleState.visibility[action.to.y]?.[action.to.x] !== 'visible') {
              score += this.weights.exploreWeight;
            }
          }
          break;
        }

        case 'recruit': {
          const ut = registry.unitTypes[action.unitTypeId];
          if (ut) {
            // Prefer recruiting if we have gold and can afford it
            score += (ut.attack + ut.maxHP * 0.5) * this.weights.incomeWeight * 0.5;
            // Don't overspend
            const player = visibleState.players[visibleState.currentPlayer];
            if (player.ore - ut.cost < 3) {
              score -= this.weights.safetyWeight * 5;
            }
            // Weigh ongoing upkeep so the bot doesn't doomstack into bankruptcy.
            score -= getUnitUpkeep(action.unitTypeId, registry) * this.weights.incomeWeight * 0.25;
          }
          break;
        }

        case 'research': {
          score += this.weights.incomeWeight * 2;
          break;
        }

        case 'endTurn': {
          score = -1; // Only end turn if nothing better
          break;
        }
      }

      // Tie-breaking noise
      const [noise, nextPrng] = nextRandom(this.prng);
      this.prng = nextPrng;
      score += noise * 0.01;

      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }

    return bestAction;
  }
}

function findNearestEnemy(unit: Unit, state: VisibleState): Unit | null {
  let nearest: Unit | null = null;
  let minDist = Infinity;
  for (const other of state.units) {
    if (other.owner === unit.owner) continue;
    const dist = Math.abs(unit.position.x - other.position.x) + Math.abs(unit.position.y - other.position.y);
    if (dist < minDist) {
      minDist = dist;
      nearest = other;
    }
  }
  return nearest;
}
