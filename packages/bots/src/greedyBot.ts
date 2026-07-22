import type { Bot } from './types.js';
import type { Action, VisibleState, DataRegistry, Unit, Coord } from '@tactica/engine';
import { previewCombat, createPRNG, nextRandom, getUnitUpkeep } from '@tactica/engine';
import { getLegalActionsFromVisible } from './randomBot.js';

export interface GreedyWeights {
  damageWeight: number;
  killWeight: number;
  captureWeight: number;
  foundWeight: number;
  economyWeight: number;
  incomeWeight: number;
  safetyWeight: number;
  exploreWeight: number;
  advanceWeight: number;
  researchWeight: number;
}

const DEFAULT_WEIGHTS: GreedyWeights = {
  damageWeight: 8,
  killWeight: 20,
  captureWeight: 200,   // capturing an enemy/neutral city — top priority
  foundWeight: 45,      // founding a new city on a ruin — very high early
  economyWeight: 25,    // build REB / level-up / expand territory
  incomeWeight: 6,
  safetyWeight: 5,
  exploreWeight: 2,
  advanceWeight: 3,     // moving toward an objective (enemy city / ruin / enemy unit)
  researchWeight: 6,
};

/**
 * Heuristic bot. Scores each *legal* action independently (one ply) and plays the best.
 * IMPORTANT: it scores the action list it is GIVEN. Callers should pass the engine's real
 * `getLegalActions(...)` (which includes foundCity / captureCity / build / levelUp / expand);
 * without those the bot can never settle or capture. It falls back to a limited
 * visible-state generator only if no list is supplied.
 */
export class GreedyBot implements Bot {
  name = 'greedy';
  private weights: GreedyWeights;
  private prng;

  constructor(weights: GreedyWeights = DEFAULT_WEIGHTS, seed: number = 54321) {
    this.weights = weights;
    this.prng = createPRNG(seed);
  }

  chooseAction(visibleState: VisibleState, registry: DataRegistry, legalActions?: Action[]): Action {
    const actions = legalActions ?? getLegalActionsFromVisible(visibleState, registry);
    if (actions.length <= 1) return actions[0] || { type: 'endTurn' };

    let bestScore = -Infinity;
    let bestAction: Action = { type: 'endTurn' };
    for (const action of actions) {
      let score = this.scoreAction(action, visibleState, registry);
      // Deterministic tie-break noise.
      const [noise, nextPrng] = nextRandom(this.prng);
      this.prng = nextPrng;
      score += noise * 0.01;
      if (score > bestScore) { bestScore = score; bestAction = action; }
    }
    return bestAction;
  }

  /** Public so a coaching UI can show WHY the bot ranked each candidate. */
  scoreAction(action: Action, s: VisibleState, registry: DataRegistry): number {
    const me = s.currentPlayer;
    const w = this.weights;

    switch (action.type) {
      case 'captureCity':
        return w.captureWeight; // almost always the best thing available

      case 'foundCity': {
        // Founding is hugely valuable early and tapers as you accumulate cities.
        const owned = s.cities.filter(c => c.owner === me).length;
        return w.foundWeight * Math.max(1, 4 - owned);
      }

      case 'build':          // mine / extractor / refinery / purifier
        return w.economyWeight;
      case 'levelUpCity':
      case 'expandTerritory':
        return w.economyWeight * 0.8;

      case 'attack': {
        const attacker = s.units.find(u => u.id === action.unitId);
        const defender = s.units.find(u => u.id === action.targetId);
        if (!attacker || !defender) return 0;
        const at = registry.unitTypes[attacker.typeId];
        const dt = registry.unitTypes[defender.typeId];
        if (!at || !dt) return 0;
        const r = previewCombat(attacker, at, defender, dt, s.map, registry, s.config.combatConfig);
        let sc = r.attackerDamage * w.damageWeight;
        if (r.defenderKilled) sc += dt.cost * w.killWeight;
        sc -= r.defenderRetaliation * w.safetyWeight;
        if (r.attackerKilled) sc -= at.cost * w.killWeight; // trading down is bad
        return sc;
      }

      case 'recruit': {
        const ut = registry.unitTypes[action.unitTypeId];
        if (!ut) return 0;
        const player = s.players[me];
        // Combat value per unit, minus a fraction of cost and its ongoing upkeep.
        let sc = (ut.attack * 2 + ut.maxHP * 0.4 + ut.defence) * 0.6;
        sc -= ut.cost * 0.05;
        sc -= getUnitUpkeep(action.unitTypeId, registry) * w.incomeWeight * 0.25;
        // Don't drain the treasury to near-zero (keeps ore for founding/buildings).
        if (player.ore - ut.cost < 10) sc -= w.safetyWeight * 4;
        // Anti-doomstack: the more units we already field, the less a marginal one is worth.
        const myUnits = s.units.filter(u => u.owner === me).length;
        sc -= myUnits * 1.5;
        return sc;
      }

      case 'research':
        return w.researchWeight;

      case 'move': {
        const unit = s.units.find(u => u.id === action.unitId);
        if (!unit) return 0;
        const ut = registry.unitTypes[unit.typeId];
        const dest = action.to;
        const tile = s.map.tiles[dest.y]?.[dest.x];
        if (!tile) return 0;
        // Small negative base so aimless "fidget" moves rank below ending the turn.
        let sc = -0.5;

        const canFound = !(ut?.conditions?.includes('impotent_founder'));
        const foundCost = registry.economy?.foundCity?.cost ?? 0;
        // Step ONTO a foundable ruin (to settle next turn) — only if we can found & afford it.
        if (tile.isRuin && !tile.isCity && canFound && s.players[me].ore >= foundCost) {
          sc += w.foundWeight * 0.6;
        }
        // Step onto an unclaimed resource tile.
        if (tile.isResourceTile && tile.owner !== me) sc += w.incomeWeight;
        // Reward advancing toward the nearest objective (enemy city > ruin > enemy unit).
        const obj = nearestObjective(unit, s, me, canFound);
        if (obj) {
          const before = cheb(unit.position, obj);
          const after = cheb(dest, obj);
          if (after < before) sc += w.advanceWeight * (before - after);
        }
        // Reward scouting into unseen tiles.
        if (s.visibility[dest.y]?.[dest.x] !== 'visible') sc += w.exploreWeight;
        return sc;
      }

      case 'endTurn':
        return 0; // a real action must earn a positive score to be preferred

      default:
        return 0; // slash / wyrmStrike / useAbility / upgradeBuilding — neutral for now
    }
  }
}

function cheb(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Nearest thing worth walking toward: an enemy/neutral city, a foundable ruin, else an enemy unit. */
function nearestObjective(unit: Unit, s: VisibleState, me: number, canFound: boolean): Coord | null {
  let best: Coord | null = null;
  let bestD = Infinity;
  const consider = (c: Coord) => { const d = cheb(unit.position, c); if (d < bestD) { bestD = d; best = c; } };
  for (const c of s.cities) if (c.owner !== me) consider(c.position);
  if (canFound) {
    for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) {
      const t = s.map.tiles[y][x];
      if (t.isRuin && !t.isCity) consider({ x, y });
    }
  }
  if (!best) for (const u of s.units) if (u.owner !== me) consider(u.position);
  return best;
}
