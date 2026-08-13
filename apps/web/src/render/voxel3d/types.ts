import type { Texture } from 'three';
import type { GameMap, TileVisibility } from '@tactica/engine';

/**
 * The voxel3d renderer is a self-contained presentation module. It consumes the
 * engine's mapgen output READ-ONLY and shares no mechanisms with the 2D iso
 * renderer — all constants, palettes and helpers live inside this directory.
 */
export type MapData = GameMap;

/** Visual dressing of the arena — detected from the map's dominant terrain. */
export type ArenaTheme = 'city' | 'desert';

/** Render-side facing, derived from move deltas in the adapter (never engine state). */
export type Facing = 'ne' | 'nw' | 'se' | 'sw';

export interface UnitView {
  id: number;
  gridPos: { x: number; y: number };
  facing: Facing;
  teamColor: string;
  kind: string;
  /** True for units not owned by the viewing player — drives decorative
   *  scan-cone telegraphs on heavy units. */
  hostile?: boolean;
  /** Small world-space x/z shift so a garrisoned unit clears its city tower. */
  visualOffset?: number;
  /** World-space y lift so a unit stands ON a raised tile feature (tileset
   *  mode: mountain rock top) instead of merging into its geometry. */
  elevation?: number;
  /** True for the currently selected unit (drives the outline effect). */
  selected?: boolean;
  /** Current / max HP — drives the floating health bar on selection. */
  hp?: number;
  maxHp?: number;
}

/** One executed attack, for render-side lunge/flash effects (from the store's
 *  CombatEvent — purely presentational). */
export interface CombatFx {
  seq: number;
  attackerId: number;
  defenderId: number;
  attackerPos: { x: number; y: number };
  defenderPos: { x: number; y: number };
}

/** A just-killed unit's last view, rendered as a fading ghost. */
export interface UnitGhost {
  view: UnitView;
  ghostKey: string;
}

/** One executed ability cast, for render-side cast animations (from the
 *  store's AbilityEvent — purely presentational). */
export interface AbilityFx {
  seq: number;
  abilityId: string;
  unitId: number;
  casterPos: { x: number; y: number };
  targets: { x: number; y: number }[];
}

export type HighlightKind = 'move' | 'threat' | 'select' | 'path';

export interface TileHighlight {
  x: number;
  y: number;
  kind: HighlightKind;
}

/**
 * Hand-authored floor texture override point. When absent, procedural textures
 * (value-noise grime/roughness) are generated at startup. Swapping in an authored
 * albedo/roughness/normal set later requires only passing this object.
 */
export interface FloorTextures {
  albedo?: Texture;
  roughness?: Texture;
  normal?: Texture;
}

export interface VoxelArenaProps {
  map: MapData;
  units: UnitView[];
  highlights: TileHighlight[];
  quality?: 'high' | 'low';
  onTileClick?: (x: number, y: number) => void;
  /** Optional fog-of-war grid ([y][x]); hidden tiles render as dark cloud blocks. */
  visibility?: TileVisibility[][];
  floorTextures?: FloorTextures;
  /** Latest attack (drives attacker lunge + defender hit flash). */
  combat?: CombatFx | null;
  /** Latest ability cast (drives cast animations). */
  ability?: AbilityFx | null;
  /** Recently killed units, rendered as fading ghosts. */
  ghosts?: UnitGhost[];
  /** GEN 8 — 3D Tileset mode: GLB tile blocks replace the floor plane and
   *  units with real models render them (see models/modelAssets.ts). */
  tileset?: boolean;
}
