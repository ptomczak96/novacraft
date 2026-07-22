import {
  TILE_W, TILE_H, ELEVATION,
  MOVE_HIGHLIGHT, ATTACK_HIGHLIGHT, FOG_EXPLORED_OVERLAY,
  LABEL_FONT, LABEL_COLOR, PLAYER_COLORS,
} from './constants.js';
import { tileToScreenShifted } from './projection.js';
import { colLetter } from '../data/notation.js';
import type { GameMap, CityState, TileVisibility } from '@tactica/engine';

const HW = TILE_W / 2;
const HH = TILE_H / 2;

// Blinking marker dots above a unit: blue = Tracer Round, red = Plant Explosives.
// `on` toggles the blink (driven by a ~1s timer in the caller).
export function drawMarkDots(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  kinds: ('tracer' | 'explosive')[],
  on: boolean,
) {
  if (!on || kinds.length === 0) return;
  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, 0);
  const cx = sx;
  const topY = sy - 10; // above the tile's top vertex (over the unit's head)
  kinds.forEach((kind, i) => {
    const x = cx + (i - (kinds.length - 1) / 2) * 11;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, topY, 4, 0, Math.PI * 2);
    ctx.fillStyle = kind === 'tracer' ? '#3aa0ff' : '#ff3a3a';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
  });
}

// A Node marker: a diamond/gem at the centre of its tile. `building` = under construction
// (translucent, dashed outline); complete = solid.
export function drawNode(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  color: string,
  building: boolean,
) {
  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, 0);
  const cx = sx;
  const cy = sy + HH - 8; // tile centre, raised a touch so it reads as a standing marker
  const w = HW * 0.62;
  const h = TILE_H * 0.62;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
  ctx.globalAlpha = building ? 0.4 : 0.85;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  if (building) ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Chess-style axis rulers: column letters (A, B, C…) along the top & bottom edges, row
 * numbers (1, 2, 3…) down the left & right edges — drawn just outside the diamond grid.
 */
export function drawAxisLabels(ctx: CanvasRenderingContext2D, map: GameMap) {
  const H = map.height, W = map.width;
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.fillStyle = 'rgba(220, 230, 245, 0.75)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const put = (tx: number, ty: number, text: string) => {
    const { sx, sy } = tileToScreenShifted(tx, ty, H, 0);
    ctx.fillText(text, sx + HW, sy + HH);
  };
  for (let x = 0; x < W; x++) { put(x, -1, colLetter(x)); put(x, H, colLetter(x)); }   // top & bottom
  for (let y = 0; y < H; y++) { put(-1, y, String(y + 1)); put(W, y, String(y + 1)); }  // left & right
  ctx.restore();
}

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

/** Strokes a diamond outline around a tile — used to mark the inspected tile. */
export function drawTileOutline(
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
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/**
 * Cloud (undiscovered / 'hidden') tile: a flat white diamond hiding everything.
 * A faint grey outline traces the diamond so individual cloud tiles read as a grid
 * rather than one blank white expanse.
 * Placeholder — Patrick to replace with a painted cloud tile sprite (see overlap.md).
 */
export function drawCloud(ctx: CanvasRenderingContext2D, tx: number, ty: number, mapHeight: number) {
  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, 0);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + HW, sy + HH);
  ctx.lineTo(sx, sy + TILE_H);
  ctx.lineTo(sx - HW, sy + HH);
  ctx.closePath();
  ctx.fillStyle = '#eef1f5';
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,150,165,0.35)'; // faint grey grid line
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * Territory-expansion picker overlay: faint green diamonds on eligible tiles and
 * a solid green diamond + check-mark on each ticked tile.
 */
const PICKER_PALETTES = {
  territory: { eligible: 'rgba(64, 220, 120, 0.28)', fill: 'rgba(48, 200, 100, 0.5)', stroke: 'rgba(40, 255, 120, 0.95)' },
  attack: { eligible: 'rgba(230, 90, 60, 0.28)', fill: 'rgba(220, 70, 50, 0.5)', stroke: 'rgba(255, 110, 80, 0.95)' },
} as const;

