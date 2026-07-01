import { TILE_H, TILE_W } from './constants.js';
import { tileToScreenShifted } from './projection.js';
import type { BuildingState, ResourceKind } from '@tactica/engine';

const HH = TILE_H / 2;
const HW = TILE_W / 2;

export interface ScreenRect { x: number; y: number; w: number; h: number; }

function tileCentre(tx: number, ty: number, mapHeight: number): { cx: number; cy: number; topY: number } {
  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, 0);
  return { cx: sx, cy: sy + HH, topY: sy };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const BUILDING_LABEL: Record<string, string> = {
  mine: 'mine', extractor: 'extractor', refinery: 'refinery', purifier: 'purifier',
};

// REB2s render as an emoji symbol instead of a word: a factory for the refinery and
// a plumbing / heavy-industrial glyph for the purifier.
const BUILDING_ICON: Record<string, string> = {
  refinery: '🏭',
  purifier: '🚰',
};

/** A building drawn as a symbol/label with N stacked horizontal lines above it for level. */
export function drawBuildingLabel(ctx: CanvasRenderingContext2D, building: BuildingState, mapHeight: number) {
  const { cx, cy } = tileCentre(building.position.x, building.position.y, mapHeight);
  const icon = BUILDING_ICON[building.kind];
  const text = icon ?? BUILDING_LABEL[building.kind] ?? building.kind;
  const fontSize = icon ? 18 : 11;
  const halfH = icon ? 11 : 7;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;

  ctx.fillStyle = 'rgba(18,18,28,0.82)';
  roundRect(ctx, cx - tw / 2 - 4, cy - halfH, tw + 8, halfH * 2, 3);
  ctx.fill();

  ctx.fillStyle = icon ? '#ffffff' : '#ffd966';
  ctx.fillText(text, cx, cy);

  // Level denotation: 1 line for L1, 2 for L2, 3 for L3 — same width as the symbol.
  ctx.strokeStyle = '#ffd966';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < building.level; i++) {
    const ly = cy - halfH - 4 - i * 3;
    ctx.beginPath();
    ctx.moveTo(cx - tw / 2, ly);
    ctx.lineTo(cx + tw / 2, ly);
    ctx.stroke();
  }
}

/** A resource vent label (e.g. "plasma") sitting within the tile. */
export function drawResourceLabel(ctx: CanvasRenderingContext2D, tx: number, ty: number, mapHeight: number, kind: ResourceKind) {
  const { cx, cy } = tileCentre(tx, ty, mapHeight);
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(kind).width;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, cx - tw / 2 - 3, cy - 6, tw + 6, 13, 3);
  ctx.fill();
  ctx.fillStyle = kind === 'plasma' ? '#b3a4ff' : '#f4a261';
  ctx.fillText(kind, cx, cy);
}

/**
 * Small red ✕ toward the bottom-right of a tile — marks a REB whose output is
 * currently blocked by an enemy unit standing on it. Drawn on the bottom-right
 * face so it doesn't collide with the building label (which sits at tile centre).
 */
export function drawBlockedMark(ctx: CanvasRenderingContext2D, tx: number, ty: number, mapHeight: number) {
  const { sx, sy } = tileToScreenShifted(tx, ty, mapHeight, 0);
  // Midpoint of the bottom-right edge (right vertex → bottom vertex).
  const mx = sx + HW / 2;
  const my = sy + HH + HH / 2;
  const r = 5;
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(mx - r, my - r);
  ctx.lineTo(mx + r, my + r);
  ctx.moveTo(mx + r, my - r);
  ctx.lineTo(mx - r, my + r);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** A clickable action box above a tile. Returns its on-screen rect for hit-testing. */
export function drawActionBox(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  mapHeight: number,
  label: string,
  sublabel?: string,     // e.g. a build cost "50◈" shown on a second line
  unaffordable?: boolean, // dim the box + show the cost in red (valid site, can't afford)
): ScreenRect {
  const { cx, topY } = tileCentre(tx, ty, mapHeight);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 11px sans-serif';
  const labelW = ctx.measureText(label).width;
  let subW = 0;
  if (sublabel) {
    ctx.font = '10px sans-serif';
    subW = ctx.measureText(sublabel).width;
  }
  const w = Math.max(labelW, subW) + 16;
  const h = sublabel ? 32 : 19;
  const x = cx - w / 2;
  const y = topY - h - 6;

  ctx.fillStyle = unaffordable ? 'rgba(70,74,88,0.94)' : 'rgba(46,98,170,0.96)';
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = unaffordable ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = unaffordable ? '#d8d8d8' : '#fff';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText(label, cx, sublabel ? y + 11 : y + h / 2);
  if (sublabel) {
    ctx.font = '10px sans-serif';
    ctx.fillStyle = unaffordable ? '#ff6b60' : '#ffe08a'; // red = can't afford, gold = ok
    ctx.fillText(sublabel, cx, y + 23);
  }
  return { x, y, w, h };
}

/** Hover tooltip: a name badge floating above a tile. */
export function drawNameBadge(ctx: CanvasRenderingContext2D, tx: number, ty: number, mapHeight: number, name: string) {
  const { cx, topY } = tileCentre(tx, ty, mapHeight);
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(name).width + 12;
  const h = 17;
  const x = cx - w / 2;
  const y = topY - h - 26; // sit above the action-box zone
  ctx.fillStyle = 'rgba(10,10,20,0.9)';
  roundRect(ctx, x, y, w, h, 3);
  ctx.fill();
  ctx.fillStyle = '#eee';
  ctx.fillText(name, cx, y + h / 2);
}

export function pointInRect(mx: number, my: number, r: ScreenRect): boolean {
  return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
}
