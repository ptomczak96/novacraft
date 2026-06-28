import {
  TILE_W, TILE_H, ELEVATION,
  MOVE_HIGHLIGHT, ATTACK_HIGHLIGHT, FOG_EXPLORED_OVERLAY,
  LABEL_FONT, LABEL_COLOR, PLAYER_COLORS,
} from './constants.js';
import { tileToScreenShifted } from './projection.js';
import type { GameMap, CityState } from '@tactica/engine';

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
 * Territory-expansion picker overlay: faint green diamonds on eligible tiles and
 * a solid green diamond + check-mark on each ticked tile.
 */
export function drawTerritoryPicker(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  mapHeight: number,
  eligible: { x: number; y: number }[],
  picks: { x: number; y: number }[],
) {
  for (const t of eligible) {
    const terrain = map.tiles[t.y]?.[t.x]?.terrain ?? 'plains';
    drawHighlight(ctx, t.x, t.y, mapHeight, terrain, 'rgba(64, 220, 120, 0.28)');
  }
  for (const t of picks) {
    const elev = ELEVATION[map.tiles[t.y]?.[t.x]?.terrain ?? 'plains'] ?? 0;
    const { sx, sy } = tileToScreenShifted(t.x, t.y, mapHeight, elev);
    // Solid diamond
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + HW, sy + HH);
    ctx.lineTo(sx, sy + TILE_H);
    ctx.lineTo(sx - HW, sy + HH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(48, 200, 100, 0.5)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 255, 120, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Check mark
    const cy = sy + HH;
    ctx.strokeStyle = '#eafff0';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx - 9, cy);
    ctx.lineTo(sx - 2, cy + 7);
    ctx.lineTo(sx + 11, cy - 8);
    ctx.stroke();
  }
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
  cities: CityState[] = [],
) {
  const cheb = (ax: number, ay: number, bx: number, by: number) =>
    Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  // A tile's "region" = the city whose 3x3 territory contains it, so two adjacent
  // cities (even of the same player) get a line between them instead of fusing.
  // Falls back to the owner for any owned tile not inside a city.
  const regionAt = (x: number, y: number): string | null => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    const owner = map.tiles[y][x].owner;
    if (owner === null) return null;
    for (const c of cities) {
      if (cheb(c.position.x, c.position.y, x, y) <= 1) return `c${c.id}`;
    }
    return `o${owner}`;
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

      const region = regionAt(x, y);
      if (regionAt(x, y - 1) !== region) seg(top, right);
      if (regionAt(x + 1, y) !== region) seg(right, bottom);
      if (regionAt(x, y + 1) !== region) seg(bottom, left);
      if (regionAt(x - 1, y) !== region) seg(left, top);
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
