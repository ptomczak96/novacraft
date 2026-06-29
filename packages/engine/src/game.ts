import type {
  GameState, GameConfig, GameResult, Action, MoveAction, AttackAction,
  RecruitAction, ResearchAction, BuildAction, UpgradeBuildingAction, FoundCityAction,
  CaptureCityAction, LevelUpCityAction, ExpandTerritoryAction, EndTurnAction, Unit, PlayerId, CityState,
  VisibleState, DataRegistry, Coord, PlayerState, TileVisibility,
} from './types.js';
import { createPRNG, nextInt } from './prng.js';
import { generateMap } from './mapgen.js';
import { getReachableTiles, distance, inRange } from './pathfinding.js';
import { resolveCombat, previewCombat } from './combat.js';
import { computeVisibility, recordSight, makePlayerMemory } from './fog.js';
import {
  settleEconomy, calculateOreIncome, calculatePlasmaIncome, recomputeCities,
  territoryCityAt, cityAt, cityById, cityHasCapacity, cityHasCapacityFor, cityOwnsTile, getUnitPlasmaCost,
  canBuild, canUpgradeBuilding, upgradeCostFor, buildingCost, canFoundCity,
  cityCanLevelUp, levelUpChoices, validateExpansion,
} from './economy.js';
import { getModifier, isTechAvailable, techCostForPlayer, isUnitUnlocked } from './tech.js';

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
    config.mapWidth, config.mapHeight, playerCount, registry, prng, config.mapgen,
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
        incomeBonus: 0,
        popBonus: 0,
        bonusSupply: 0,
        fortified: false,
        extraTerritory: [],
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

  const state: GameState = {
    config,
    map,
    units,
    players,
    cities,
    buildings: [],
    unitHomeCity,
    memory: players.map(() => makePlayerMemory(map.width, map.height)),
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

  // Seed each player's fog memory with what they can see at the start.
  for (let p = 0; p < players.length; p++) recordSight(state, p, registry);
  return state;
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

    // Capture: standing on an enemy/neutral city, but only when the unit didn't
    // move onto it this turn (so capture becomes available the FOLLOWING turn).
    if (!unit.hasMoved) {
      const onCity = cityAt(state, unit.position);
      if (onCity && onCity.owner !== playerId) {
        actions.push({ type: 'captureCity', unitId: unit.id });
      }
    }

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
      // Need an empty city tile to recruit at.
      const occupied = state.units.some(u => u.position.x === x && u.position.y === y);
      if (occupied) continue;
      for (const unitTypeId of faction.unitTypes) {
        const ut = registry.unitTypes[unitTypeId];
        if (!ut) continue;
        if (!isUnitUnlocked(state, playerId, unitTypeId, registry)) continue;
        if (ut.cost > player.ore) continue;
        if (getUnitPlasmaCost(unitTypeId, registry) > player.plasma) continue;
        // Pop this recruit adds (paired/half-pop units: e.g. a scuttling pair = 1).
        const addedPop = (ut.popCost ?? 1) * (ut.recruitCount ?? 1);
        if (!cityHasCapacityFor(state, city, registry, addedPop)) continue;
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

  // Level-up actions — for each owned city ready to level, offer both reward
  // choices for the level it would reach. (Deferred choices reveal/territory are
  // still emitted; their effect lands in a later group. UI may disable them.)
  for (const city of state.cities) {
    if (city.owner !== playerId) continue;
    if (!cityCanLevelUp(city, registry)) continue;
    const choices = levelUpChoices(city.level + 1);
    if (!choices) continue;
    actions.push({ type: 'levelUpCity', cityId: city.id, choice: choices.a });
    actions.push({ type: 'levelUpCity', cityId: city.id, choice: choices.b });
  }

  // Research actions — branch-unlock availability + city-scaled ore cost
  for (const [techId, tech] of Object.entries(registry.techs)) {
    if (!isTechAvailable(state, playerId, tech, registry)) continue;
    if (techCostForPlayer(state, playerId, tech, registry) > player.ore) continue;
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

  const result = dispatchAction(newState, action, registry);

  // Refresh fog memory after the action: the acting player (their units may have
  // moved and revealed new tiles) and, after an endTurn, the player now on turn.
  if (result.config.fogOfWar && result.memory) {
    recordSight(result, state.currentPlayer, registry);
    if (result.currentPlayer !== state.currentPlayer) {
      recordSight(result, result.currentPlayer, registry);
    }
  }
  return result;
}

function dispatchAction(newState: GameState, action: Action, registry: DataRegistry): GameState {
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
    case 'captureCity':
      return applyCaptureCity(newState, action, registry);
    case 'levelUpCity':
      return applyLevelUpCity(newState, action, registry);
    case 'expandTerritory':
      return applyExpandTerritory(newState, action, registry);
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

  // No instant capture: a unit standing on an enemy/neutral city captures it on a
  // LATER turn via the explicit captureCity action (see applyCaptureCity). Lone
  // resources aren't captured either — ownership comes from a city's territory.

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
    // Melee units advance into the tile of a unit they kill (Polytopia-style).
    if (result.defenderKilled && attackerType.attackRange === 1) {
      attacker.position = { ...defender.position };
      attacker.hasMoved = true; // can't also capture a city this same turn
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

  const count = unitType.recruitCount ?? 1;
  const addedPop = (unitType.popCost ?? 1) * count;
  if (!cityHasCapacityFor(state, city, registry, addedPop)) return state;

  // Spawn positions: a single unit appears on the city tile; multi-unit recruits
  // (e.g. a scuttling pair) appear on random empty passable tiles in the territory.
  const spawnTiles: Coord[] = [];
  if (count <= 1) {
    spawnTiles.push({ ...action.cityPosition });
  } else {
    const candidates: Coord[] = [];
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        const pos = { x, y };
        if (pos.x === city.position.x && pos.y === city.position.y) continue; // not the centre
        if (!cityOwnsTile(city, registry, pos)) continue;
        const terrain = registry.terrainTypes[state.map.tiles[y][x].terrain];
        if (!terrain || !terrain.passable) continue;
        if (state.units.some(u => u.position.x === x && u.position.y === y)) continue; // occupied
        candidates.push(pos);
      }
    }
    // Deterministic random pick from the territory candidates.
    let p = state.prng;
    for (let i = 0; i < count && candidates.length > 0; i++) {
      const [idx, np] = nextInt(p, 0, candidates.length - 1);
      p = np;
      spawnTiles.push(candidates.splice(idx, 1)[0]);
    }
    state.prng = p;
    if (spawnTiles.length === 0) return state; // nowhere to place them
  }

  player.ore -= unitType.cost;
  player.plasma -= getUnitPlasmaCost(action.unitTypeId, registry);

  for (const pos of spawnTiles) {
    const id = state.nextUnitId++;
    state.units.push({
      id,
      typeId: action.unitTypeId,
      owner: state.currentPlayer,
      position: { ...pos },
      hp: unitType.maxHP,
      hasMoved: true, // newly recruited units can't act this turn
      hasAttacked: true,
      abilityCooldowns: {},
    });
    state.unitHomeCity[id] = city.id; // counts against this city's pop
  }

  return state;
}

function applyResearch(state: GameState, action: ResearchAction, registry: DataRegistry): GameState {
  const player = state.players[state.currentPlayer];
  if (player.researchedTechs.includes(action.techId)) return state; // already researched

  // Techs defined in the engine registry charge their ore cost (and later apply
  // effects). UI-only techs (not yet in tech-tree.json) are still recorded so the
  // selection persists/saves — their functionality is implemented separately.
  const tech = registry.techs[action.techId];
  if (tech) {
    // Registry tech: must be available, and costs the city-scaled ore price.
    if (!isTechAvailable(state, state.currentPlayer, tech, registry)) return state;
    player.ore -= techCostForPlayer(state, state.currentPlayer, tech, registry);
  }
  // UI-only techs (not yet in tech-tree.json) fall through and are still recorded
  // so the selection persists/saves — their functionality is implemented separately.
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

  // Claim the full 3x3 territory (ownership only — keep the ruin's terrain and
  // resources), so a founded city has a real territory like a capital.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = state.map.tiles[y + dy]?.[x + dx];
      if (!t || t.isCity) continue;
      t.owner = playerId;
    }
  }

  const newCityId = state.nextCityId++;
  state.cities.push({
    id: newCityId,
    position: { x, y },
    owner: playerId,
    isCapital: false,
    level: 1,
    supply: 0,
    incomeBonus: 0,
    popBonus: 0,
    bonusSupply: 0,
    fortified: false,
    extraTerritory: [],
  });
  state.players[playerId].ore -= registry.economy.foundCity.cost;

  // The founder. Normally it re-homes to the new city (its pop transfers here);
  // but a unit with the "Sacrificial Founder" condition DIES founding it instead.
  const founder = state.units.find(u => u.owner === playerId && u.position.x === x && u.position.y === y);
  if (founder) {
    const ft = registry.unitTypes[founder.typeId];
    if (ft?.conditions?.includes('sacrificial_founder')) {
      state.units = state.units.filter(u => u.id !== founder.id); // consumed by the founding
      delete state.unitHomeCity[founder.id];
    } else {
      founder.hasMoved = true; // founding spends the turn (mirrors capture)
      state.unitHomeCity[founder.id] = newCityId;
    }
  }

  recomputeCities(state, registry);
  return checkWinConditions(state, registry);
}

