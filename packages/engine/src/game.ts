import type {
  GameState, GameConfig, GameResult, Action, MoveAction, AttackAction,
  RecruitAction, ResearchAction, EndTurnAction, Unit, PlayerId,
  VisibleState, DataRegistry, Coord, PlayerState, TileVisibility,
} from './types.js';
import { createPRNG } from './prng.js';
import { generateMap } from './mapgen.js';
import { getReachableTiles, distance, inRange } from './pathfinding.js';
import { resolveCombat, previewCombat } from './combat.js';
import { computeVisibility } from './fog.js';

// ── Deep clone helper (JSON round-trip, since state is JSON-serializable) ──
function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ── Create Game ──
export function createGame(
  config: GameConfig,
  registry: DataRegistry,
  factionIds: string[],
  seed: number,
): GameState {
  const prng = createPRNG(seed);
  const playerCount = factionIds.length;

  const [map, cityPositions, prngAfterMap] = generateMap(
    config.mapWidth, config.mapHeight, playerCount, registry, prng,
  );

  const players: PlayerState[] = factionIds.map((factionId, i) => ({
    id: i,
    factionId,
    gold: config.startingGold,
    researchedTechs: [],
  }));

  // Place starting units — one warrior per player at their city
  const units: Unit[] = [];
  let nextUnitId = 1;
  for (let i = 0; i < playerCount; i++) {
    const pos = cityPositions[i];
    // Place warrior on the base tile itself
    units.push({
      id: nextUnitId++,
      typeId: 'warrior',
      owner: i,
      position: { x: pos.x, y: pos.y },
      hp: registry.unitTypes['warrior'].maxHP,
      hasMoved: false,
      hasAttacked: false,
      abilityCooldowns: {},
    });
  }

  return {
    config,
    map,
    units,
    players,
    currentPlayer: 0,
    turn: 1,
    nextUnitId,
    prng: prngAfterMap,
    actionLog: [],
    phase: 'playing',
    winner: null,
    winConditionMet: null,
  };
}

function findAdjacentSpawn(map: { width: number; height: number; tiles: { terrain: string }[][] }, pos: Coord, occupiedPositions: Coord[]): Coord {
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const occupied = new Set(occupiedPositions.map(p => `${p.x},${p.y}`));
  for (const [dx, dy] of dirs) {
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
      if (!occupied.has(`${nx},${ny}`)) {
        return { x: nx, y: ny };
      }
    }
  }
  return pos; // fallback to city tile
}

// ── Get Legal Actions ──
export function getLegalActions(state: GameState, registry: DataRegistry, playerId: PlayerId): Action[] {
  if (state.phase !== 'playing') return [];
  if (state.currentPlayer !== playerId) return [];

  const actions: Action[] = [];
  const player = state.players[playerId];
  const faction = registry.factions[player.factionId];

  // Movement bonus from tech
  const movementBonus = getMovementBonus(player, registry);

  // Per-unit actions
  for (const unit of state.units) {
    if (unit.owner !== playerId) continue;
    const unitType = registry.unitTypes[unit.typeId];
    if (!unitType) continue;

    // Move actions
    if (!unit.hasMoved) {
      const reachable = getReachableTiles(unit, unitType, state.map, state.units, registry, movementBonus);
      for (const [key] of reachable) {
        const [x, y] = key.split(',').map(Number);
        actions.push({ type: 'move', unitId: unit.id, to: { x, y } });
      }
    }

    // Attack actions
    if (!unit.hasAttacked) {
      // Check noMoveAndAttack trait
      if (unitType.traits.includes('noMoveAndAttack') && unit.hasMoved) continue;

      for (const target of state.units) {
        if (target.owner === playerId) continue;
        if (inRange(unit.position, target.position, unitType.attackRange)) {
          actions.push({ type: 'attack', unitId: unit.id, targetId: target.id });
        }
      }
    }
  }

  // Recruit actions — at owned cities
  if (faction) {
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        const tile = state.map.tiles[y][x];
        if (tile.isCity && tile.owner === playerId) {
          // Check no unit already on this tile
          const occupied = state.units.some(u => u.position.x === x && u.position.y === y);
          if (!occupied) {
            for (const unitTypeId of faction.unitTypes) {
              const ut = registry.unitTypes[unitTypeId];
              if (!ut) continue;
              // Check if unit is unlocked (no tech lock for base units, check tech for others)
              if (ut.cost <= player.gold) {
                actions.push({ type: 'recruit', unitTypeId, cityPosition: { x, y } });
              }
            }
          }
        }
      }
    }
  }

  // Research actions
  for (const [techId, tech] of Object.entries(registry.techs)) {
    if (player.researchedTechs.includes(techId)) continue;
    if (tech.cost > player.gold) continue;
    const prereqsMet = tech.prerequisites.every(p => player.researchedTechs.includes(p));
    if (!prereqsMet) continue;
    actions.push({ type: 'research', techId });
  }

  // End turn is always available
  actions.push({ type: 'endTurn' });

  return actions;
}

