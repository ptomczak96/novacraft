import type {
  GameState, PlayerId, DataRegistry, Unit, Coord,
  CityState, CityId, BuildingState, BuildingKind, BuildingDef, ResourceKind, LevelUpChoice,
  EconomySource, CityEconomy,
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

/** Whether `pos` belongs to `city`'s territory — its base 3×3 OR a claimed extra tile. */
export function cityOwnsTile(city: CityState, registry: DataRegistry, pos: Coord): boolean {
  const r = registry.economy.city.territoryRadius;
  if (chebyshev(city.position, pos) <= r) return true;
  return (city.extraTerritory ?? []).some(t => t.x === pos.x && t.y === pos.y);
}

/** The (at most one) city whose territory contains `pos`. Territories never overlap. */
export function territoryCityAt(state: GameState, registry: DataRegistry, pos: Coord): CityState | undefined {
  return state.cities.find(c => cityOwnsTile(c, registry, pos));
}

function buildingAt(state: GameState, pos: Coord): BuildingState | undefined {
  return state.buildings.find(b => b.position.x === pos.x && b.position.y === pos.y);
}

// Highest level reachable via the level-up choice system today. Bonuses are only
// designed for reaching L2/L3/L4; L5/L6 are deferred (see backlog), so cities cap
// here for now even though economy.json still allows maxLevel 6.
export const LEVEL_CHOICE_MAX = 4;

// ── City production / pop (capacity) / level ──
export function cityProduction(city: CityState, registry: DataRegistry): number {
  const c = registry.economy.city;
  const base = city.isCapital ? c.capitalBaseProduction : c.cityBaseProduction;
  return base + c.productionPerLevel * (city.level - 1) + (city.incomeBonus ?? 0);
}

/** Unit capacity of a city (how many units it can support). */
export function cityPop(city: CityState, registry: DataRegistry): number {
  return registry.economy.city.popBase + (city.level - 1) + (city.popBonus ?? 0);
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

/**
 * Supply progress *within the current level*, for display. The stored
 * `supply` is cumulative, but the UI shows a per-level counter that "resets"
 * each time the city levels: current = supply − (threshold reached for this
 * level), needed = (next threshold) − (this level's threshold). E.g. an L1
 * city needs 2 to reach L2 (shown 0/2 → 2/2); once at L2 it shows 0/3, etc.
 * At max level there is no next threshold (atMax = true).
 */
export function citySupplyProgress(
  city: CityState,
  registry: DataRegistry,
): { current: number; needed: number; atMax: boolean } {
  if (city.level >= LEVEL_CHOICE_MAX) return { current: 0, needed: 0, atMax: true };
  const base = citySupplyForLevel(city.level, registry); // supply to reach current level
  const next = citySupplyForLevel(city.level + 1, registry); // supply to reach next level
  return { current: city.supply - base, needed: next - base, atMax: false };
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

/**
 * A REB's *output* is blocked while an ENEMY unit stands on its tile (an enemy
 * occupying your mine/extractor/refinery stops you collecting its ore/plasma that
 * turn). Supply/leveling is NOT affected — only income. See docs/ECONOMY.md.
 */
export function buildingBlocked(state: GameState, building: BuildingState): boolean {
  const owner = cityById(state, building.cityId)?.owner;
  if (owner === undefined || owner === null) return false;
  const occupant = state.units.find(
    u => u.position.x === building.position.x && u.position.y === building.position.y,
  );
  return !!occupant && occupant.owner !== owner;
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

/**
 * Recompute each city's accumulated supply from its buildings (+ any permanent
 * bonusSupply). Level is NO LONGER derived here — it only advances when the
 * player accepts a level-up (levelUpCity), so the player keeps the bonus choice.
 * Call after any economy mutation.
 */
export function recomputeCities(state: GameState, registry: DataRegistry): void {
  for (const city of state.cities) city.supply = city.bonusSupply ?? 0;
  for (const building of state.buildings) {
    const city = cityById(state, building.cityId);
    if (!city) continue;
    city.supply += buildingSupply(state, building, registry);
  }
}

/** Cumulative supply needed to REACH `level` (2..). Level 1 needs none. */
export function citySupplyForLevel(level: number, registry: DataRegistry): number {
  if (level <= 1) return 0;
  return registry.economy.city.supplyThresholds[level - 2];
}

/** Whether `city` has enough supply to accept its next level-up right now. */
export function cityCanLevelUp(city: CityState, registry: DataRegistry): boolean {
  if (city.level >= LEVEL_CHOICE_MAX) return false; // L5/L6 bonuses not designed yet
  return city.supply >= citySupplyForLevel(city.level + 1, registry);
}

// ── Territory expansion (L4 "Expand territory" reward) ──

/** Is `pos` claimable as new territory at all (in-bounds, not a city/ruin, unclaimed)? */
export function isTileClaimable(state: GameState, registry: DataRegistry, pos: Coord): boolean {
  const tile = state.map.tiles[pos.y]?.[pos.x];
  if (!tile) return false; // off-map
  if (tile.isCity || tile.isRuin) return false; // can't claim a settlement/ruin site
  if (territoryCityAt(state, registry, pos)) return false; // already in some city's territory
  return true;
}

/**
 * Anti-snake rule: a candidate tile is eligible only if ≥2 of its 8 neighbours are
 * already "owned" by the city — where owned = base 3×3 + previously-claimed extras
 * (via cityOwnsTile) + any tiles in `accepted` (the picks committed so far this turn).
 * This prevents single-tile-wide tendrils snaking out toward resources.
 */
export function isExpansionTileEligible(
  state: GameState,
  registry: DataRegistry,
  city: CityState,
  pos: Coord,
  accepted: Coord[],
): boolean {
  if (!isTileClaimable(state, registry, pos)) return false;
  if (accepted.some(t => t.x === pos.x && t.y === pos.y)) return false; // already picked
  let owned = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = { x: pos.x + dx, y: pos.y + dy };
      if (cityOwnsTile(city, registry, n) || accepted.some(t => t.x === n.x && t.y === n.y)) owned++;
    }
  }
  return owned >= 2;
}

/**
 * Validate a full set of expansion `tiles` for `city`: there must exist an order in
 * which each tile is eligible given the ones accepted before it (greedy topo check).
 * Returns true only if every tile can be placed. Order in the array doesn't matter.
 */
export function validateExpansion(
  state: GameState,
  registry: DataRegistry,
  city: CityState,
  tiles: Coord[],
): boolean {
  if (tiles.length === 0) return false;
  // No duplicates.
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if (tiles[i].x === tiles[j].x && tiles[i].y === tiles[j].y) return false;
    }
  }
  const remaining = [...tiles];
  const accepted: Coord[] = [];
  let progress = true;
  while (remaining.length > 0 && progress) {
    progress = false;
    for (let i = 0; i < remaining.length; i++) {
      if (isExpansionTileEligible(state, registry, city, remaining[i], accepted)) {
        accepted.push(remaining[i]);
        remaining.splice(i, 1);
        progress = true;
        break;
      }
    }
  }
  return remaining.length === 0;
}