function applyCaptureCity(state: GameState, action: CaptureCityAction, registry: DataRegistry): GameState {
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || unit.owner !== state.currentPlayer) return state;
  if (unit.hasMoved) return state; // can't capture the same turn you moved onto it
  const city = cityAt(state, unit.position);
  if (!city || city.owner === unit.owner) return state; // must be an enemy/neutral city

  // The previous owner's units homed here become stateless (home link cleared).
  for (const u of state.units) {
    if (state.unitHomeCity[u.id] === city.id) delete state.unitHomeCity[u.id];
  }
  // Transfer the city and its 3x3 territory. Buildings keep their cityId, so
  // their output now follows the new owner automatically — everything transfers.
  city.owner = state.currentPlayer;
  const { x, y } = city.position;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = state.map.tiles[y + dy]?.[x + dx];
      if (t) t.owner = state.currentPlayer;
    }
  }
  // Expanded territory transfers with the city too (it stays on city.extraTerritory).
  for (const et of city.extraTerritory ?? []) {
    const t = state.map.tiles[et.y]?.[et.x];
    if (t) t.owner = state.currentPlayer;
  }
  unit.hasMoved = true;
  unit.hasAttacked = true; // capturing spends the unit's turn

  // The capturing unit re-homes to the captured city: its pop slot transfers off
  // its old home city onto the one it just took. (Set after the clear loop above so
  // it isn't wiped — the capturer was homed elsewhere, not at this city.)
  state.unitHomeCity[unit.id] = city.id;

  recomputeCities(state, registry);
  return checkWinConditions(state, registry);
}

