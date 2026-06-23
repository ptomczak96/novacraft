import type {
  GameState, GameConfig, GameResult, Action, MoveAction, AttackAction,
  RecruitAction, ResearchAction, BuildAction, UpgradeBuildingAction, FoundCityAction,
  EndTurnAction, Unit, PlayerId, CityState,
  VisibleState, DataRegistry, Coord, PlayerState, TileVisibility,
} from './types.js';
import { createPRNG } from './prng.js';
import { generateMap } from './mapgen.js';
import { getReachableTiles, distance, inRange } from './pathfinding.js';
import { resolveCombat, previewCombat } from './combat.js';
import { computeVisibility } from './fog.js';
import {
  settleEconomy, calculateOreIncome, calculatePlasmaIncome, recomputeCities,
  territoryCityAt, cityAt, cityHasCapacity, getUnitPlasmaCost,
  canBuild, canUpgradeBuilding, upgradeCostFor, buildingCost, canFoundCity,
} from './economy.js';

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
    ore: registry.economy.startingOre,
    plasma: registry.economy.startingPlasma,
    researchedTechs: [],
  }));

  // Build city state from the map. Each player's starting city is a capital;
  // any other city tiles begin as neutral level-1 cities.
  const capitalKeys = new Set(cityPositions.map(p => `${p.x},${p.y}`));
  const cities: CityState[] = [];
  let nextCityId = 1;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y][x];
      if (!tile.isCity) continue;
      cities.push({
        id: nextCityId++,
        position: { x, y },
        owner: tile.owner,
        isCapital: capitalKeys.has(`${x},${y}`),
        level: 1,
        supply: 0,
      });
    }
  }

  // Place starting units — one warrior per player at their capital.
  const units: Unit[] = [];
  const unitHomeCity: Record<number, number> = {};
  let nextUnitId = 1;
  for (let i = 0; i < playerCount; i++) {
    const pos = cityPositions[i];
    const id = nextUnitId++;
    units.push({
      id,
      typeId: 'warrior',
      owner: i,
      position: { x: pos.x, y: pos.y },
      hp: registry.unitTypes['warrior'].maxHP,
      hasMoved: false,
      hasAttacked: false,
      abilityCooldowns: {},
    });
    const capital = cities.find(c => c.position.x === pos.x && c.position.y === pos.y);
    if (capital) unitHomeCity[id] = capital.id;
  }

  return {
    config,
    map,
    units,
    players,
    cities,
    buildings: [],
    unitHomeCity,
    currentPlayer: 0,
    turn: 1,
    nextUnitId,
    nextCityId,
    nextBuildingId: 1,
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

  // Recruit actions — at owned cities with a free unit slot and enough resources
  if (faction) {
    for (const city of state.cities) {
      if (city.owner !== playerId) continue;
      const { x, y } = city.position;
      // Need an empty city tile and a free slot in that city.
      const occupied = state.units.some(u => u.position.x === x && u.position.y === y);
      if (occupied) continue;
      if (!cityHasCapacity(state, city, registry)) continue;
      for (const unitTypeId of faction.unitTypes) {
        const ut = registry.unitTypes[unitTypeId];
        if (!ut) continue;
        if (ut.cost > player.ore) continue;
        if (getUnitPlasmaCost(unitTypeId, registry) > player.plasma) continue;
        actions.push({ type: 'recruit', unitTypeId, cityPosition: { x, y } });
      }
    }
  }

  // Economy actions — build / upgrade structures, found cities
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      const pos = { x, y };
      for (const kind of ['mine', 'extractor', 'refinery', 'purifier'] as const) {
        if (canBuild(state, registry, playerId, kind, pos)) {
          actions.push({ type: 'build', kind, position: pos });
        }
      }
      if (canUpgradeBuilding(state, registry, playerId, pos)) {
        actions.push({ type: 'upgradeBuilding', position: pos });
      }
      if (canFoundCity(state, registry, playerId, pos)) {
        actions.push({ type: 'foundCity', position: pos });
      }
    }
  }

  // Research actions
  for (const [techId, tech] of Object.entries(registry.techs)) {
    if (player.researchedTechs.includes(techId)) continue;
    if (tech.cost > player.ore) continue;
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
    case 'build':
      return applyBuild(newState, action, registry);
    case 'upgradeBuilding':
      return applyUpgradeBuilding(newState, action, registry);
    case 'foundCity':
      return applyFoundCity(newState, action, registry);
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

  // Check city capture — unit on enemy/neutral city captures it (keeps level + buildings)
  const tile = state.map.tiles[action.to.y][action.to.x];
  if (tile.isCity && tile.owner !== unit.owner) {
    tile.owner = unit.owner;
    const city = cityAt(state, action.to);
    if (city) {
      // Bug 1: the previous owner's units homed here become stateless
      // (their home-city link is cleared) so they don't occupy the new
      // owner's unit slots. No penalty for now — see economy-future-notes.
      for (const u of state.units) {
        if (state.unitHomeCity[u.id] === city.id) delete state.unitHomeCity[u.id];
      }
      city.owner = unit.owner;
    }
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

  const city = cityAt(state, action.cityPosition);
  if (!city || city.owner !== state.currentPlayer) return state;
  if (!cityHasCapacity(state, city, registry)) return state;

  player.ore -= unitType.cost;
  player.plasma -= getUnitPlasmaCost(action.unitTypeId, registry);

  const id = state.nextUnitId++;
  state.units.push({
    id,
    typeId: action.unitTypeId,
    owner: state.currentPlayer,
    position: { ...action.cityPosition },
    hp: unitType.maxHP,
    hasMoved: true, // newly recruited units can't act this turn
    hasAttacked: true,
    abilityCooldowns: {},
  });
  state.unitHomeCity[id] = city.id; // unit counts against this city's slots

  return state;
}

function applyResearch(state: GameState, action: ResearchAction, registry: DataRegistry): GameState {
  const player = state.players[state.currentPlayer];
  const tech = registry.techs[action.techId];
  if (!tech) return state;

  player.ore -= tech.cost;
  player.researchedTechs.push(action.techId);

  return state;
}

function applyBuild(state: GameState, action: BuildAction, registry: DataRegistry): GameState {
  const playerId = state.currentPlayer;
  if (!canBuild(state, registry, playerId, action.kind, action.position)) return state;

  const def = registry.economy.buildings[action.kind];
  const city = territoryCityAt(state, registry, action.position);
  const cost = buildingCost(def, 1);
  state.players[playerId].ore -= cost.ore;
  state.players[playerId].plasma -= cost.plasma;
  state.buildings.push({
    id: state.nextBuildingId++,
    kind: action.kind,
    position: { ...action.position },
    level: 1,
    cityId: city ? city.id : null,
  });

  recomputeCities(state, registry); // supply/level may have changed
  return checkWinConditions(state, registry);
}

function applyUpgradeBuilding(state: GameState, action: UpgradeBuildingAction, registry: DataRegistry): GameState {
  const playerId = state.currentPlayer;
  if (!canUpgradeBuilding(state, registry, playerId, action.position)) return state;

  const building = state.buildings.find(
    b => b.position.x === action.position.x && b.position.y === action.position.y,
  );
  if (!building) return state;
  const cost = upgradeCostFor(building, registry);
  if (cost === null) return state;

  state.players[playerId].ore -= cost.ore;
  state.players[playerId].plasma -= cost.plasma;
  building.level += 1;

  recomputeCities(state, registry);
  return checkWinConditions(state, registry);
}

function applyFoundCity(state: GameState, action: FoundCityAction, registry: DataRegistry): GameState {
  const playerId = state.currentPlayer;
  if (!canFoundCity(state, registry, playerId, action.position)) return state;

  const { x, y } = action.position;
  const tile = state.map.tiles[y][x];
  tile.isCity = true;
  tile.isRuin = false;
  tile.owner = playerId;

  state.cities.push({
    id: state.nextCityId++,
    position: { x, y },
    owner: playerId,
    isCapital: false,
    level: 1,
    supply: 0,
  });
  state.players[playerId].ore -= registry.economy.foundCity.cost;

  recomputeCities(state, registry);
  return checkWinConditions(state, registry);
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

    // Collect ore income (city production + ore buildings), settle upkeep
    // (dormant), then collect plasma income. See economy.ts for the rules.
    for (const player of state.players) {
      const oreIncome = calculateOreIncome(state, player.id, registry);
      settleEconomy(state, player.id, oreIncome, registry);
      player.plasma += calculatePlasmaIncome(state, player.id, registry);
    }
  }

  return checkWinConditions(state, registry);
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
    const income = calculateOreIncome(state, player.id, registry);

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
      cities: clone(state.cities),
      buildings: clone(state.buildings),
      unitHomeCity: clone(state.unitHomeCity),
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
    cities: clone(state.cities),
    buildings: clone(state.buildings),
    unitHomeCity: clone(state.unitHomeCity),
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
