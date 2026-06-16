import {
  TILE_W, TILE_H, ELEVATION,
  MOVE_HIGHLIGHT, ATTACK_HIGHLIGHT, FOG_EXPLORED_OVERLAY,
  LABEL_FONT, LABEL_COLOR,
} from './constants.js';
import { tileToScreenShifted } from './projection.js';

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
