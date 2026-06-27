import type { PRNGState } from './prng.js';

// ── Identifiers ──
export type PlayerId = number; // 0, 1, ... N-1
export type UnitId = number;
export type Coord = { x: number; y: number };

// ── Terrain ──
export interface TerrainType {
  id: string;
  name: string;
  movementCost: number;
  defenceBonus: number; // e.g. 0.2 = +20%
  blocksSight: boolean;
  passable: boolean;
  resourceYield: number; // income per turn when controlled
  color: string; // hex color for rendering
  icon: string; // emoji or character
}

// ── Units ──
export interface UnitType {
  id: string;
  name: string;
  faction: string; // faction id, or "shared"
  cost: number;
  maxHP: number;
  attack: number;
  defence: number;
  movement: number;
  attackRange: number;
  sightRange: number;
  abilities: AbilityDef[];
  traits: string[]; // e.g. "flying", "aquatic", "ignoresTerrainCost"
}

export interface AbilityDef {
  id: string;
  name: string;
  effects: EffectDef[];
  cooldown?: number;
}

export interface EffectDef {
  type: 'damage' | 'push' | 'heal' | 'applyStatus' | 'revealArea' | 'spawnUnit' | 'modifyStat';
  params: Record<string, number | string>;
}

// ── Faction ──
export interface FactionDef {
  id: string;
  name: string;
  color: string;
  unitTypes: string[]; // ids of units this faction can build (including shared)
}

// ── Tech Tree ──
export interface TechDef {
  id: string;
  name: string;
  branch: string; // tech branch, e.g. 'refinement'
  level: number; // 1..maxLevel
  effects: TechEffect[];
  prerequisites?: string[]; // optional explicit prereqs, in addition to the branch-unlock rule
  locked?: boolean; // preview only — shown in UI (greyed) but not yet researchable
}

export interface TechEffect {
  type: 'unlockUnit' | 'globalModifier';
  params: Record<string, number | string>;
}

// Tech research cost scales with the number of cities the researcher owns:
//   cost(level, cities) = costBaseByLevel[level-1] + costPerCityByLevel[level-1] * (cities - 1)
export interface TechConfig {
  maxLevel: number;
  costBaseByLevel: number[]; // ore cost at 1 city, indexed by level-1
  costPerCityByLevel: number[]; // extra ore per additional city, indexed by level-1
}

// ── Game Config ──
export interface GameConfig {
  mapWidth: number;
  mapHeight: number;
  fogOfWar: boolean;
  turnLimit: number;
  winConditions: {
    captureAllCities: boolean;
    eliminateAllUnits: boolean;
    highestScoreAtLimit: boolean;
  };
  combatConfig: CombatConfig;
  scoreWeights: {
    cityValue: number;
    unitCostValue: number;
    incomeValue: number;
  };
  comebackThreshold: number; // fraction, e.g. 0.25 = 25%
  mapgen?: MapGenOptions; // optional; sensible defaults applied when absent
}

// ── Map generation tuning ──
// All fields optional so older configs/saves keep working. Generation currently
// supports two biomes; water and lava generation is disabled (the classification
// code remains in mapgen for when we re-enable them).
export type Biome = 'grassland' | 'stone';

export interface MapGenOptions {
  biome?: Biome;            // overall map theme
  resourceDensity?: number; // 0..1 — fraction of land carrying ore/plasma
  ruinCount?: number;       // number of foundable-city ruins to scatter
}

export interface CombatConfig {
  hpScaling: boolean; // whether attacker.HP/maxHP affects damage
  retaliationMultiplier: number; // 0.5 = half attack on retaliation
  minimumDamage: number;
  damageVariance: number; // 0 = deterministic, >0 uses PRNG
}

// ── Map ──
export interface Tile {
  terrain: string; // terrain type id
  owner: PlayerId | null; // who controls this tile
  isCity: boolean;
  isResourceTile: boolean;
  isPerimeter?: boolean; // outer ring of base territory
  // ── Economy markers (set by mapgen; read by the economy layer) ──
  // Optional so existing maps keep working: a tile with isResourceTile but no
  // resourceKind is treated as a shard outcrop by the economy layer.
  resourceKind?: ResourceKind | null; // 'shard' | 'plasma' | null
  isRuin?: boolean; // a site where a new city can be founded
}

export interface GameMap {
  width: number;
  height: number;
  tiles: Tile[][]; // [y][x]
}

// ── Unit Instance ──
export interface Unit {
  id: UnitId;
  typeId: string;
  owner: PlayerId;
  position: Coord;
  hp: number;
  hasMoved: boolean;
  hasAttacked: boolean;
  abilityCooldowns: Record<string, number>;
}

// ── Actions ──
export type Action =
  | MoveAction
  | AttackAction
  | RecruitAction
  | ResearchAction
  | UseAbilityAction
  | BuildAction
  | UpgradeBuildingAction
  | FoundCityAction
  | CaptureCityAction
  | EndTurnAction;

export interface MoveAction {
  type: 'move';
  unitId: UnitId;
  to: Coord;
}

export interface AttackAction {
  type: 'attack';
  unitId: UnitId;
  targetId: UnitId;
}

export interface RecruitAction {
  type: 'recruit';
  unitTypeId: string;
  cityPosition: Coord;
}

export interface ResearchAction {
  type: 'research';
  techId: string;
}

export interface UseAbilityAction {
  type: 'useAbility';
  unitId: UnitId;
  abilityId: string;
  target: Coord;
}

export interface BuildAction {
  type: 'build';
  kind: BuildingKind;
  position: Coord;
}

export interface UpgradeBuildingAction {
  type: 'upgradeBuilding';
  position: Coord;
}

