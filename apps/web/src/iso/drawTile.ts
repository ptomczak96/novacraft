import {
  TILE_W, TILE_H, BASE_DEPTH,
  ELEVATION, TERRAIN_COLORS, PLAYER_COLORS,
} from './constants.js';
import { tileToScreenShifted } from './projection.js';
import {
  getTileSprite, getResourceIcon, getThemeDrawParams,
  getThemeAutotile, getSpriteByKey, getThemeFlushLiquids,
} from './tileSprites.js';
import type { Tile, DataRegistry } from '@tactica/engine';

const HW = TILE_W / 2;
const HH = TILE_H / 2;

// Recessed terrains: water/lava/river surfaces sit BELOW the land plane so they
// read as sunken pools/basins. Depth ≈ 2/5 of a tile step (TILE_H) down from a
// regular surface tile. The whole tile + its markers shift down together, and
// front-row land tiles occlude the sunken front edge via painter order.
const TERRAIN_SINK: Record<string, number> = {
  water: TILE_H * 0.4,
  lava:  TILE_H * 0.4,
  river: TILE_H * 0.4,
};

// Resource marker icons (default theme): drawn on the tile surface, lifted slightly.
const RESOURCE_ICON_W = 40;
const RESOURCE_ICON_LIFT = 10;

// Themed resource "object" props (transparent prop art planted on the surface):
// a transparent prop scaled to a fraction of the tile width and planted so its
// base-footprint CENTROID sits on the tile-surface centre — so the prop reads as
// centred on the tile, not shoved into its back half.
const RESOURCE_OBJECT_SCALE = 0.434;   // draw width as a fraction of spriteW
const RESOURCE_OBJECT_BASEFRAC = 0.86; // base-footprint centroid as a fraction of art height
const RESOURCE_OBJECT_LIFT = 5;        // extra nudge below the surface centre (px)

// City/base marker scale for the vector drawing (50% larger than the drawing).
const CITY_SCALE = 1.5;

/**
 * Draw a single isometric tile. Uses the terrain sprite when loaded, otherwise
 * falls back to a vector prism. Resource/ruin/city markers draw on top.
 */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  tx: number,
  ty: number,
  mapHeight: number,
  _registry: DataRegistry,
  _cityLevel = 1,
  /** Terrain id at any grid cell (null off-map). Enables shore autotiling. */
  terrainAt?: (x: number, y: number) => string | null,
) {
  const terrainId = tile.terrain;
  // Flat board: every tile renders at one level. Territory ownership is shown by a
  // separate outer-border pass (drawTerritoryBorders), not by raising base tiles.
  const elev = ELEVATION[terrainId] ?? 0;
  const { sx, sy: syGrid } = tileToScreenShifted(tx, ty, mapHeight, elev);

  const hasFeature = tile.isCity || tile.isResourceTile || !!tile.isRuin;

  // Sink recessed terrains (water/lava) below the land plane for a basin effect —
  // unless the theme draws its liquids flush (solid barrier art, e.g. mesa towers).
  const sink = getThemeFlushLiquids() ? 0 : (TERRAIN_SINK[terrainId] ?? 0);
  const sy = syGrid + sink;

  const cx = sx;
  const cy = sy + HH; // center of the top-face diamond (where units/markers sit)

  const dp = getThemeDrawParams();

  // Shore autotiling: for liquid terrains, pick the tile whose baked foam sits on
  // the edges that border LAND (mask = "NE SE SW NW", 1 = land neighbour).
  let selected = getTileSprite(terrainId, tx, ty, hasFeature);
  const auto = getThemeAutotile();
  if (auto && !hasFeature && terrainAt && auto.terrains.includes(terrainId)) {
    const land = (nx: number, ny: number): '0' | '1' => {
      const t = terrainAt(nx, ny);
      return t != null && !auto.terrains.includes(t) ? '1' : '0';
    };
    const mask = land(tx, ty - 1) + land(tx + 1, ty) + land(tx, ty + 1) + land(tx - 1, ty);
    const cands = auto.lookup[mask];
    if (cands && cands.length) {
      const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
      selected = getSpriteByKey(cands[h % cands.length]);
    }
  }
  const { img: sprite, nudge } = selected;
  if (sprite) {
    // ── Sprite tile ──
    // Drawn at the theme's sprite width (independent of grid spacing) so cubes
    // overlap and the board reads tight. topOffsetY places the art's top surface
    // on the tile diamond (+ per-sprite `nudge` for tiles authored slightly off the
    // shared surface plane). The body hangs below and is occluded by front-row
    // tiles via painter order.
    const dw = dp.spriteW;
    // Anisotropic height when the theme sets spriteH (maps the art's top-face
    // diamond onto the grid's 2:1); otherwise preserve the art's natural aspect.
    // Keep dw/dh fractional — rounding drifts the 0.5 edge slope and reopens seams.
    const dh = dp.spriteH ?? dw * (sprite.naturalHeight / sprite.naturalWidth);
    ctx.drawImage(sprite, sx - dw / 2, sy + dp.topOffsetY + nudge, dw, dh);
  } else {
    drawVectorTile(ctx, terrainId, sx, sy, elev, cx, cy);
  }

  // ── Markers (always on top of the base tile) ──
  if (tile.isResourceTile) {
    const kind = tile.resourceKind ?? 'ore';
    const icon = getResourceIcon(kind);
    if (icon && dp.resourceMode === 'object') {
      // Themed prop: scale to the tile and plant its opaque base on the surface
      // centre so it stands upright within the tile.
      const dw = dp.spriteW * RESOURCE_OBJECT_SCALE;
      const dh = dw * (icon.naturalHeight / icon.naturalWidth);
      ctx.drawImage(icon, cx - dw / 2, cy + RESOURCE_OBJECT_LIFT - dh * RESOURCE_OBJECT_BASEFRAC, dw, dh);
    } else if (icon) {
      // Default: small icon centred on the tile.
      const iw = RESOURCE_ICON_W;
      const ih = icon.naturalHeight * (iw / icon.naturalWidth);
      ctx.drawImage(icon, cx - iw / 2, cy - ih / 2 - RESOURCE_ICON_LIFT, iw, ih);
    } else {
      drawCrystal(ctx, cx, cy, kind);
    }
  }
  if (tile.isRuin) {
    drawRuin(ctx, cx, cy);
  }
  if (tile.isCity) {
    const flagColor = tile.owner !== null
      ? (PLAYER_COLORS[tile.owner] ?? '#c44536')
      : '#c44536';
    // Vector castle, scaled up around its base (~cy+6).
    ctx.save();
    ctx.translate(cx, cy + 6);
    ctx.scale(CITY_SCALE, CITY_SCALE);
    drawCity(ctx, 0, -6, flagColor);
    ctx.restore();
  }
}

