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
  attackRange: number; // max attack range (Chebyshev)
  minAttackRange?: number; // min attack range; >1 = a banded weapon that can't fire closer (default 1)
  visibility: number; // fog sight radius (Chebyshev): 0=own tile only, 1=3x3, 2=5x5, …
  unitClass?: string; // e.g. "light" — grouping/flavour, not yet mechanical
  popCost?: number; // pop weight (default 1); scuttling = 0.5 (a pair = 1 pop)
  recruitCount?: number; // units spawned per recruit (default 1); scuttling = 2 (paired)
  conditions?: string[]; // special conditions applied to this unit (see docs/conditions.md)
  abilities: AbilityDef[];
  traits: string[]; // e.g. "flying", "aquatic", "ignoresTerrainCost"
}

export interface AbilityDef {
  id: string;
  name: string;
  effects: EffectDef[];
  cooldown?: number;
  morphTo?: string; // if set, casting morphs the unit into this unit type (e.g. assault mode)
  range?: number; // Chebyshev cast range (tiles); omitted = self/no-target
  minRange?: number; // minimum Chebyshev cast range — tiles closer than this are illegal (e.g. Ballistic Volley = 2)
  targetKind?: 'unit' | 'units' | 'tile' | 'grid2x2'; // 'units' = multi-unit pick (up to maxTargets)
  targetClass?: string; // if targetKind 'unit', restrict to this unitClass (e.g. "light")
  targetClasses?: string[]; // if targetKind 'units', restrict to these unitClasses (e.g. ["heavy","giant"])
  maxTargets?: number; // for targetKind 'units': how many distinct targets may be picked (default 1)
  targetEnemy?: boolean; // if targetKind 'unit', restrict to enemy units only
  targetAlly?: boolean; // restrict to friendly units only
  targetAfflicted?: boolean; // if set, only units carrying a removable affliction are eligible (Cure)
  disabled?: boolean; // greyed-out placeholder ability — never offered/castable yet
  duration?: number; // effect duration in rounds (Spray Bile = 5)
  requiresTech?: string; // ability only castable once the owner has researched this tech
  supersededByTech?: string; // ability is HIDDEN once the owner researches this tech (replaced by an upgrade)
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
  startingUnits?: { unit: string; count: number }[]; // units spawned at game start (default: 1 warrior)
  unitTypes: string[]; // ids of units this faction can build (including shared)
}

// ── Tech Tree ──
export interface TechDef {
  id: string;
  name: string;
  branch: string; // tech branch, e.g. 'refinement'
  level: number; // 1..maxLevel
  effects: TechEffect[];
  plasmaCost?: number; // plasma cost at 1 city (0/absent = ore-only research)
  plasmaCostPerCity?: number; // +plasma per additional city (linear scaling)
  prerequisites?: string[]; // optional explicit prereqs (ALL required), in addition to the branch-unlock rule
  prerequisitesAny?: string[]; // optional OR-prereqs (at least ONE required), e.g. Crucible OR Mech Bay
  excludes?: string[]; // mutually-exclusive techs: if any is researched, this one can't be (e.g. Wyrm's Tunneling Network ⊕ Aftershock)
  locked?: boolean; // preview only — shown in UI (greyed) but not yet researchable
}

export interface TechEffect {
  // 'grantCondition' → adds a passive condition to a unit type for the researching player
  //   (params: { unit, condition }). The condition's behaviour is implemented like any other.
  type: 'unlockUnit' | 'globalModifier' | 'grantCondition';
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
    captureCapital: boolean;   // win when you hold every enemy CAPITAL (their capital captured)
    eliminateAllUnits: boolean;
    highestScoreAtLimit: boolean;
  };
  combatConfig: CombatConfig;
  // Passive HP regen for a unit that neither moved nor attacked this turn, by the territory
  // it stands in. Optional; the engine falls back to 4 / 2 / 0.
  heal?: { friendlyTerritory: number; neutralTerritory: number; enemyTerritory: number };
  scoreWeights: {
    cityValue: number;
    unitCostValue: number;
    incomeValue: number;
  };
  comebackThreshold: number; // fraction, e.g. 0.25 = 25%
  mapgen?: MapGenOptions; // optional; sensible defaults applied when absent
  richStart?: boolean; // testing: each team starts with 2000 ore + 2000 plasma
  // Tech tree ON/OFF. When `false`, the whole tech tree is unlocked from the start
  // (every player begins with all (non-locked) techs researched → all units/tech/
  // abilities available). Undefined/true = research-gated (normal play). The keeps
  // tech→unit links intact either way; OFF just pre-satisfies them.
  techTreeEnabled?: boolean;
  // Resource mode: when true, players start with an effectively unlimited wallet (sandbox).
  // Mutually exclusive with mapgen.doubleResources at the UI level; both may be off (Normal).
  unlimitedResources?: boolean;
  // "Nodes" mechanic toggle (buildable buff/debuff structures). Scaffolding — the flag is
  // carried through config but Nodes behaviour is not implemented yet.
  nodesEnabled?: boolean;
}