export function drawTerritoryPicker(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  mapHeight: number,
  eligible: { x: number; y: number }[],
  picks: { x: number; y: number }[],
  palette: keyof typeof PICKER_PALETTES = 'territory',
) {
  const pal = PICKER_PALETTES[palette];
  for (const t of eligible) {
    const terrain = map.tiles[t.y]?.[t.x]?.terrain ?? 'plains';
    drawHighlight(ctx, t.x, t.y, mapHeight, terrain, pal.eligible);
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
    ctx.fillStyle = pal.fill;
    ctx.fill();
    ctx.strokeStyle = pal.stroke;
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

/** Purple tint for an "infected" (Spray Bile) tile. */
export function drawBileOverlay(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  terrainId: string,
) {
  drawHighlight(ctx, tx, ty, mapHeight, terrainId, 'rgba(150, 60, 200, 0.30)');
}

/** Faint red overlay for a tile within the selected unit's hypothetical attack/influence range. */
export function drawAttackRangeHighlight(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  terrainId: string,
) {
  drawHighlight(ctx, tx, ty, mapHeight, terrainId, 'rgba(230, 70, 70, 0.16)');
}

/** Enemy Area-of-Influence (zone of control) tile: a faint amber tint + dashed border,
 *  distinct from move (green) and attack-range (red) so players read it as "entering
 *  here stops your move". */
export function drawAOIHighlight(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  terrainId: string,
) {
  const elev = ELEVATION[terrainId] ?? 0;
  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, elev);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + HW, sy + HH);
  ctx.lineTo(sx, sy + TILE_H);
  ctx.lineTo(sx - HW, sy + HH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(240, 170, 40, 0.12)';
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(245, 180, 60, 0.55)';
  ctx.stroke();
  ctx.restore();
}

/** Small crossed-swords marker above a tile — an enemy here can be attacked. */
export function drawCrossedSwords(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  terrainId: string,
) {
  const elev = ELEVATION[terrainId] ?? 0;
  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, elev);
  const cx = sx;
  const cy = sy + HH - 24; // float above the unit
  const r = 6;
  // Two crossed blades (X), each with a small pommel dot.
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = 'rgba(20,24,40,0.9)'; // dark outline pass
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
    ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#e8e8ee'; // bright blades
  }
  ctx.fillStyle = '#c9a24a';
  for (const [dx, dy] of [[-r, r], [r, r]]) { ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 1.4, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

/** Highlight for a valid ability-cast target tile (purple — distinct from attack red). */
export function drawAbilityHighlight(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  terrainId: string,
) {
  drawHighlight(ctx, tx, ty, mapHeight, terrainId, 'rgba(190, 100, 240, 0.42)');
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
  lethal: boolean = false, // append a skull if this damage would kill the unit
) {
  const elev = ELEVATION[terrainId] ?? 0;
  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, elev);
  const cx = sx;
  const cy = sy + HH;

  // Badge background
  const text = lethal ? `-${damage} 💀` : `-${damage}`;
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
  visibility?: (TileVisibility | undefined)[][] | null,
) {
  const cheb = (ax: number, ay: number, bx: number, by: number) =>
    Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  // A tile's "region" = the city whose territory contains it (base 3x3 OR a claimed
  // extra tile), so two adjacent cities (even same player) get a line between them.
  // Hidden (cloud) tiles have no region → enemy borders don't leak through fog.
  const regionAt = (x: number, y: number): string | null => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    if (visibility && visibility[y]?.[x] === 'hidden') return null;
    const owner = map.tiles[y][x].owner;
    if (owner === null) return null;
    for (const c of cities) {
      if (cheb(c.position.x, c.position.y, x, y) <= 1) return `c${c.id}`;
      if ((c.extraTerritory ?? []).some(t => t.x === x && t.y === y)) return `c${c.id}`;
    }
    return `o${owner}`;
  };

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const owner = map.tiles[y][x].owner;
      if (owner === null) continue;
      if (visibility && visibility[y]?.[x] === 'hidden') continue; // no borders under cloud

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
