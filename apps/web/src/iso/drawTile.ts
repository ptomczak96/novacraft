import {
  TILE_W, TILE_H, BASE_DEPTH,
  ELEVATION, TERRAIN_COLORS, PLAYER_COLORS,
} from './constants.js';
import { tileToScreenShifted } from './projection.js';
import type { Tile, DataRegistry } from '@tactica/engine';

const HW = TILE_W / 2;
const HH = TILE_H / 2;

/**
 * Draw a single isometric tile prism: left face, right face, top diamond, then decorations.
 */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  tx: number,
  ty: number,
  mapHeight: number,
  _registry: DataRegistry,
) {
  const terrainId = tile.terrain;
  const perimeterElev = tile.isPerimeter ? 4 : 0;
  const elev = (ELEVATION[terrainId] ?? 0) + perimeterElev;
  const colors = TERRAIN_COLORS[terrainId] ?? TERRAIN_COLORS.plains;
  const [topColor, leftColor, rightColor] = colors;

  const depth = BASE_DEPTH + Math.max(0, elev); // taller prism for elevated terrain

  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, elev);

  // ── Diamond vertices (top face) ──
  // Top, Right, Bottom, Left of diamond centered at (sx, sy + HH)
  const top    = { x: sx,      y: sy };
  const right  = { x: sx + HW, y: sy + HH };
  const bottom = { x: sx,      y: sy + TILE_H };
  const left   = { x: sx - HW, y: sy + HH };

  // ── Left side face ──
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(bottom.x, bottom.y + depth);
  ctx.lineTo(left.x, left.y + depth);
  ctx.closePath();
  ctx.fillStyle = leftColor;
  ctx.fill();

  // ── Right side face ──
  ctx.beginPath();
  ctx.moveTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(bottom.x, bottom.y + depth);
  ctx.lineTo(right.x, right.y + depth);
  ctx.closePath();
  ctx.fillStyle = rightColor;
  ctx.fill();

  // ── Top diamond face ──
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();

  // ── Thin edge outline ──
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 0.5;
  // Top diamond outline
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.stroke();

  // ── Owner indicator (only on perimeter tiles) ──
  if (tile.isPerimeter && tile.owner !== null) {
    const ownerColor = PLAYER_COLORS[tile.owner] ?? PLAYER_COLORS[0];
    ctx.strokeStyle = ownerColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  }

  // ── Terrain decorations ──
  const cx = sx;
  const cy = sy + HH; // center of diamond

  if (terrainId === 'forest') {
    drawTrees(ctx, cx, cy);
  } else if (terrainId === 'mountain') {
    drawMountain(ctx, cx, cy);
  } else if (terrainId === 'water') {
    drawWater(ctx, cx, cy);
  } else if (terrainId === 'river') {
    drawRiver(ctx, cx, cy);
  } else if (terrainId === 'resource') {
    drawCrystal(ctx, cx, cy);
  }

  // ── City marker ──
  if (tile.isCity) {
    const flagColor = tile.owner !== null
      ? (PLAYER_COLORS[tile.owner] ?? '#c44536')
      : '#c44536';
    drawCity(ctx, cx, cy, flagColor);
  }
}

// ── Decoration helpers ──

function drawTrees(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  // 2-3 small triangular trees
  const positions = [
    { x: cx - 6, y: cy - 2 },
    { x: cx + 5, y: cy + 1 },
    { x: cx - 1, y: cy - 6 },
  ];
  for (const p of positions) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 8);
    ctx.lineTo(p.x - 4, p.y + 2);
    ctx.lineTo(p.x + 4, p.y + 2);
    ctx.closePath();
    ctx.fillStyle = '#1b4332';
    ctx.fill();
    // Trunk
    ctx.fillStyle = '#5a3e28';
    ctx.fillRect(p.x - 1, p.y + 2, 2, 3);
  }
}

function drawMountain(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  // Polytopia-style low-poly mountains: chunky faceted peaks filling the tile

  // ── Small back-left peak ──
  ctx.beginPath();
  ctx.moveTo(cx - 16, cy + 8);
  ctx.lineTo(cx - 10, cy - 10);
  ctx.lineTo(cx - 4, cy + 8);
  ctx.closePath();
  ctx.fillStyle = '#5a6375';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy + 8);
  ctx.lineTo(cx - 10, cy - 10);
  ctx.lineTo(cx + 2, cy + 8);
  ctx.closePath();
  ctx.fillStyle = '#7d8a9c';
  ctx.fill();

  // ── Small back-right peak ──
  ctx.beginPath();
  ctx.moveTo(cx + 4, cy + 8);
  ctx.lineTo(cx + 11, cy - 8);
  ctx.lineTo(cx + 8, cy + 8);
  ctx.closePath();
  ctx.fillStyle = '#5a6375';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 8, cy + 8);
  ctx.lineTo(cx + 11, cy - 8);
  ctx.lineTo(cx + 18, cy + 8);
  ctx.closePath();
  ctx.fillStyle = '#7d8a9c';
  ctx.fill();

  // ── Main center peak (tallest) ──
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy + 10);
  ctx.lineTo(cx - 1, cy - 24);
  ctx.lineTo(cx, cy + 10);
  ctx.closePath();
  ctx.fillStyle = '#606b7d';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy + 10);
  ctx.lineTo(cx - 1, cy - 24);
  ctx.lineTo(cx + 15, cy + 10);
  ctx.closePath();
  ctx.fillStyle = '#8d99ae';
  ctx.fill();

  // ── Snow cap (main peak) ──
  ctx.beginPath();
  ctx.moveTo(cx - 1, cy - 24);
  ctx.lineTo(cx - 6, cy - 14);
  ctx.lineTo(cx - 1, cy - 12);
  ctx.closePath();
  ctx.fillStyle = '#c8cdd5';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 1, cy - 24);
  ctx.lineTo(cx - 1, cy - 12);
  ctx.lineTo(cx + 5, cy - 14);
  ctx.closePath();
  ctx.fillStyle = '#eef0f4';
  ctx.fill();

  // ── Snow cap (right peak) ──
  ctx.beginPath();
  ctx.moveTo(cx + 11, cy - 8);
  ctx.lineTo(cx + 8, cy - 3);
  ctx.lineTo(cx + 14, cy - 3);
  ctx.closePath();
  ctx.fillStyle = '#dde0e6';
  ctx.fill();
}

