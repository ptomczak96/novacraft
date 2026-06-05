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
  cost: number;
  prerequisites: string[];
  effects: TechEffect[];
}

export interface TechEffect {
  type: 'unlockUnit' | 'globalModifier';
  params: Record<string, number | string>;
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
  cityIncome: number;
  resourceIncome: number;
  startingGold: number;
  combatConfig: CombatConfig;
  scoreWeights: {
    cityValue: number;
    unitCostValue: number;
    incomeValue: number;
  };
  comebackThreshold: number; // fraction, e.g. 0.25 = 25%
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

export interface EndTurnAction {
  type: 'endTurn';
}

// ── Game State ──
export interface PlayerState {
  id: PlayerId;
  factionId: string;
  gold: number;
  researchedTechs: string[];
}

export interface GameState {
  config: GameConfig;
  map: GameMap;
  units: Unit[];
  players: PlayerState[];
  currentPlayer: PlayerId;
  turn: number;
  nextUnitId: UnitId;
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

// ── Data Registry ──
export interface DataRegistry {
  terrainTypes: Record<string, TerrainType>;
  unitTypes: Record<string, UnitType>;
  factions: Record<string, FactionDef>;
  techs: Record<string, TechDef>;
}
