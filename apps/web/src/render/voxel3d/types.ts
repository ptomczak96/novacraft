import type { Texture } from 'three';
import type { GameMap, TileVisibility } from '@tactica/engine';

/**
 * The voxel3d renderer is a self-contained presentation module. It consumes the
 * engine's mapgen output READ-ONLY and shares no mechanisms with the 2D iso
 * renderer — all constants, palettes and helpers live inside this directory.
 */
export type MapData = GameMap;

/** Render-side facing, derived from move deltas in the adapter (never engine state). */
export type Facing = 'ne' | 'nw' | 'se' | 'sw';

export interface UnitView {
  id: number;
  gridPos: { x: number; y: number };
  facing: Facing;
  teamColor: string;
  kind: string;
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
}