function drawWater(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  // Wavy lines
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  for (let i = -1; i <= 1; i++) {
    const wy = cy + i * 5;
    ctx.beginPath();
    ctx.moveTo(cx - 10, wy);
    ctx.quadraticCurveTo(cx - 5, wy - 3, cx, wy);
    ctx.quadraticCurveTo(cx + 5, wy + 3, cx + 10, wy);
    ctx.stroke();
  }
}

function drawRiver(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  // Single wavy line
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy);
  ctx.quadraticCurveTo(cx - 4, cy - 4, cx, cy);
  ctx.quadraticCurveTo(cx + 4, cy + 4, cx + 12, cy);
  ctx.stroke();
}

function drawCrystal(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  // Teal crystal shape
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx + 5, cy - 2);
  ctx.lineTo(cx + 3, cy + 5);
  ctx.lineTo(cx - 3, cy + 5);
  ctx.lineTo(cx - 5, cy - 2);
  ctx.closePath();
  ctx.fillStyle = '#4fc3f7';
  ctx.fill();
  ctx.strokeStyle = '#2a6a8a';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Sparkle
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(cx - 1, cy - 5, 2, 2);
}

function drawCity(ctx: CanvasRenderingContext2D, cx: number, cy: number, flagColor: string) {
  // Polytopia-style base/capital — walls, central tower, and flag

  // ── Outer wall base (wide trapezoid) ──
  ctx.fillStyle = '#b8a88a';
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy + 6);
  ctx.lineTo(cx - 12, cy - 4);
  ctx.lineTo(cx + 12, cy - 4);
  ctx.lineTo(cx + 14, cy + 6);
  ctx.closePath();
  ctx.fill();

  // Wall top edge highlight
  ctx.fillStyle = '#d4c5a0';
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy - 4);
  ctx.lineTo(cx - 11, cy - 6);
  ctx.lineTo(cx + 11, cy - 6);
  ctx.lineTo(cx + 12, cy - 4);
  ctx.closePath();
  ctx.fill();

  // ── Battlements (crenellations) ──
  ctx.fillStyle = '#c4b594';
  for (let i = -10; i <= 8; i += 6) {
    ctx.fillRect(cx + i, cy - 9, 4, 3);
  }

  // ── Central tower ──
  ctx.fillStyle = '#a89878';
  ctx.fillRect(cx - 5, cy - 18, 10, 14);

  // Tower top cap
  ctx.fillStyle = '#c4b594';
  ctx.fillRect(cx - 6, cy - 20, 12, 3);

  // Tower window
  ctx.fillStyle = '#ffd700';
  ctx.fillRect(cx - 2, cy - 14, 4, 4);

  // ── Flag pole ──
  ctx.strokeStyle = '#5a4a3a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 20);
  ctx.lineTo(cx, cy - 30);
  ctx.stroke();

  // ── Flag / banner (player-colored) ──
  ctx.fillStyle = flagColor;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 30);
  ctx.lineTo(cx + 8, cy - 27);
  ctx.lineTo(cx, cy - 24);
  ctx.closePath();
  ctx.fill();

  // ── Side turrets ──
  // Left turret
  ctx.fillStyle = '#a89878';
  ctx.fillRect(cx - 13, cy - 10, 5, 6);
  ctx.fillStyle = '#c4b594';
  ctx.fillRect(cx - 14, cy - 12, 7, 2);

  // Right turret
  ctx.fillStyle = '#a89878';
  ctx.fillRect(cx + 8, cy - 10, 5, 6);
  ctx.fillStyle = '#c4b594';
  ctx.fillRect(cx + 7, cy - 12, 7, 2);

  // ── Gate arch ──
  ctx.fillStyle = '#5a4a3a';
  ctx.beginPath();
  ctx.arc(cx, cy + 1, 4, Math.PI, 0);
  ctx.lineTo(cx + 4, cy + 6);
  ctx.lineTo(cx - 4, cy + 6);
  ctx.closePath();
  ctx.fill();
}