/** Vector fallback: prism faces + procedural decoration, used before sprites load. */
function drawVectorTile(
  ctx: CanvasRenderingContext2D,
  terrainId: string,
  sx: number,
  sy: number,
  elev: number,
  cx: number,
  cy: number,
) {
  const colors = TERRAIN_COLORS[terrainId] ?? TERRAIN_COLORS.plains;
  const [topColor, leftColor, rightColor] = colors;
  const depth = BASE_DEPTH + Math.max(0, elev);

  const top    = { x: sx,      y: sy };
  const right  = { x: sx + HW, y: sy + HH };
  const bottom = { x: sx,      y: sy + TILE_H };
  const left   = { x: sx - HW, y: sy + HH };

  // Left side face
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(bottom.x, bottom.y + depth);
  ctx.lineTo(left.x, left.y + depth);
  ctx.closePath();
  ctx.fillStyle = leftColor;
  ctx.fill();

  // Right side face
  ctx.beginPath();
  ctx.moveTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(bottom.x, bottom.y + depth);
  ctx.lineTo(right.x, right.y + depth);
  ctx.closePath();
  ctx.fillStyle = rightColor;
  ctx.fill();

  // Top diamond face
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();

  // Thin edge outline
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.stroke();

  if (terrainId === 'forest') drawTrees(ctx, cx, cy);
  else if (terrainId === 'mountain') drawMountain(ctx, cx, cy);
  else if (terrainId === 'water') drawWater(ctx, cx, cy);
  else if (terrainId === 'river') drawRiver(ctx, cx, cy);
}

/** A small ruin marker (foundable city site). */
function drawRuin(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.fillStyle = '#9a8f7a';
  ctx.strokeStyle = '#5a5145';
  ctx.lineWidth = 2;
  // Three broken pillars of varying height — large, still within one tile.
  const w = 9;
  const baseY = cy + 6; // plant the feet a touch below tile centre
  const pillars = [
    { x: cx - 17, h: 26 },
    { x: cx,      h: 36 },
    { x: cx + 17, h: 22 },
  ];
  for (const pl of pillars) {
    ctx.fillRect(pl.x - w / 2, baseY - pl.h, w, pl.h);
    ctx.strokeRect(pl.x - w / 2, baseY - pl.h, w, pl.h);
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

function drawCrystal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  kind: 'ore' | 'plasma',
) {
  // Ore = amber, plasma = teal/blue. Sits centered on the tile surface.
  const fill = kind === 'plasma' ? '#4fc3f7' : '#f4a261';
  const stroke = kind === 'plasma' ? '#2a6a8a' : '#b5702f';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx + 5, cy - 2);
  ctx.lineTo(cx + 3, cy + 5);
  ctx.lineTo(cx - 3, cy + 5);
  ctx.lineTo(cx - 5, cy - 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
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
