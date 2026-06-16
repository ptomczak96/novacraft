import { TILE_W, TILE_H, CANVAS_PAD, ELEVATION } from './constants.js';
import type { GameMap } from '@tactica/engine';

/**
 * Convert tile grid coords to screen (canvas pixel) coords.
 * Returns the center-top of the top diamond face.
 */
export function tileToScreen(
  tx: number,
  ty: number,
  elevation: number = 0,
): { sx: number; sy: number } {
  const sx = CANVAS_PAD + (tx - ty) * (TILE_W / 2) ;
  const sy = CANVAS_PAD + (tx + ty) * (TILE_H / 2) - elevation;
  return { sx, sy };
}

/**
 * Compute the pixel offset needed so that tile (0,0) starts with sx >= CANVAS_PAD.
 * Because tileToScreen with ty > 0 produces negative sx, we shift everything right
 * by the maximum negative offset (which comes from tile (0, maxY)).
 */
export function computeOriginShift(mapHeight: number): number {
  // tile (0, mapHeight-1) has sx = CANVAS_PAD + (0 - (mapHeight-1)) * TILE_W/2
  // We want that sx >= CANVAS_PAD, so shift = (mapHeight-1) * TILE_W/2
  return (mapHeight - 1) * (TILE_W / 2);
}

/**
 * tileToScreen with the horizontal shift applied so the whole map fits.
 */
export function tileToScreenShifted(
  tx: number,
  ty: number,
  mapHeight: number,
  elevation: number = 0,
): { sx: number; sy: number } {
  const shift = computeOriginShift(mapHeight);
  const sx = CANVAS_PAD + shift + (tx - ty) * (TILE_W / 2);
  const sy = CANVAS_PAD + (tx + ty) * (TILE_H / 2) - elevation;
  return { sx, sy };
}

/**
 * Total canvas dimensions for a given map size.
 */
export function canvasSize(
  mapWidth: number,
  mapHeight: number,
): { width: number; height: number } {
  // The isometric map spans:
  //   horizontal: from tile(0, maxY) to tile(maxX, 0) → range = (maxX + maxY) * TILE_W/2
  //   vertical:   from tile(0,0) to tile(maxX, maxY) → range = (maxX + maxY) * TILE_H/2
  // Plus extra for the base depth of the lowest tiles and padding.
  const maxElev = 24; // mountain elevation
  const maxDepth = 16 + 8; // BASE_DEPTH + water sunken below
  const w = (mapWidth + mapHeight - 1) * (TILE_W / 2) + TILE_W + CANVAS_PAD * 2;
  const h = (mapWidth + mapHeight - 1) * (TILE_H / 2) + TILE_H + maxDepth + maxElev + CANVAS_PAD * 2;
  return { width: w, height: h };
}

/**
 * Test whether a point is inside a diamond (rhombus) centered at (cx, cy)
 * with half-widths hw (horizontal) and hh (vertical).
 */
function pointInDiamond(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): boolean {
  const dx = Math.abs(px - cx);
  const dy = Math.abs(py - cy);
  return (dx / hw + dy / hh) <= 1;
}

/**
 * Convert screen (canvas pixel) coords back to tile grid coords.
 * Tests each tile's diamond in reverse painter order for correct hit detection
 * (front tiles occlude back tiles).
 */
export function screenToTile(
  mx: number,
  my: number,
  map: GameMap,
): { x: number; y: number } | null {
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;

  // Iterate in reverse painter order (back-to-front → check front first)
  for (let y = map.height - 1; y >= 0; y--) {
    for (let x = map.width - 1; x >= 0; x--) {
      const terrain = map.tiles[y][x].terrain;
      const elev = ELEVATION[terrain] ?? 0;
      const { sx, sy } = tileToScreenShifted(x, y, map.height, elev);

      // The top-face diamond center is at (sx, sy + hh)
      const cx = sx;
      const cy = sy + hh;

      if (pointInDiamond(mx, my, cx, cy, hw, hh)) {
        return { x, y };
      }
    }
  }

  return null;
}