function applyLevelUpCity(state: GameState, action: LevelUpCityAction, registry: DataRegistry): GameState {
  const city = cityById(state, action.cityId);
  if (!city || city.owner !== state.currentPlayer) return state;
  if (!cityCanLevelUp(city, registry)) return state;

  const targetLevel = city.level + 1;
  const choices = levelUpChoices(targetLevel);
  if (!choices || (action.choice !== choices.a && action.choice !== choices.b)) return state;

  // 'territory' is granted via the expandTerritory action (it carries the tiles);
  // 'reveal' needs fog (deferred). Neither levels the city through this path.
  if (action.choice === 'territory' || action.choice === 'reveal') return state;

  city.level = targetLevel;
  switch (action.choice) {
    case 'income': city.incomeBonus += 30; break;   // perpetual +30 ore/turn (capture-invariant)
    case 'pop': city.popBonus += 1; break;          // +1 unit capacity, stacks on the per-level pop
    case 'fortify': {                               // combat applies the extra ×1.5 defence
      city.fortified = true;
      const ct = state.map.tiles[city.position.y]?.[city.position.x];
      if (ct) ct.fortified = true;                  // mirror onto the tile so combat (tile-based) reads it
      break;
    }
    case 'supply': city.bonusSupply += 3; break;    // permanent supply toward further leveling
    default: break;
  }

  recomputeCities(state, registry); // fold bonusSupply (if any) back into city.supply
  return checkWinConditions(state, registry);
}