// ── Apply Action ──
export function applyAction(state: GameState, action: Action, registry: DataRegistry): GameState {
  const newState = clone(state);
  newState.actionLog.push(action);

  switch (action.type) {
    case 'move':
      return applyMove(newState, action, registry);
    case 'attack':
      return applyAttack(newState, action, registry);
    case 'recruit':
      return applyRecruit(newState, action, registry);
    case 'research':
      return applyResearch(newState, action, registry);
    case 'endTurn':
      return applyEndTurn(newState, registry);
    default:
      return newState;
  }
}

function applyMove(state: GameState, action: MoveAction, _registry: DataRegistry): GameState {
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit) return state;
  unit.position = { ...action.to };
  unit.hasMoved = true;

  // Check city capture — unit on enemy city starts capture (captured after full turn)
  const tile = state.map.tiles[action.to.y][action.to.x];
  if (tile.isCity && tile.owner !== unit.owner && tile.owner !== null) {
    // Capture instantly for simplicity in v1 (unit stands on it)
    tile.owner = unit.owner;
  } else if (tile.isCity && tile.owner === null) {
    tile.owner = unit.owner;
  }

  // Capture resource tiles
  if (tile.isResourceTile && tile.owner !== unit.owner) {
    tile.owner = unit.owner;
  }

  return checkWinConditions(state, _registry);
}

function applyAttack(state: GameState, action: AttackAction, registry: DataRegistry): GameState {
  const attacker = state.units.find(u => u.id === action.unitId);
  const defender = state.units.find(u => u.id === action.targetId);
  if (!attacker || !defender) return state;

  const attackerType = registry.unitTypes[attacker.typeId];
  const defenderType = registry.unitTypes[defender.typeId];
  if (!attackerType || !defenderType) return state;

  const result = resolveCombat(
    attacker, attackerType, defender, defenderType,
    state.map, registry, state.config.combatConfig, state.prng,
  );
  state.prng = result.prng;

  // Apply damage
  defender.hp -= result.attackerDamage;
  attacker.hp -= result.defenderRetaliation;

  // Remove killed units
  if (result.defenderKilled) {
    state.units = state.units.filter(u => u.id !== defender.id);
  }
  if (result.attackerKilled) {
    state.units = state.units.filter(u => u.id !== attacker.id);
  }

  // Mark attacker as having attacked
  if (!result.attackerKilled) {
    attacker.hasAttacked = true;
    // If unit has noMoveAndAttack, also mark as moved
    if (attackerType.traits.includes('noMoveAndAttack')) {
      attacker.hasMoved = true;
    }
  }

  return checkWinConditions(state, registry);
}

function applyRecruit(state: GameState, action: RecruitAction, registry: DataRegistry): GameState {
  const player = state.players[state.currentPlayer];
  const unitType = registry.unitTypes[action.unitTypeId];
  if (!unitType) return state;

  player.gold -= unitType.cost;

  state.units.push({
    id: state.nextUnitId++,
    typeId: action.unitTypeId,
    owner: state.currentPlayer,
    position: { ...action.cityPosition },
    hp: unitType.maxHP,
    hasMoved: true, // newly recruited units can't act this turn
    hasAttacked: true,
    abilityCooldowns: {},
  });

  return state;
}

function applyResearch(state: GameState, action: ResearchAction, registry: DataRegistry): GameState {
  const player = state.players[state.currentPlayer];
  const tech = registry.techs[action.techId];
  if (!tech) return state;

  player.gold -= tech.cost;
  player.researchedTechs.push(action.techId);

  return state;
}

function applyEndTurn(state: GameState, registry: DataRegistry): GameState {
  // Reset all current player's units
  for (const unit of state.units) {
    if (unit.owner === state.currentPlayer) {
      unit.hasMoved = false;
      unit.hasAttacked = false;
    }
  }

  // Advance to next player
  const nextPlayer = (state.currentPlayer + 1) % state.players.length;
  state.currentPlayer = nextPlayer;

  // If we wrapped around to player 0, it's a new turn
  if (nextPlayer === 0) {
    state.turn++;

    // Collect income for all players at start of their new turn cycle
    for (const player of state.players) {
      const income = calculateIncome(state, player.id, registry);
      player.gold += income;
    }
  }

  return checkWinConditions(state, registry);
}

// ── Income ──
export function calculateIncome(state: GameState, playerId: PlayerId, registry: DataRegistry): number {
  let income = 0;
  const player = state.players[playerId];
  const cityIncomeBonus = getModifier(player, registry, 'cityIncomeBonus');
  const resourceIncomeBonus = getModifier(player, registry, 'resourceIncomeBonus');

  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      const tile = state.map.tiles[y][x];
      if (tile.owner !== playerId) continue;
      if (tile.isCity) {
        income += state.config.cityIncome + cityIncomeBonus;
      }
      if (tile.isResourceTile) {
        income += state.config.resourceIncome + resourceIncomeBonus;
      }
    }
  }
  return income;
}