/** The two reward options offered when a city reaches `targetLevel` (the new level). */
export function levelUpChoices(targetLevel: number): { a: LevelUpChoice; b: LevelUpChoice } | null {
  switch (targetLevel) {
    case 2: return { a: 'income', b: 'pop' };
    case 3: return { a: 'fortify', b: 'reveal' };
    case 4: return { a: 'supply', b: 'territory' };
    default: return null;
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

/** Raw (un-rounded) pop weight of units homed at a city — scuttlings count 0.5 each. */
export function cityPopRaw(state: GameState, cityId: CityId, registry: DataRegistry): number {
  let sum = 0;
  for (const unit of state.units) {
    if (state.unitHomeCity[unit.id] !== cityId) continue;
    sum += registry.unitTypes[unit.typeId]?.popCost ?? 1;
  }
  return sum;
}

/** Pop used by a city for display/capacity — rounded UP (so a lone 0.5 scuttling = 1). */
export function cityPopUsed(state: GameState, cityId: CityId, registry: DataRegistry): number {
  return Math.ceil(cityPopRaw(state, cityId, registry));
}

/** Can the city absorb `addedPop` more pop weight without exceeding its cap? */
export function cityHasCapacityFor(state: GameState, city: CityState, registry: DataRegistry, addedPop = 1): boolean {
  return Math.ceil(cityPopRaw(state, city.id, registry) + addedPop) <= cityPop(city, registry);
}

export function cityHasCapacity(state: GameState, city: CityState, registry: DataRegistry): boolean {
  return cityHasCapacityFor(state, city, registry, 1);
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
    if (buildingBlocked(state, building)) continue; // enemy sitting on the REB
    const out = buildingOutput(state, building, registry);
    if (out.resource === resource) total += out.amount;
  }
  return total;
}

/**
 * Structured, per-city income breakdown for a player — what each city produces and
 * the individual sources feeding it (base city production + each REB). Used by the
 * income tooltips and the city-info box. Blocked REBs are listed (with their would-be
 * amount) but excluded from the city/resource totals. Deterministic ordering (by id).
 */
export function playerEconomy(state: GameState, playerId: PlayerId, registry: DataRegistry): CityEconomy[] {
  const cities = state.cities.filter(c => c.owner === playerId).sort((a, b) => a.id - b.id);
  const result: CityEconomy[] = [];
  let cityIndex = 0;
  for (const city of cities) {
    cityIndex++;
    const ore = { total: 0, sources: [] as EconomySource[] };
    const plasma = { total: 0, sources: [] as EconomySource[] };

    // Base city production is ore.
    const prod = cityProduction(city, registry);
    ore.sources.push({ kind: 'city', index: 1, amount: prod, blocked: false });
    ore.total += prod;

    const kindCount: Partial<Record<BuildingKind, number>> = {};
    const cityBuildings = state.buildings.filter(b => b.cityId === city.id).sort((a, b) => a.id - b.id);
    for (const b of cityBuildings) {
      kindCount[b.kind] = (kindCount[b.kind] ?? 0) + 1; // number every REB of a kind in order
      const out = buildingOutput(state, b, registry);
      if (out.amount === 0) continue; // nothing to show (e.g. refinery with no adjacency)
      const blocked = buildingBlocked(state, b);
      const bucket = out.resource === 'plasma' ? plasma : ore;
      bucket.sources.push({ kind: b.kind, index: kindCount[b.kind]!, amount: out.amount, blocked });
      if (!blocked) bucket.total += out.amount;
    }

    result.push({ cityId: city.id, isCapital: city.isCapital, cityIndex, ore, plasma });
  }
  return result;
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

/**
 * Whether `pos` is a valid place for `playerId` to build `kind` — every check EXCEPT
 * whether they can currently afford it (tile/terrain, territory ownership, per-city
 * limit, tech, resource-tile gate). The UI uses this to surface a build site with its
 * cost even when the player is short on resources (shown unaffordable), while
 * `canBuild` (= location + affordability) governs legal actions and apply.
 */
export function canBuildLocation(state: GameState, registry: DataRegistry, playerId: PlayerId, kind: BuildingKind, pos: Coord): boolean {
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
    // 'land' REB2: build on a plain (passable, non-resource) tile that has ≥1 same-city
    // REB1 of the kind it boosts adjacent to it — a refinery needs an adjacent MINE, a
    // purifier an adjacent EXTRACTOR (the actual building, not just the resource tile).
    // Same-city adjacency inherently keeps it in this city's territory.
    const terrain = registry.terrainTypes[tile.terrain];
    if (!terrain || !terrain.passable) return false;
    if (resourceKindAt(state, pos) !== null) return false;
    if (!def.adjacentTo || adjacentSameCity(state, pos, def.adjacentTo, city.id) < 1) return false;
  }
  return true;
}

/** Whether `playerId` may build `kind` at `pos` right now (predicate shared by legal-actions + apply). */
export function canBuild(state: GameState, registry: DataRegistry, playerId: PlayerId, kind: BuildingKind, pos: Coord): boolean {
  if (!canBuildLocation(state, registry, playerId, kind, pos)) return false;
  const def = registry.economy.buildings[kind];
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
    // The unit must be on the ruin AND not have moved this turn — so founding
    // (like capturing) is only available the turn AFTER moving onto the ruin.
    const unit = state.units.find(u => u.owner === playerId && u.position.x === pos.x && u.position.y === pos.y);
    if (!unit || unit.hasMoved) return false;
    // Condition "Impotent founder": this unit type can't found cities (see docs/conditions.md).
    if (registry.unitTypes[unit.typeId]?.conditions?.includes('impotent_founder')) return false;
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