// ── Map generation tuning ──
// All fields optional so older configs/saves keep working. Generation currently
// supports two biomes; water and lava generation is disabled (the classification
// code remains in mapgen for when we re-enable them).
export type Biome = 'grassland' | 'stone' | 'desert';

export interface MapGenOptions {
  biome?: Biome;            // overall map theme
  resourceDensity?: number; // 0..1 — fraction of land carrying ore/plasma
  ruinCount?: number;       // number of foundable-city ruins to scatter
  doubleResources?: boolean; // testing: 2× the map's resource spawn rate
  impassableFraction?: number; // 0..1 — target share of impassable tiles (water+lava); default 0.05
  mountainFraction?: number;   // 0..1 — target share of mountain/peak tiles; default 0.08
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
  fortified?: boolean; // city centre fortified (L3 reward) — combat reads this for extra defence
  // "Spray Bile" (Seercaust): an infected tile. Friendly units (owner === bile.owner) get
  // ATK ×1.2 & DEF ×1.2; enemies get DEF ×0.8 (and a movement penalty — TODO, pathing).
  // Cleared when state.turn >= expiresTurn. See docs/conditions.md.
  bile?: { owner: PlayerId; expiresTurn: number };
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
  dashRemaining?: number; // post-attack move budget from the "Dash N" condition (this turn)
  statuses?: string[]; // conditions applied during play (e.g. "corrosive_1"); shown under Conditions
  statusExpiry?: Record<string, number>; // status → the round (state.turn) at which it clears (e.g. "slowed")
  infectedBy?: PlayerId; // if "infected" (Seercaust): the player who gets the 2 scuttlings on its death
  buildingNodeId?: number; // if this engineer is constructing a Node, that node's id (any action cancels it)
  marks?: UnitMark[]; // tracer / plant-explosive markers placed on this unit by an enemy
}

// A marker planted on an enemy unit: a Tracer Round (reveals it) or Plant Explosives (detonates).
// Ticks down at the end of the MARKED unit's owner's turn. See docs/conditions.md.
export interface UnitMark {
  kind: 'tracer' | 'explosive';
  owner: PlayerId;    // the player who placed it (always sees it; the marked team needs Detect)
  turnsLeft: number;  // 3 (tracer) / 2 (explosive) at cast; removed at 0 (explosive detonates first)
}

// ── Actions ──
export type Action =
  | MoveAction
  | AttackAction
  | SlashAction
  | WyrmStrikeAction
  | RecruitAction
  | ResearchAction
  | UseAbilityAction
  | BuildAction
  | UpgradeBuildingAction
  | FoundCityAction
  | CaptureCityAction
  | LevelUpCityAction
  | ExpandTerritoryAction
  | CancelNodeBuildAction
  | RemoveMarkAction
  | EndTurnAction;

export interface CancelNodeBuildAction {
  type: 'cancelNodeBuild';
  unitId: UnitId; // the engineer whose in-progress node is being cancelled
}

export interface RemoveMarkAction {
  type: 'removeMark';
  unitId: UnitId;       // the friendly remover (ally of the marked unit; not the marked unit itself)
  target: Coord;        // the marked ally's tile
  kind: 'tracer' | 'explosive';
}