function applyExpandTerritory(state: GameState, action: ExpandTerritoryAction, registry: DataRegistry): GameState {
  const city = cityById(state, action.cityId);
  if (!city || city.owner !== state.currentPlayer) return state;
  // This reward IS the L4 level-up: the city must be ready to reach level 4.
  if (city.level + 1 !== 4 || !cityCanLevelUp(city, registry)) return state;
  if (action.tiles.length !== 3) return state;
  if (!validateExpansion(state, registry, city, action.tiles)) return state;

  city.level = 4;
  for (const t of action.tiles) {
    city.extraTerritory.push({ x: t.x, y: t.y });
    const tile = state.map.tiles[t.y]?.[t.x];
    if (tile) tile.owner = state.currentPlayer; // claimed land flips to the owner's colour/border
  }

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

// ── Tech modifiers (getModifier lives in tech.ts) ──
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

  // Current sight ('visible' / 'hidden'), then overlay persistent fog memory:
  // a tile seen before but not currently visible shows as 'explored' (fog), where
  // the player sees its LAST-SEEN snapshot (frozen terrain/structures, no enemy
  // units); a tile never seen is 'hidden' (cloud).
  const current = computeVisibility(state.map, state.units, state.cities, playerId, registry);
  const mem = state.memory[playerId];

  const visibility: TileVisibility[][] = [];
  const tiles = [];
  for (let y = 0; y < state.map.height; y++) {
    visibility[y] = [];
    const row = [];
    for (let x = 0; x < state.map.width; x++) {
      if (current[y][x] === 'visible') {
        visibility[y][x] = 'visible';
        row.push(clone(state.map.tiles[y][x])); // live truth
      } else if (current[y][x] === 'explored' || mem.tiles[y][x]) {
        // Fog: a remembered tile, OR one currently seen only as fog ("squinting eyes").
        visibility[y][x] = 'explored';
        row.push(clone(mem.tiles[y][x] ?? state.map.tiles[y][x])); // snapshot if we have it
      } else {
        visibility[y][x] = 'hidden';
        row.push(clone(state.map.tiles[y][x])); // covered by cloud, never read
      }
    }
    tiles.push(row);
  }
  const composedMap = { width: state.map.width, height: state.map.height, tiles };

  const isVisible = (x: number, y: number) => current[y]?.[x] === 'visible';

  // Buildings: live ones on visible tiles, remembered ones on fog tiles.
  const buildings = [
    ...state.buildings.filter(b => isVisible(b.position.x, b.position.y)).map(clone),
    ...mem.buildings.filter(b => !isVisible(b.position.x, b.position.y)).map(clone),
  ];

  // Cities: live ones on visible tiles, last-seen snapshots on fog tiles (so a
  // captured/levelled enemy city you can't see still shows as you last saw it).
  const cities = [
    ...state.cities.filter(c => isVisible(c.position.x, c.position.y)).map(clone),
    ...mem.cities.filter(c => !isVisible(c.position.x, c.position.y)).map(clone),
  ];

  // Units: own units always; enemy units only on currently-visible tiles (never
  // remembered, so fog never shows stale enemy positions).
  const visibleUnits = state.units.filter(u => {
    if (u.owner === playerId) return true;
    return isVisible(u.position.x, u.position.y);
  });

  return {
    config: state.config,
    map: composedMap,
    units: clone(visibleUnits),
    players: clone(state.players),
    cities,
    buildings,
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
