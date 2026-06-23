import {
  TILE_W, TILE_H, ELEVATION,
  MOVE_HIGHLIGHT, ATTACK_HIGHLIGHT, FOG_EXPLORED_OVERLAY,
  LABEL_FONT, LABEL_COLOR, PLAYER_COLORS,
} from './constants.js';
import { tileToScreenShifted } from './projection.js';
import type { GameMap } from '@tactica/engine';

const HW = TILE_W / 2;
const HH = TILE_H / 2;

/**
 * Draw a colored diamond overlay on a tile (for move/attack highlights).
 */
export function drawHighlight(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  terrainId: string,
  color: string,
) {
  const elev = ELEVATION[terrainId] ?? 0;
  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, elev);

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + HW, sy + HH);
  ctx.lineTo(sx, sy + TILE_H);
  ctx.lineTo(sx - HW, sy + HH);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Draw move highlight on a tile.
 */
export function drawMoveHighlight(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  terrainId: string,
) {
  drawHighlight(ctx, tx, ty, mapHeight, terrainId, MOVE_HIGHLIGHT);
}

/**
 * Draw attack highlight on a tile.
 */
export function drawAttackHighlight(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  terrainId: string,
) {
  drawHighlight(ctx, tx, ty, mapHeight, terrainId, ATTACK_HIGHLIGHT);
}

/**
 * Draw explored fog overlay (semi-transparent dark diamond).
 */
export function drawFogExplored(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  terrainId: string,
) {
  drawHighlight(ctx, tx, ty, mapHeight, terrainId, FOG_EXPLORED_OVERLAY);
}

/**
 * Draw damage preview number on a tile.
 */
export function drawDamagePreview(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  terrainId: string,
  damage: number,
) {
  const elev = ELEVATION[terrainId] ?? 0;
  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, elev);
  const cx = sx;
  const cy = sy + HH;

  // Badge background
  const text = `-${damage}`;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(text);
  const pw = metrics.width + 6;
  const ph = 14;

  ctx.fillStyle = 'rgba(239, 83, 80, 0.9)';
  const radius = 3;
  const bx = cx - pw / 2;
  const by = cy + 8;
  ctx.beginPath();
  ctx.moveTo(bx + radius, by);
  ctx.lineTo(bx + pw - radius, by);
  ctx.arcTo(bx + pw, by, bx + pw, by + radius, radius);
  ctx.lineTo(bx + pw, by + ph - radius);
  ctx.arcTo(bx + pw, by + ph, bx + pw - radius, by + ph, radius);
  ctx.lineTo(bx + radius, by + ph);
  ctx.arcTo(bx, by + ph, bx, by + ph - radius, radius);
  ctx.lineTo(bx, by + radius);
  ctx.arcTo(bx, by, bx + radius, by, radius);
  ctx.closePath();
  ctx.fill();

  // Text
  ctx.fillStyle = '#fff';
  ctx.fillText(text, cx, by + ph / 2);
}

/**
 * Draw player territory borders: a single outline tracing only the OUTER edge of
 * each player's owned region, floating slightly above the ground.
 *
 * For every owned tile we look at its four diamond edges and stroke the colored
 * segment only where the neighbor across that edge is NOT owned by the same player
 * (or is off-map). Shared interior edges are skipped, so the result is one clean
 * boundary around each base instead of a box around every tile.
 *
 * Edge → neighbor mapping in this projection (sx=(x−y)·HW, sy=(x+y)·HH):
 *   top→right   ↔ (x,   y−1)
 *   right→bottom ↔ (x+1, y)
 *   bottom→left ↔ (x,   y+1)
 *   left→top    ↔ (x−1, y)
 */
const BORDER_LIFT = 6; // px the border floats above the tile surface

export function drawTerritoryBorders(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  mapHeight: number,
) {
  const ownerAt = (x: number, y: number): number | null => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    return map.tiles[y][x].owner;
  };

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const owner = map.tiles[y][x].owner;
      if (owner === null) continue;

      const color = PLAYER_COLORS[owner] ?? PLAYER_COLORS[0];
      const elev = ELEVATION[map.tiles[y][x].terrain] ?? 0;
      const { sx, sy } = tileToScreenShifted(x, y, mapHeight, elev);

      const top    = { x: sx,      y: sy - BORDER_LIFT };
      const right  = { x: sx + HW, y: sy + HH - BORDER_LIFT };
      const bottom = { x: sx,      y: sy + TILE_H - BORDER_LIFT };
      const left   = { x: sx - HW, y: sy + HH - BORDER_LIFT };

      const seg = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        // Soft shadow under the line for a subtle "raised" feel.
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y + 2);
        ctx.lineTo(b.x, b.y + 2);
        ctx.stroke();
        // Colored border line on top.
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      };

      if (ownerAt(x, y - 1) !== owner) seg(top, right);
      if (ownerAt(x + 1, y) !== owner) seg(right, bottom);
      if (ownerAt(x, y + 1) !== owner) seg(bottom, left);
      if (ownerAt(x - 1, y) !== owner) seg(left, top);
    }
  }
}

/**
 * Draw coordinate label on a tile (for editor mode).
 */
export function drawGridLabel(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  terrainId: string,
) {
  const elev = ELEVATION[terrainId] ?? 0;
  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, elev);

  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`${tx},${ty}`, sx, sy + TILE_H - 4);
}