// ── Tech modifiers ──
function getModifier(player: PlayerState, registry: DataRegistry, modifierName: string): number {
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

function getMovementBonus(player: PlayerState, registry: DataRegistry): number {
  return getModifier(player, registry, 'allMovementBonus');
}

// ── Win Conditions ──
function checkWinConditions(state: GameState, registry: DataRegistry): GameState {
  if (state.phase !== 'playing') return state;
  const { config } = state;

  // Check elimination
  if (config.winConditions.eliminateAllUnits) {
    for (const player of state.players) {
      const hasUnits = state.units.some(u => u.owner === player.id);
      if (!hasUnits) {
        const opponent = state.players.find(p => p.id !== player.id);
        if (opponent && state.units.some(u => u.owner === opponent.id)) {
          state.phase = 'finished';
          state.winner = opponent.id;
          state.winConditionMet = 'eliminateAllUnits';
          return state;
        }
      }
    }
  }

  // Check city capture
  if (config.winConditions.captureAllCities) {
    for (const player of state.players) {
      const cities = getCities(state, player.id);
      if (cities.length === 0) {
        // This player lost all cities — check if anyone else has all
        const allCities = getAllCities(state);
        for (const other of state.players) {
          if (other.id === player.id) continue;
          const otherCities = getCities(state, other.id);
          if (otherCities.length === allCities.length) {
            state.phase = 'finished';
            state.winner = other.id;
            state.winConditionMet = 'captureAllCities';
            return state;
          }
        }
      }
    }
  }

  // Check turn limit
  if (config.winConditions.highestScoreAtLimit && state.turn > config.turnLimit) {
    const scores = computeScores(state, registry);
    let bestPlayer = 0;
    let bestScore = -1;
    for (const [pid, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestPlayer = Number(pid);
      }
    }
    state.phase = 'finished';
    state.winner = bestPlayer;
    state.winConditionMet = 'highestScoreAtLimit';
    return state;
  }

  return state;
}

function getCities(state: GameState, playerId: PlayerId): Coord[] {
  const cities: Coord[] = [];
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (state.map.tiles[y][x].isCity && state.map.tiles[y][x].owner === playerId) {
        cities.push({ x, y });
      }
    }
  }
  return cities;
}

function getAllCities(state: GameState): Coord[] {
  const cities: Coord[] = [];
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (state.map.tiles[y][x].isCity) {
        cities.push({ x, y });
      }
    }
  }
  return cities;
}

export function computeScores(state: GameState, registry: DataRegistry): Record<PlayerId, number> {
  const scores: Record<PlayerId, number> = {};
  for (const player of state.players) {
    const cities = getCities(state, player.id);
    const unitCost = state.units
      .filter(u => u.owner === player.id)
      .reduce((sum, u) => {
        const ut = registry.unitTypes[u.typeId];
        return sum + (ut ? ut.cost : 0);
      }, 0);
    const income = calculateIncome(state, player.id, registry);

    scores[player.id] =
      cities.length * state.config.scoreWeights.cityValue +
      unitCost * state.config.scoreWeights.unitCostValue +
      income * state.config.scoreWeights.incomeValue;
  }
  return scores;
}

// ── Visible State (Fog of War) ──
export function getVisibleState(state: GameState, playerId: PlayerId, registry: DataRegistry): VisibleState {
  if (!state.config.fogOfWar) {
    // No fog — everything visible
    const visibility: TileVisibility[][] = [];
    for (let y = 0; y < state.map.height; y++) {
      visibility[y] = [];
      for (let x = 0; x < state.map.width; x++) {
        visibility[y][x] = 'visible';
      }
    }
    return {
      config: state.config,
      map: clone(state.map),
      units: clone(state.units),
      players: clone(state.players),
      currentPlayer: state.currentPlayer,
      turn: state.turn,
      visibility,
      phase: state.phase,
      winner: state.winner,
      winConditionMet: state.winConditionMet,
      actionLog: clone(state.actionLog),
    };
  }

  const visibility = computeVisibility(state.map, state.units, playerId, registry);

  // Filter units — only show own units and enemy units on visible tiles
  const visibleUnits = state.units.filter(u => {
    if (u.owner === playerId) return true;
    return visibility[u.position.y][u.position.x] === 'visible';
  });

  return {
    config: state.config,
    map: clone(state.map),
    units: clone(visibleUnits),
    players: clone(state.players),
    currentPlayer: state.currentPlayer,
    turn: state.turn,
    visibility,
    phase: state.phase,
    winner: state.winner,
    winConditionMet: state.winConditionMet,
    actionLog: clone(state.actionLog),
  };
}

// ── Game Result ──
export function getResult(state: GameState, registry: DataRegistry): GameResult | null {
  if (state.phase !== 'finished') return null;
  return {
    winner: state.winner,
    winCondition: state.winConditionMet || 'unknown',
    finalScores: computeScores(state, registry),
    turns: state.turn,
  };
}

// ── Replay: create game from action log ──
export function replayGame(
  config: GameConfig,
  registry: DataRegistry,
  factionIds: string[],
  seed: number,
  actions: Action[],
): GameState {
  let state = createGame(config, registry, factionIds, seed);
  for (const action of actions) {
    state = applyAction(state, action, registry);
  }
  return state;
}