export interface FoundCityAction {
  type: 'foundCity';
  position: Coord;
}

export interface CaptureCityAction {
  type: 'captureCity';
  unitId: UnitId;
}

export interface EndTurnAction {
  type: 'endTurn';
}

// ── Economy: Cities & Buildings ──
export type ResourceKind = 'ore' | 'plasma';
export type BuildingKind = 'mine' | 'extractor' | 'refinery' | 'purifier';
export type CityId = number;

// Terminology:
//   pop    = how many units a city can support (capacity) = popBase + level - 1
//   supply = leveling currency accumulated from buildings; crossing a
//            supplyThreshold raises the city's level (and therefore its pop).
export interface CityState {
  id: CityId;
  position: Coord; // the city/capital centre tile
  owner: PlayerId | null;
  isCapital: boolean;
  level: number; // 1..maxLevel (derived from supply, stored for serialization)
  supply: number; // total supply from buildings in this city's territory
}

export interface BuildingState {
  id: number;
  kind: BuildingKind;
  position: Coord;
  level: number; // 1..def.maxLevel
  cityId: CityId | null; // the city whose territory contains this building
}

// ── Game State ──
export interface PlayerState {
  id: PlayerId;
  factionId: string;
  ore: number; // primary resource (basic units + buildings)
  plasma: number; // advanced resource (high-tech units + buildings)
  researchedTechs: string[];
}

export interface GameState {
  config: GameConfig;
  map: GameMap;
  units: Unit[];
  players: PlayerState[];
  cities: CityState[];
  buildings: BuildingState[];
  unitHomeCity: Record<UnitId, CityId>; // unit id -> home city (slot accounting)
  currentPlayer: PlayerId;
  turn: number;
  nextUnitId: UnitId;
  nextCityId: CityId;
  nextBuildingId: number;
  prng: PRNGState;
  actionLog: Action[];
  phase: 'playing' | 'finished';
  winner: PlayerId | null;
  winConditionMet: string | null;
}

// ── Fog of War ──
export type TileVisibility = 'hidden' | 'explored' | 'visible';

export interface VisibleState {
  config: GameConfig;
  map: GameMap;
  units: Unit[]; // only visible enemy units + all own units
  players: PlayerState[]; // own player full, others limited
  cities: CityState[];
  buildings: BuildingState[];
  unitHomeCity: Record<UnitId, CityId>;
  currentPlayer: PlayerId;
  turn: number;
  visibility: TileVisibility[][]; // [y][x]
  phase: 'playing' | 'finished';
  winner: PlayerId | null;
  winConditionMet: string | null;
  actionLog: Action[];
}

// ── Game Result ──
export interface GameResult {
  winner: PlayerId | null; // null = draw
  winCondition: string;
  finalScores: Record<PlayerId, number>;
  turns: number;
}

// ── Economy ──
// All economy tuning lives here (its own data file), keyed by ids, so this
// feature does not touch units.json / terrain.json / mapgen.
//
// Two building shapes share this def:
//   REB1 (mine, extractor)    — self output/supply by level (outputByLevel,
//                               supplyByLevel)
//   REB2 (refinery, purifier) — output/supply PER adjacent same-city REB1
//                               (outputPerAdjacentByLevel, supplyPerAdjacentByLevel)
export interface BuildingDef {
  on: ResourceKind | 'land'; // tile requirement
  output: ResourceKind; // resource this building produces per turn
  maxLevel: number;
  perCity: number | null; // max of this building per city (null = unlimited)
  costByLevel: number[]; // ore cost: [build, upgrade->L2, upgrade->L3, ...]
  plasmaCostByLevel?: number[]; // optional plasma cost per level (pinned/unused for now)
  // REB1:
  outputByLevel?: number[]; // resource/turn at level
  supplyByLevel?: number[]; // supply at level
  // REB2:
  adjacentTo?: BuildingKind; // which REB1 it counts in its 3x3 (same city only)
  outputPerAdjacentByLevel?: number[]; // resource/turn per adjacent REB1, by level
  supplyPerAdjacentByLevel?: number[]; // supply per adjacent REB1, by level
  // Tech gating (mechanism present; all null for now = unlocked):
  techRequired?: string | null; // tech to build at all
  upgradeTechRequired?: (string | null)[]; // tech to reach L2, L3, ...
}

export interface EconomyData {
  // Upkeep (currently dormant — multiplier 0; kept for future use).
  upkeepMultiplier: number;
  upkeepDefault: number;
  upkeepByUnit: Record<string, number>;

  startingOre: number;
  startingPlasma: number;

  city: {
    maxLevel: number;
    capitalBaseProduction: number; // ore/turn at level 1 for a capital
    cityBaseProduction: number; // ore/turn at level 1 for a founded city
    productionPerLevel: number; // extra ore/turn per level above 1
    popBase: number; // unit capacity at level 1 (pop = popBase + level - 1)
    supplyThresholds: number[]; // total supply to reach level 2, 3, ... maxLevel
    territoryRadius: number; // Chebyshev radius of a city's territory
  };

  buildings: Record<string, BuildingDef>; // keyed by BuildingKind
  foundCity: { cost: number; requiresUnitOnTile: boolean };
  unitPlasmaCost: Record<string, number>; // unitTypeId -> plasma cost (default 0)
}

// ── Data Registry ──
export interface DataRegistry {
  terrainTypes: Record<string, TerrainType>;
  unitTypes: Record<string, UnitType>;
  factions: Record<string, FactionDef>;
  techs: Record<string, TechDef>;
  techConfig: TechConfig;
  economy: EconomyData;
}
