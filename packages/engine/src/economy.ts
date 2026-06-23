import type {
  GameState, PlayerId, DataRegistry, Unit, Coord,
  CityState, CityId, BuildingState, BuildingKind, BuildingDef, ResourceKind,
} from './types.js';
import { getModifier } from './tech.js';

// ════════════════════════════════════════════════════════════════════════
//  Economy: cities, supply/level, resource-extraction buildings (REBs).
//  All tuning comes from registry.economy (economy.json). This module owns
//  the entire economy so it stays decoupled from units.json / mapgen.
//
//  Terminology:
//    pop    = unit capacity (max units a city supports) = popBase + level - 1
//    supply = leveling currency from buildings; thresholds raise the level
//    REB1   = mine / extractor   (self output + supply by level)
//    REB2   = refinery / purifier (output + supply per adjacent same-city REB1)
// ════════════════════════════════════════════════════════════════════════

// ── Tile helpers (read mapgen markers with safe fallbacks) ──
// A resource tile with no explicit kind is treated as an ore tile, so the
// economy works on existing maps before mapgen marks ore/plasma.
export function resourceKindAt(state: GameState, pos: Coord): ResourceKind | null {
  const tile = state.map.tiles[pos.y]?.[pos.x];
  if (!tile) return null;
  if (tile.resourceKind) return tile.resourceKind;
  return tile.isResourceTile ? 'ore' : null;
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

// ── City production / pop (capacity) / level ──
export function cityProduction(city: CityState, registry: DataRegistry): number {
  const c = registry.economy.city;
  const base = city.isCapital ? c.capitalBaseProduction : c.cityBaseProduction;
  return base + c.productionPerLevel * (city.level - 1);
}

/** Unit capacity of a city (how many units it can support). */
export function cityPop(city: CityState, registry: DataRegistry): number {
  return registry.economy.city.popBase + (city.level - 1);
}

/** Highest level whose cumulative supply threshold is satisfied. */
export function cityLevelForSupply(supply: number, registry: DataRegistry): number {
  const { supplyThresholds, maxLevel } = registry.economy.city;
  let level = 1;
  for (let i = 0; i < supplyThresholds.length && level < maxLevel; i++) {
    if (supply >= supplyThresholds[i]) level = i + 2; // thresholds[0] -> level 2
    else break;
  }
  return Math.min(level, maxLevel);
}

// ── Building output & supply ──
/** Count REB1s of `kind` adjacent to `pos` that belong to the same city. */
function adjacentSameCity(state: GameState, pos: Coord, kind: BuildingKind, cityId: CityId | null): number {
  let count = 0;
  for (const b of state.buildings) {
    if (b.kind !== kind) continue;
    if (b.cityId !== cityId) continue; // same city only (Bug 3)
    if (chebyshev(b.position, pos) <= 1) count++;
  }
  return count;
}

function atLevel(arr: number[] | undefined, level: number): number {
  if (!arr) return 0;
  return arr[Math.min(level, arr.length) - 1] ?? 0;
}

/** Resource produced per turn by a building (and which resource). */
export function buildingOutput(state: GameState, building: BuildingState, registry: DataRegistry): { resource: ResourceKind; amount: number } {
  const def = registry.economy.buildings[building.kind];
  if (!def) return { resource: 'ore', amount: 0 };
  if (def.outputByLevel) {
    let amount = atLevel(def.outputByLevel, building.level);
    // Slag Wash (Refinement tech) boosts all of the owner's mine output.
    if (building.kind === 'mine') {
      const owner = cityById(state, building.cityId)?.owner;
      if (owner !== undefined && owner !== null) {
        const bonus = getModifier(state.players[owner], registry, 'mineOutputBonus');
        if (bonus) amount = Math.round(amount * (1 + bonus));
      }
    }
    return { resource: def.output, amount };
  }
  if (def.outputPerAdjacentByLevel && def.adjacentTo) {
    const per = atLevel(def.outputPerAdjacentByLevel, building.level);
    return { resource: def.output, amount: per * adjacentSameCity(state, building.position, def.adjacentTo, building.cityId) };
  }
  return { resource: def.output, amount: 0 };
}

/** Supply contributed to its city by a building. */
export function buildingSupply(state: GameState, building: BuildingState, registry: DataRegistry): number {
  const def = registry.economy.buildings[building.kind];
  if (!def) return 0;
  if (def.supplyByLevel) return atLevel(def.supplyByLevel, building.level);
  if (def.supplyPerAdjacentByLevel && def.adjacentTo) {
    const per = atLevel(def.supplyPerAdjacentByLevel, building.level);
    return per * adjacentSameCity(state, building.position, def.adjacentTo, building.cityId);
  }
  return 0;
}

/** Recompute supply + level for every city from current buildings. Call after any economy mutation. */
export function recomputeCities(state: GameState, registry: DataRegistry): void {
  for (const city of state.cities) city.supply = 0;
  for (const building of state.buildings) {
    const city = cityById(state, building.cityId);
    if (!city) continue;
    city.supply += buildingSupply(state, building, registry);
  }
  for (const city of state.cities) {
    city.level = cityLevelForSupply(city.supply, registry);
  }
}

// ── Unit pop (capacity) accounting ──
/** Number of living units homed at a city (stale entries for dead units are ignored). */
export function unitsHomedAt(state: GameState, cityId: CityId): number {
  let count = 0;
  for (const unit of state.units) {
    if (state.unitHomeCity[unit.id] === cityId) count++;
  }
  return count;
}

export function cityHasCapacity(state: GameState, city: CityState, registry: DataRegistry): boolean {
  return unitsHomedAt(state, city.id) < cityPop(city, registry);
}

// ── Resource income ──
export function calculateOreIncome(state: GameState, playerId: PlayerId, registry: DataRegistry): number {
  let income = 0;
  for (const city of state.cities) {
    if (city.owner === playerId) income += cityProduction(city, registry);
  }
  income += buildingIncome(state, playerId, 'ore', registry);
  return income;
}

export function calculatePlasmaIncome(state: GameState, playerId: PlayerId, registry: DataRegistry): number {
  return buildingIncome(state, playerId, 'plasma', registry);
}

function buildingIncome(state: GameState, playerId: PlayerId, resource: ResourceKind, registry: DataRegistry): number {
  let total = 0;
  for (const building of state.buildings) {
    const city = cityById(state, building.cityId);
    if (!city || city.owner !== playerId) continue;
    const out = buildingOutput(state, building, registry);
    if (out.resource === resource) total += out.amount;
  }
  return total;
}

// ── Unit costs ──
export function getUnitPlasmaCost(typeId: string, registry: DataRegistry): number {
  return registry.economy.unitPlasmaCost[typeId] ?? 0;
}

// ── Build / upgrade costs ──
/** Ore cost to build (level 1) or to upgrade to `targetLevel`. */
export function buildingCost(def: BuildingDef, targetLevel: number): { ore: number; plasma: number } {
  const ore = def.costByLevel[targetLevel - 1] ?? 0;
  const plasma = def.plasmaCostByLevel?.[targetLevel - 1] ?? 0; // pinned: absent for now
  return { ore, plasma };
}

function techMet(state: GameState, playerId: PlayerId, tech: string | null | undefined): boolean {
  if (!tech) return true;
  return state.players[playerId].researchedTechs.includes(tech);
}

// ── Build legality ──
function countCityBuildings(state: GameState, cityId: CityId, kind: BuildingKind): number {
  return state.buildings.filter(b => b.cityId === cityId && b.kind === kind).length;
}

/** Whether `playerId` may build `kind` at `pos` right now (predicate shared by legal-actions + apply). */
export function canBuild(state: GameState, registry: DataRegistry, playerId: PlayerId, kind: BuildingKind, pos: Coord): boolean {
  const def = registry.economy.buildings[kind];
  if (!def) return false;

  const tile = state.map.tiles[pos.y]?.[pos.x];
  if (!tile || tile.isCity) return false;
  if (buildingAt(state, pos)) return false; // one building per tile

  const city = territoryCityAt(state, registry, pos);
  if (!city || city.owner !== playerId) return false;

  if (def.perCity !== null && countCityBuildings(state, city.id, kind) >= def.perCity) return false;
  if (!techMet(state, playerId, def.techRequired)) return false;

  if (def.on === 'ore' || def.on === 'plasma') {
    if (resourceKindAt(state, pos) !== def.on) return false;
  } else {
    // 'land': a passable, non-resource tile that has at least one same-city
    // REB1 of the kind it boosts adjacent to it (otherwise it does nothing).
    const terrain = registry.terrainTypes[tile.terrain];
    if (!terrain || !terrain.passable) return false;
    if (resourceKindAt(state, pos) !== null) return false;
    if (def.adjacentTo && adjacentSameCity(state, pos, def.adjacentTo, city.id) < 1) return false;
  }

  const cost = buildingCost(def, 1);
  const player = state.players[playerId];
  return player.ore >= cost.ore && player.plasma >= cost.plasma;
}

export function upgradeCostFor(building: BuildingState, registry: DataRegistry): { ore: number; plasma: number } | null {
  const def = registry.economy.buildings[building.kind];
  if (!def) return null;
  if (building.level >= def.maxLevel) return null;
  return buildingCost(def, building.level + 1);
}

export function canUpgradeBuilding(state: GameState, registry: DataRegistry, playerId: PlayerId, pos: Coord): boolean {
  const building = buildingAt(state, pos);
  if (!building) return false;
  const def = registry.economy.buildings[building.kind];
  if (!def) return false;
  const city = cityById(state, building.cityId);
  if (!city || city.owner !== playerId) return false;

  const nextLevel = building.level + 1;
  if (nextLevel > def.maxLevel) return false;
  if (!techMet(state, playerId, def.upgradeTechRequired?.[building.level - 1])) return false;

  const cost = buildingCost(def, nextLevel);
  const player = state.players[playerId];
  return player.ore >= cost.ore && player.plasma >= cost.plasma;
}

export function canFoundCity(state: GameState, registry: DataRegistry, playerId: PlayerId, pos: Coord): boolean {
  if (!isRuin(state, pos)) return false;
  if (cityAt(state, pos)) return false;
  const { cost, requiresUnitOnTile } = registry.economy.foundCity;
  if (requiresUnitOnTile) {
    const hasUnit = state.units.some(u => u.owner === playerId && u.position.x === pos.x && u.position.y === pos.y);
    if (!hasUnit) return false;
  }
  return state.players[playerId].ore >= cost;
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
 * Add ore income, then pay (currently disabled) upkeep. If upkeep ever exceeds
 * what a player can afford, units desert cheapest-first (deterministic). Ore is
 * guaranteed to end >= 0. Mutates `state`.
 */
export function settleEconomy(state: GameState, playerId: PlayerId, income: number, registry: DataRegistry): Unit[] {
  const player = state.players[playerId];
  const available = player.ore + income;

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

  player.ore = available - upkeep;
  return deserted;
}
