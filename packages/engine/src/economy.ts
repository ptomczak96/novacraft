import type {
  GameState, PlayerId, DataRegistry, Unit, Coord,
  CityState, CityId, BuildingState, BuildingKind, ResourceKind,
} from './types.js';

// ════════════════════════════════════════════════════════════════════════
//  Economy: cities, population, buildings, and resource income.
//  All tuning comes from registry.economy (economy.json). This module owns
//  the entire economy so it stays decoupled from units.json / mapgen.
// ════════════════════════════════════════════════════════════════════════

// ── Tile helpers (read mapgen markers with safe fallbacks) ──
// A resource tile with no explicit kind is treated as a shard outcrop, so the
// economy works on existing maps before mapgen learns about shard/plasma.
export function resourceKindAt(state: GameState, pos: Coord): ResourceKind | null {
  const tile = state.map.tiles[pos.y]?.[pos.x];
  if (!tile) return null;
  if (tile.resourceKind) return tile.resourceKind;
  return tile.isResourceTile ? 'shard' : null;
}

function isRuin(state: GameState, pos: Coord): boolean {
  return state.map.tiles[pos.y]?.[pos.x]?.isRuin === true;
}

function chebyshev(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ── City lookups ──
export function cityAt(state: GameState, pos: Coord): CityState | undefined {
  return state.cities.find(c => c.position.x === pos.x && c.position.y === pos.y);
}

export function cityById(state: GameState, id: CityId | null): CityState | undefined {
  if (id === null) return undefined;
  return state.cities.find(c => c.id === id);
}

/** The (at most one) city whose territory contains `pos`. Territories never overlap. */
export function territoryCityAt(state: GameState, registry: DataRegistry, pos: Coord): CityState | undefined {
  const r = registry.economy.city.territoryRadius;
  return state.cities.find(c => chebyshev(c.position, pos) <= r);
}

function buildingAt(state: GameState, pos: Coord): BuildingState | undefined {
  return state.buildings.find(b => b.position.x === pos.x && b.position.y === pos.y);
}

// ── City production / slots / level ──
export function cityProduction(city: CityState, registry: DataRegistry): number {
  const c = registry.economy.city;
  const base = city.isCapital ? c.capitalBaseProduction : c.cityBaseProduction;
  return base + c.productionPerLevel * (city.level - 1);
}

export function citySlots(city: CityState, registry: DataRegistry): number {
  return registry.economy.city.slotsBase + (city.level - 1);
}

/** Highest level whose cumulative pop threshold is satisfied. */
export function cityLevelForPop(pop: number, registry: DataRegistry): number {
  const { popThresholds, maxLevel } = registry.economy.city;
  let level = 1;
  for (let i = 0; i < popThresholds.length && level < maxLevel; i++) {
    if (pop >= popThresholds[i]) level = i + 2; // thresholds[0] -> level 2
    else break;
  }
  return Math.min(level, maxLevel);
}

// ── Building population ──
export function buildingPop(state: GameState, building: BuildingState, registry: DataRegistry): number {
  const def = registry.economy.buildings[building.kind];
  if (!def) return 0;
  if (def.popPerLevel !== undefined) {
    // mine / extractor: scales with its own level
    return def.popPerLevel * building.level;
  }
  if (def.popPerAdjacent !== undefined && def.adjacentTo) {
    // processor / purifier: counts adjacent buildings of a kind in its 3x3
    let count = 0;
    for (const other of state.buildings) {
      if (other.kind !== def.adjacentTo) continue;
      if (chebyshev(other.position, building.position) <= 1) count++;
    }
    return def.popPerAdjacent * count;
  }
  return 0;
}

/** Recompute pop + level for every city from current buildings. Call after any economy mutation. */
export function recomputeCities(state: GameState, registry: DataRegistry): void {
  // Reset, then attribute each building's pop to the city owning its territory.
  for (const city of state.cities) city.pop = 0;
  for (const building of state.buildings) {
    const city = cityById(state, building.cityId);
    if (!city) continue;
    city.pop += buildingPop(state, building, registry);
  }
  for (const city of state.cities) {
    city.level = cityLevelForPop(city.pop, registry);
  }
}

// ── Unit slot accounting ──
/** Number of living units homed at a city (stale entries for dead units are ignored). */
export function unitsHomedAt(state: GameState, cityId: CityId): number {
  let count = 0;
  for (const unit of state.units) {
    if (state.unitHomeCity[unit.id] === cityId) count++;
  }
  return count;
}

export function cityHasFreeSlot(state: GameState, city: CityState, registry: DataRegistry): boolean {
  return unitsHomedAt(state, city.id) < citySlots(city, registry);
}

// ── Resource income ──
export function calculateShardIncome(state: GameState, playerId: PlayerId, registry: DataRegistry): number {
  let income = 0;
  for (const city of state.cities) {
    if (city.owner === playerId) income += cityProduction(city, registry);
  }
  return income;
}

export function calculatePlasmaIncome(_state: GameState, _playerId: PlayerId, _registry: DataRegistry): number {
  // No plasma production source yet — extractors feed pop, not plasma.
  // Reserved so the turn loop and UI already have the hook.
  return 0;
}

// ── Unit costs ──
export function getUnitPlasmaCost(typeId: string, registry: DataRegistry): number {
  return registry.economy.unitPlasmaCost[typeId] ?? 0;
}

// ── Build legality ──
function countCityBuildings(state: GameState, cityId: CityId, kind: BuildingKind): number {
  return state.buildings.filter(b => b.cityId === cityId && b.kind === kind).length;
}

function hasAdjacentBuilding(state: GameState, pos: Coord, kind: BuildingKind): boolean {
  return state.buildings.some(b => b.kind === kind && chebyshev(b.position, pos) <= 1);
}

/**
 * Whether `playerId` may build `kind` at `pos` right now. Pure predicate used
 * by both getLegalActions and applyAction so they never disagree.
 */
export function canBuild(state: GameState, registry: DataRegistry, playerId: PlayerId, kind: BuildingKind, pos: Coord): boolean {
  const def = registry.economy.buildings[kind];
  if (!def) return false;

  const tile = state.map.tiles[pos.y]?.[pos.x];
  if (!tile || tile.isCity) return false;
  if (buildingAt(state, pos)) return false; // one building per tile

  // Must be inside a city you own.
  const city = territoryCityAt(state, registry, pos);
  if (!city || city.owner !== playerId) return false;

  // Per-city cap.
  if (def.perCity !== null && countCityBuildings(state, city.id, kind) >= def.perCity) return false;

  // Tech gate.
  if (def.techRequired && !state.players[playerId].researchedTechs.includes(def.techRequired)) return false;

  // Tile requirement.
  if (def.on === 'shard' || def.on === 'plasma') {
    if (resourceKindAt(state, pos) !== def.on) return false;
  } else {
    // 'land': a passable, non-resource tile, and it must actually help
    // (at least one adjacent building of the kind it boosts).
    const terrain = registry.terrainTypes[tile.terrain];
    if (!terrain || !terrain.passable) return false;
    if (resourceKindAt(state, pos) !== null) return false;
    if (def.adjacentTo && !hasAdjacentBuilding(state, pos, def.adjacentTo)) return false;
  }

  // Affordable.
  return state.players[playerId].shard >= def.cost;
}

export function upgradeCostFor(building: BuildingState, registry: DataRegistry): number | null {
  const def = registry.economy.buildings[building.kind];
  if (!def || !def.upgradeCosts) return null;
  if (building.level >= def.maxLevel) return null;
  return def.upgradeCosts[building.level - 1] ?? null; // level 1 -> upgradeCosts[0]
}

export function canUpgradeBuilding(state: GameState, registry: DataRegistry, playerId: PlayerId, pos: Coord): boolean {
  const building = buildingAt(state, pos);
  if (!building) return false;
  const city = cityById(state, building.cityId);
  if (!city || city.owner !== playerId) return false;
  const cost = upgradeCostFor(building, registry);
  if (cost === null) return false;
  return state.players[playerId].shard >= cost;
}

export function canFoundCity(state: GameState, registry: DataRegistry, playerId: PlayerId, pos: Coord): boolean {
  if (!isRuin(state, pos)) return false;
  if (cityAt(state, pos)) return false;
  const { cost, requiresUnitOnTile } = registry.economy.foundCity;
  if (requiresUnitOnTile) {
    const hasUnit = state.units.some(u => u.owner === playerId && u.position.x === pos.x && u.position.y === pos.y);
    if (!hasUnit) return false;
  }
  return state.players[playerId].shard >= cost;
}

// ════════════════════════════════════════════════════════════════════════
//  Upkeep (dormant: multiplier defaults to 0). Kept for future use.
// ════════════════════════════════════════════════════════════════════════
export function getUnitUpkeep(typeId: string, registry: DataRegistry): number {
  const econ = registry.economy;
  if (!econ) return 0;
  const base = econ.upkeepByUnit[typeId] ?? econ.upkeepDefault;
  return Math.max(0, Math.round(base * econ.upkeepMultiplier));
}

export function calculateUpkeep(state: GameState, playerId: PlayerId, registry: DataRegistry): number {
  let total = 0;
  for (const unit of state.units) {
    if (unit.owner !== playerId) continue;
    total += getUnitUpkeep(unit.typeId, registry);
  }
  return total;
}

/**
 * Add shard income, then pay (currently disabled) upkeep. If upkeep ever
 * exceeds what a player can afford, units desert cheapest-first
 * (deterministic). Shard is guaranteed to end >= 0. Mutates `state`.
 */
export function settleEconomy(state: GameState, playerId: PlayerId, income: number, registry: DataRegistry): Unit[] {
  const player = state.players[playerId];
  const available = player.shard + income;

  const owned = state.units
    .filter(u => u.owner === playerId)
    .sort((a, b) => {
      const ca = registry.unitTypes[a.typeId]?.cost ?? 0;
      const cb = registry.unitTypes[b.typeId]?.cost ?? 0;
      return ca - cb || a.id - b.id;
    });

  let upkeep = owned.reduce((sum, u) => sum + getUnitUpkeep(u.typeId, registry), 0);

  const deserted: Unit[] = [];
  let i = 0;
  while (upkeep > available && i < owned.length) {
    const unit = owned[i++];
    upkeep -= getUnitUpkeep(unit.typeId, registry);
    deserted.push(unit);
  }

  if (deserted.length > 0) {
    const ids = new Set(deserted.map(u => u.id));
    state.units = state.units.filter(u => !ids.has(u.id));
    for (const u of deserted) delete state.unitHomeCity[u.id];
  }

  player.shard = available - upkeep;
  return deserted;
}