export interface MoveAction {
  type: 'move';
  unitId: UnitId;
  to: Coord;
  // Blind/burrowed "bump into impassable terrain": the unit lands on `to` (the last
  // valid tile) and reveals `bumpReveal` (the hidden impassable tile) as fog, wasting
  // the rest of its movement. See docs/conditions.md (blind movement).
  bumpReveal?: Coord;
}

export interface AttackAction {
  type: 'attack';
  unitId: UnitId;
  targetId: UnitId;
}

// A Slash (Vindrace) — an AoE swing at a 3-tile arc. `target` is the CENTRAL tile
// (one of the unit's 8 neighbours); the two side tiles are derived from it. The
// central tile takes 100% damage, the side tiles 50%. Enemies only; no retaliation.
export interface SlashAction {
  type: 'slash';
  unitId: UnitId;
  target: Coord;
}

// A Wyrm strike (surfaced Wyrm) — hits TWO touching cells. `tiles[0]` is the primary
// (100% damage) and must be within the Wyrm's 3×3; `tiles[1]` is the secondary (50%)
// and must be adjacent (Chebyshev 1) to the primary. Neither may be the Wyrm's own
// tile. Tiles are targeted (not units), so it can strike into fog/cloud; no retaliation.
export interface WyrmStrikeAction {
  type: 'wyrmStrike';
  unitId: UnitId;
  tiles: Coord[];
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
  tiles?: Coord[]; // multi-tile casts (e.g. Ballistic Volley's 2×2 square); `target` is the anchor tile
  targets?: Coord[]; // multi-unit casts (Cure/Repair): the picked unit tiles; `target` is the first
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

/** Player-chosen reward when a city levels up (see LevelUpChoice). */
export type LevelUpChoice =
  | 'income' | 'pop' | 'fortify' | 'beacon' | 'supply' | 'territory'
  | 'muster' | 'detect' | 'conscription' | 'plasma' | 'hero';

export interface LevelUpCityAction {
  type: 'levelUpCity';
  cityId: CityId;
  choice: LevelUpChoice;
}

/**
 * The L4 "Expand territory" reward: levels the city to 4 AND claims `tiles`
 * (exactly 3) into its territory. The tiles must each be unclaimed and pass the
 * anti-snake adjacency rule (≥2 already-owned neighbours, counting earlier picks).
 */
export interface ExpandTerritoryAction {
  type: 'expandTerritory';
  cityId: CityId;
  tiles: Coord[];
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
  level: number; // 1..maxLevel — only raised by the levelUpCity action (player choice)
  supply: number; // Σ building supply in this city's territory + bonusSupply
  // ── Level-up bonuses (chosen via levelUpCity; all capture-invariant — they
  //    live on the city and transfer with it, never reset on capture) ──
  incomeBonus: number; // +ore/turn from "City income +30" choices
  popBonus: number; // extra unit capacity from "+1 pop" choices
  bonusSupply: number; // permanent supply from "+3 supply" choices (counts toward leveling)
  fortified: boolean; // "Fortify" chosen → units inside get a defensive bonus (combat module reads this)
  extraTerritory: Coord[]; // tiles claimed beyond the base 3×3 via "Expand territory" (L4 reward)
  // Higher-level level-up rewards (all capture-invariant flags on the city):
  beacon?: boolean;        // "Beacon" → city sight radius +1
  muster?: boolean;        // "Muster" → units recruited here may MOVE (not attack) the turn built
  detect?: boolean;        // "Detect" → exposes cloaked/burrowed enemies within the city's 3×3
  conscription?: boolean;  // "Conscription" → units recruited here cost 20% less ore
  plasmaBonus?: number;    // "+10 plasma/turn" choices
}

export interface BuildingState {
  id: number;
  kind: BuildingKind;
  position: Coord;
  level: number; // 1..def.maxLevel
  cityId: CityId | null; // the city whose territory contains this building
}

// ── Economy breakdown (for income tooltips / city-info readouts) ──
export interface EconomySource {
  kind: 'city' | BuildingKind; // 'city' = base city production, else a building
  index: number;               // 1-based index among same-kind sources in this city ("Mine 1")
  amount: number;              // gross output for the resource (before any blocking)
  blocked: boolean;            // enemy unit sitting on this REB → output not collected
}
export interface CityEconomy {
  cityId: CityId;
  isCapital: boolean;
  cityIndex: number;           // 1-based index among the player's cities
  ore: { total: number; sources: EconomySource[] };    // total excludes blocked sources
  plasma: { total: number; sources: EconomySource[] };
}

// ── Game State ──
export interface PlayerState {
  id: PlayerId;
  factionId: string;
  ore: number; // primary resource (basic units + buildings)
  plasma: number; // advanced resource (high-tech units + buildings)
  researchedTechs: string[];
  // Set on OTHER players' entries in a fog-of-war VisibleState: their ore/plasma/
  // researchedTechs are zeroed/emptied, not real. Never set on true GameState.
  redacted?: true;
}

/** A unit a city *could* recruit, with whether the player can currently afford it. */
export interface RecruitOption {
  unitTypeId: string;
  cost: number; // ore
  plasmaCost: number;
  affordable: boolean;
  locked?: boolean; // gated behind un-researched tech (tech tree ON) — shown greyed, not recruitable
  lockedBy?: string[]; // names of the tech(s) that unlock it (for the tooltip)
  fitsPop?: boolean; // false when the city lacks the population capacity for this unit
}

/**
 * A player's remembered view of the world (fog memory). Updated only for tiles
 * currently in sight; everything else stays frozen at its last-seen snapshot.
 */
export interface PlayerMemory {
  tiles: (Tile | null)[][]; // [y][x] last-seen tile; null = never seen (cloud)
  buildings: BuildingState[]; // last-seen buildings (snapshots), by position
  cities: CityState[]; // last-seen city snapshots, by centre position
}

// ── Nodes (Engineer-built 3×3 territory structures) ──
export interface NodeState {
  id: number;
  owner: PlayerId;
  position: Coord;         // centre tile (its territory is the 3×3 around it)
  building: boolean;       // true while under construction
  buildTurnsLeft: number;  // rounds of construction remaining (0 once complete)
  builderUnitId: number;   // the engineer constructing it — if it dies, the node is cancelled
}

export interface GameState {
  config: GameConfig;
  map: GameMap;
  units: Unit[];
  players: PlayerState[];
  cities: CityState[];
  buildings: BuildingState[];
  nodes: NodeState[];
  unitHomeCity: Record<UnitId, CityId>; // unit id -> home city (slot accounting)
  // Fog memory, one per player. A tile becomes "remembered" the moment it's seen and
  // is never cleared, so out-of-sight tiles show their LAST-SEEN snapshot (fog), and
  // never-seen tiles show as cloud. Drives both the cloud/fog distinction and what
  // structures/terrain are drawn under fog.
  memory: PlayerMemory[];
  // Temporary reveals for THIS turn (cleared in applyEndTurn): tiles a player exposed via a
  // bump (onto a cloaked enemy / hidden impassable terrain), a Wyrm strike, or a lethal-tile
  // death. A unit on such a tile shows to revealedTiles[player] — overriding cloak — until
  // the player's turn ends. See docs/conditions.md "Bump, Push & Collide".
  revealedTiles: Coord[][];
  // "Combined Arms": count of the current player's LIGHT-unit attacks per target this
  // turn (targetId → count). The 2nd+ hit on a target gets ×1.2. Cleared each end-turn.
  combinedArmsHits: Record<UnitId, number>;
  currentPlayer: PlayerId;
  turn: number;
  nextUnitId: UnitId;
  nextCityId: CityId;
  nextBuildingId: number;
  nextNodeId: number;
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
  players: PlayerState[]; // own player full; under fog others are `redacted` (id/faction only)
  cities: CityState[];
  buildings: BuildingState[];
  nodes: NodeState[];
  unitHomeCity: Record<UnitId, CityId>;
  currentPlayer: PlayerId;
  turn: number;
  visibility: TileVisibility[][]; // [y][x]
  phase: 'playing' | 'finished';
  winner: PlayerId | null;
  winConditionMet: string | null;
  // Empty under fog of war: Action entries carry no acting-player attribution, so the
  // log can't be filtered per-viewer — and exposing it whole would reveal every enemy
  // move made out of sight. Full log only when fogOfWar is off (perfect information).
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
    capitalSightRadius: number; // fog: Chebyshev radius a capital reveals (5x5 = 2)
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
