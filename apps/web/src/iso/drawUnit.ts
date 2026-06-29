import {
  TILE_H, PLAYER_COLORS,
  HP_HIGH, HP_MID, HP_LOW, SELECTION_COLOR,
} from './constants.js';
import { tileToScreenShifted } from './projection.js';
import type { Unit, DataRegistry } from '@tactica/engine';

// ── Color helpers ──

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) + (Math.min(255, Math.max(0, r)) << 16) +
    (Math.min(255, Math.max(0, g)) << 8) + Math.min(255, Math.max(0, b)))
    .toString(16).slice(1);
}

/** Darken or lighten a hex color. factor < 1 darkens, > 1 lightens. */
function shade(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(
    Math.round(r * factor),
    Math.round(g * factor),
    Math.round(b * factor),
  );
}

// ── Outline helper ──
const OUTLINE = '#1a1a2e';
const SKIN = '#f5d6b8';
const SKIN_SHADOW = '#d4a574';
const METAL_LIGHT = '#c8cdd5';
const METAL_MID = '#8d99ae';
const METAL_DARK = '#5a6375';
const WOOD = '#8b6914';
const WOOD_DARK = '#5a3e0a';
const WOOD_LIGHT = '#b8922e';

function outlined(
  ctx: CanvasRenderingContext2D,
  fill: string,
  drawFn: () => void,
  lineWidth = 1,
) {
  ctx.beginPath();
  drawFn();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function filled(ctx: CanvasRenderingContext2D, fill: string, drawFn: () => void) {
  ctx.beginPath();
  drawFn();
  ctx.fillStyle = fill;
  ctx.fill();
}

// ── Unit size constants ──
const UNIT_H = 22; // total figure height
const FOOT_Y = 6;  // feet offset below center (standing on tile)
const UNIT_SCALE = 1.5; // figures drawn 50% larger

/**
 * Draw a unit on its tile (no elevation info).
 */
export function drawUnit(
  ctx: CanvasRenderingContext2D,
  unit: Unit,
  mapHeight: number,
  registry: DataRegistry,
  isSelected: boolean,
) {
  drawUnitAt(ctx, unit, mapHeight, 0, registry, isSelected);
}

/**
 * Draw unit at tile position with known elevation.
 */
export function drawUnitAt(
  ctx: CanvasRenderingContext2D,
  unit: Unit,
  mapHeight: number,
  elevation: number,
  registry: DataRegistry,
  isSelected: boolean,
  posOverride?: { x: number; y: number },
) {
  // posOverride allows fractional tile coords for smooth move animations.
  const px = posOverride ? posOverride.x : unit.position.x;
  const py = posOverride ? posOverride.y : unit.position.y;
  const { sx, sy } = tileToScreenShifted(px, py, mapHeight, elevation);
  const cx = sx;
  const cy = sy + TILE_H / 2; // center of diamond

  const color = PLAYER_COLORS[unit.owner] ?? PLAYER_COLORS[0];
  const dark = shade(color, 0.65);
  const light = shade(color, 1.25);

  // ── Shadow ellipse on ground ──
  ctx.beginPath();
  ctx.ellipse(cx, cy + FOOT_Y + 1, 8, 3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();

  // ── Selection ring ──
  if (isSelected) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + FOOT_Y + 1, 12, 5, 0, 0, Math.PI * 2);
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ── Draw figure by type (scaled up around the feet so it stays planted) ──
  const drawFn = UNIT_DRAWERS[unit.typeId] ?? drawGenericUnit;
  ctx.save();
  ctx.translate(cx, cy + FOOT_Y);
  ctx.scale(UNIT_SCALE, UNIT_SCALE);
  drawFn(ctx, 0, -FOOT_Y, color, dark, light);
  ctx.restore();

  // ── HP bar ──
  const unitType = registry.unitTypes[unit.typeId];
  if (unitType) {
    const hpFrac = unit.hp / unitType.maxHP;
    const barW = 18;
    const barH = 3;
    const barX = cx - barW / 2;
    const barY = cy + FOOT_Y + 5;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpFrac > 0.6 ? HP_HIGH : hpFrac > 0.3 ? HP_MID : HP_LOW;
    ctx.fillRect(barX, barY, barW * hpFrac, barH);
  }
}

// ── Type-specific figure renderers ──
// All draw relative to (cx, cy) where cy is the diamond center.
// Feet at cy + FOOT_Y, head at approximately cy - 16.

type UnitDrawFn = (
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) => void;

const UNIT_DRAWERS: Record<string, UnitDrawFn> = {
  scout: drawScout,
  warrior: drawWarrior,
  archer: drawArcher,
  defender: drawDefender,
  catapult: drawCatapult,
  ironclad_berserker: drawBerserker,
  ironclad_siege_tower: drawSiegeTower,
  sylvan_ranger: drawRanger,
  sylvan_treant: drawTreant,
  scuttling: drawScuttling,
  scab: drawScab,
  reaper: drawReaper,
  lancer: drawLancer,
};

// ═══════════════════════════════════════
// SCOUT — lean runner with hood & dagger
// ═══════════════════════════════════════
function drawScout(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y; // base (feet)

  // Legs (running pose — spread apart)
  filled(ctx, dark, () => {
    // Left leg (back)
    ctx.moveTo(cx - 4, by - 8);
    ctx.lineTo(cx - 6, by);
    ctx.lineTo(cx - 3, by);
    ctx.closePath();
  });
  filled(ctx, color, () => {
    // Right leg (forward)
    ctx.moveTo(cx + 1, by - 8);
    ctx.lineTo(cx + 5, by);
    ctx.lineTo(cx + 2, by);
    ctx.closePath();
  });

  // Body (lean torso)
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 4, by - 8);
    ctx.lineTo(cx + 3, by - 8);
    ctx.lineTo(cx + 2, by - 15);
    ctx.lineTo(cx - 3, by - 15);
    ctx.closePath();
  });

  // Cape flowing behind
  filled(ctx, dark, () => {
    ctx.moveTo(cx - 3, by - 15);
    ctx.lineTo(cx - 8, by - 6);
    ctx.lineTo(cx - 5, by - 5);
    ctx.lineTo(cx - 4, by - 10);
    ctx.closePath();
  });

  // Head (hooded)
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 3, by - 15);
    ctx.lineTo(cx + 2, by - 15);
    ctx.lineTo(cx + 3, by - 19);
    ctx.lineTo(cx, by - 21);
    ctx.lineTo(cx - 3, by - 19);
    ctx.closePath();
  });

  // Face peek
  filled(ctx, SKIN, () => {
    ctx.moveTo(cx - 1, by - 15);
    ctx.lineTo(cx + 2, by - 15);
    ctx.lineTo(cx + 2, by - 18);
    ctx.lineTo(cx - 1, by - 17);
    ctx.closePath();
  });

  // Eye
  filled(ctx, OUTLINE, () => {
    ctx.arc(cx + 1, by - 16.5, 0.7, 0, Math.PI * 2);
  });

  // Dagger (small, held forward)
  filled(ctx, METAL_LIGHT, () => {
    ctx.moveTo(cx + 4, by - 12);
    ctx.lineTo(cx + 8, by - 14);
    ctx.lineTo(cx + 7, by - 15);
    ctx.lineTo(cx + 3, by - 13);
    ctx.closePath();
  });
}

// ═══════════════════════════════════════
// WARRIOR — sword & shield infantry
// ═══════════════════════════════════════
function drawWarrior(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y;

  // Legs
  filled(ctx, dark, () => {
    ctx.moveTo(cx - 3, by - 8);
    ctx.lineTo(cx - 4, by);
    ctx.lineTo(cx - 1, by);
    ctx.closePath();
  });
  filled(ctx, dark, () => {
    ctx.moveTo(cx + 1, by - 8);
    ctx.lineTo(cx + 2, by);
    ctx.lineTo(cx + 5, by);
    ctx.closePath();
  });

  // Body (stocky torso)
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 5, by - 8);
    ctx.lineTo(cx + 5, by - 8);
    ctx.lineTo(cx + 4, by - 15);
    ctx.lineTo(cx - 4, by - 15);
    ctx.closePath();
  });

  // Belt
  filled(ctx, WOOD_DARK, () => {
    ctx.fillRect(cx - 5, by - 9, 10, 2);
  });

  // Shield (left arm — prominent round shield)
  outlined(ctx, dark, () => {
    ctx.moveTo(cx - 5, by - 14);
    ctx.lineTo(cx - 10, by - 12);
    ctx.lineTo(cx - 10, by - 8);
    ctx.lineTo(cx - 5, by - 7);
    ctx.closePath();
  });
  // Shield boss
  filled(ctx, light, () => {
    ctx.arc(cx - 7, by - 10.5, 1.5, 0, Math.PI * 2);
  });

  // Sword (right arm — raised)
  filled(ctx, METAL_MID, () => {
    ctx.fillRect(cx + 5, by - 22, 2, 10);
  });
  // Sword guard
  filled(ctx, WOOD, () => {
    ctx.fillRect(cx + 4, by - 13, 4, 2);
  });
  // Sword grip
  filled(ctx, WOOD_DARK, () => {
    ctx.fillRect(cx + 5, by - 12, 2, 3);
  });

  // Head
  outlined(ctx, SKIN, () => {
    ctx.arc(cx, by - 17.5, 3, 0, Math.PI * 2);
  });

  // Helmet
  outlined(ctx, METAL_MID, () => {
    ctx.moveTo(cx - 3.5, by - 17);
    ctx.lineTo(cx - 3, by - 21);
    ctx.lineTo(cx + 3, by - 21);
    ctx.lineTo(cx + 3.5, by - 17);
    ctx.closePath();
  });
  // Helmet crest
  filled(ctx, color, () => {
    ctx.fillRect(cx - 0.5, by - 22, 1.5, 2);
  });

  // Eyes
  filled(ctx, OUTLINE, () => {
    ctx.fillRect(cx - 2, by - 18, 1.5, 1);
    ctx.fillRect(cx + 1, by - 18, 1.5, 1);
  });
}

// ═══════════════════════════════════════
// ARCHER — bow drawn with arrow
// ═══════════════════════════════════════
function drawArcher(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y;

  // Legs
  filled(ctx, dark, () => {
    ctx.moveTo(cx - 2, by - 7);
    ctx.lineTo(cx - 3, by);
    ctx.lineTo(cx, by);
    ctx.closePath();
  });
  filled(ctx, dark, () => {
    ctx.moveTo(cx + 1, by - 7);
    ctx.lineTo(cx + 2, by);
    ctx.lineTo(cx + 4, by);
    ctx.closePath();
  });

  // Body (slim tunic)
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 4, by - 7);
    ctx.lineTo(cx + 4, by - 7);
    ctx.lineTo(cx + 3, by - 14);
    ctx.lineTo(cx - 3, by - 14);
    ctx.closePath();
  });

  // Bow (curved, on left side)
  ctx.beginPath();
  ctx.moveTo(cx - 7, by - 18);
  ctx.quadraticCurveTo(cx - 11, by - 11, cx - 7, by - 4);
  ctx.strokeStyle = WOOD;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Bowstring
  ctx.beginPath();
  ctx.moveTo(cx - 7, by - 18);
  ctx.lineTo(cx - 4, by - 11);
  ctx.lineTo(cx - 7, by - 4);
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Arrow (nocked)
  ctx.beginPath();
  ctx.moveTo(cx - 4, by - 11);
  ctx.lineTo(cx + 8, by - 11);
  ctx.strokeStyle = WOOD_LIGHT;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Arrowhead
  filled(ctx, METAL_LIGHT, () => {
    ctx.moveTo(cx + 8, by - 11);
    ctx.lineTo(cx + 10, by - 12);
    ctx.lineTo(cx + 10, by - 10);
    ctx.closePath();
  });

  // Quiver on back
  filled(ctx, WOOD_DARK, () => {
    ctx.moveTo(cx + 2, by - 16);
    ctx.lineTo(cx + 5, by - 16);
    ctx.lineTo(cx + 4, by - 7);
    ctx.lineTo(cx + 2, by - 7);
    ctx.closePath();
  });
  // Arrow tips poking out of quiver
  filled(ctx, METAL_MID, () => {
    ctx.moveTo(cx + 2, by - 16);
    ctx.lineTo(cx + 3, by - 18);
    ctx.lineTo(cx + 3.5, by - 16);
    ctx.closePath();
  });
  filled(ctx, METAL_MID, () => {
    ctx.moveTo(cx + 3.5, by - 16);
    ctx.lineTo(cx + 4.5, by - 17);
    ctx.lineTo(cx + 5, by - 16);
    ctx.closePath();
  });

  // Head
  outlined(ctx, SKIN, () => {
    ctx.arc(cx, by - 16.5, 2.8, 0, Math.PI * 2);
  });

  // Cap / headband
  filled(ctx, color, () => {
    ctx.moveTo(cx - 3, by - 17);
    ctx.lineTo(cx - 2.5, by - 20);
    ctx.lineTo(cx + 2.5, by - 20);
    ctx.lineTo(cx + 3, by - 17);
    ctx.closePath();
  });
  // Feather
  filled(ctx, light, () => {
    ctx.moveTo(cx + 2, by - 20);
    ctx.lineTo(cx + 4, by - 22);
    ctx.lineTo(cx + 3, by - 19);
    ctx.closePath();
  });

  // Eyes
  filled(ctx, OUTLINE, () => {
    ctx.fillRect(cx - 2, by - 17, 1, 1);
    ctx.fillRect(cx + 1, by - 17, 1, 1);
  });
}

// ═══════════════════════════════════════
// DEFENDER — large shield, heavy armor
// ═══════════════════════════════════════
function drawDefender(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y;

  // Legs (wide stance)
  filled(ctx, METAL_DARK, () => {
    ctx.moveTo(cx - 4, by - 7);
    ctx.lineTo(cx - 5, by);
    ctx.lineTo(cx - 2, by);
    ctx.closePath();
  });
  filled(ctx, METAL_DARK, () => {
    ctx.moveTo(cx + 2, by - 7);
    ctx.lineTo(cx + 3, by);
    ctx.lineTo(cx + 6, by);
    ctx.closePath();
  });

  // Body (wide, armored torso)
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 5, by - 7);
    ctx.lineTo(cx + 6, by - 7);
    ctx.lineTo(cx + 5, by - 15);
    ctx.lineTo(cx - 4, by - 15);
    ctx.closePath();
  });

  // Armor plate detail
  filled(ctx, dark, () => {
    ctx.moveTo(cx - 2, by - 14);
    ctx.lineTo(cx + 3, by - 14);
    ctx.lineTo(cx + 2, by - 10);
    ctx.lineTo(cx - 1, by - 10);
    ctx.closePath();
  });

  // Large shield (dominant, front-facing)
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 4, by - 16);
    ctx.lineTo(cx - 12, by - 14);
    ctx.lineTo(cx - 12, by - 4);
    ctx.lineTo(cx - 4, by - 2);
    ctx.closePath();
  });
  // Shield face highlight
  filled(ctx, light, () => {
    ctx.moveTo(cx - 5, by - 14);
    ctx.lineTo(cx - 10, by - 12);
    ctx.lineTo(cx - 10, by - 6);
    ctx.lineTo(cx - 5, by - 4);
    ctx.closePath();
  });
  // Shield emblem (cross)
  filled(ctx, dark, () => {
    ctx.fillRect(cx - 9, by - 10.5, 5, 1.5);
    ctx.fillRect(cx - 7.5, by - 13, 1.5, 6);
  });

  // Spear (held upright behind shield)
  ctx.beginPath();
  ctx.moveTo(cx + 5, by - 3);
  ctx.lineTo(cx + 5, by - 22);
  ctx.strokeStyle = WOOD;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Spearhead
  filled(ctx, METAL_LIGHT, () => {
    ctx.moveTo(cx + 5, by - 22);
    ctx.lineTo(cx + 3.5, by - 19);
    ctx.lineTo(cx + 6.5, by - 19);
    ctx.closePath();
  });

  // Head
  outlined(ctx, SKIN, () => {
    ctx.arc(cx + 1, by - 17.5, 2.8, 0, Math.PI * 2);
  });

  // Full helmet
  outlined(ctx, METAL_MID, () => {
    ctx.moveTo(cx - 2, by - 16.5);
    ctx.lineTo(cx - 2, by - 21);
    ctx.lineTo(cx + 4, by - 21);
    ctx.lineTo(cx + 4, by - 16.5);
    ctx.closePath();
  });
  // Helmet visor slit
  filled(ctx, OUTLINE, () => {
    ctx.fillRect(cx - 1, by - 18.5, 4, 1);
  });
}

// ═══════════════════════════════════════
// CATAPULT — wooden siege engine
// ═══════════════════════════════════════
function drawCatapult(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, _light: string,
) {
  const by = cy + FOOT_Y;

  // Wheels
  outlined(ctx, WOOD_DARK, () => {
    ctx.arc(cx - 6, by - 1, 3, 0, Math.PI * 2);
  });
  outlined(ctx, WOOD_DARK, () => {
    ctx.arc(cx + 6, by - 1, 3, 0, Math.PI * 2);
  });
  // Wheel spokes
  ctx.strokeStyle = WOOD_LIGHT;
  ctx.lineWidth = 0.5;
  for (const wx of [cx - 6, cx + 6]) {
    ctx.beginPath();
    ctx.moveTo(wx - 2, by - 1);
    ctx.lineTo(wx + 2, by - 1);
    ctx.moveTo(wx, by - 3);
    ctx.lineTo(wx, by + 1);
    ctx.stroke();
  }

  // Base frame
  outlined(ctx, WOOD, () => {
    ctx.moveTo(cx - 8, by - 3);
    ctx.lineTo(cx + 8, by - 3);
    ctx.lineTo(cx + 7, by - 6);
    ctx.lineTo(cx - 7, by - 6);
    ctx.closePath();
  });

  // Vertical support frame (A-frame)
  outlined(ctx, WOOD, () => {
    ctx.moveTo(cx - 3, by - 6);
    ctx.lineTo(cx, by - 16);
    ctx.lineTo(cx + 3, by - 6);
    ctx.closePath();
  });

  // Throwing arm (angled, with bucket)
  ctx.beginPath();
  ctx.moveTo(cx - 6, by - 8);
  ctx.lineTo(cx + 2, by - 18);
  ctx.strokeStyle = WOOD;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Bucket/sling at the end
  filled(ctx, dark, () => {
    ctx.moveTo(cx + 2, by - 18);
    ctx.lineTo(cx + 5, by - 17);
    ctx.lineTo(cx + 4, by - 15);
    ctx.lineTo(cx + 1, by - 16);
    ctx.closePath();
  });

  // Projectile (stone)
  filled(ctx, METAL_MID, () => {
    ctx.arc(cx + 3, by - 18, 2, 0, Math.PI * 2);
  });

  // Counterweight
  filled(ctx, METAL_DARK, () => {
    ctx.moveTo(cx - 6, by - 8);
    ctx.lineTo(cx - 8, by - 6);
    ctx.lineTo(cx - 4, by - 6);
    ctx.closePath();
  });

  // Color banner on frame
  filled(ctx, color, () => {
    ctx.moveTo(cx, by - 16);
    ctx.lineTo(cx + 4, by - 14);
    ctx.lineTo(cx + 3, by - 12);
    ctx.lineTo(cx, by - 14);
    ctx.closePath();
  });
}

// ═══════════════════════════════════════
// IRONCLAD BERSERKER — axe overhead, horned helm
// ═══════════════════════════════════════
function drawBerserker(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y;

  // Legs (wide power stance)
  filled(ctx, dark, () => {
    ctx.moveTo(cx - 4, by - 7);
    ctx.lineTo(cx - 6, by);
    ctx.lineTo(cx - 2, by);
    ctx.closePath();
  });
  filled(ctx, dark, () => {
    ctx.moveTo(cx + 2, by - 7);
    ctx.lineTo(cx + 4, by);
    ctx.lineTo(cx + 7, by);
    ctx.closePath();
  });

  // Body (broad, muscular)
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 6, by - 7);
    ctx.lineTo(cx + 6, by - 7);
    ctx.lineTo(cx + 5, by - 15);
    ctx.lineTo(cx - 5, by - 15);
    ctx.closePath();
  });

  // Chest X-strap / war paint
  ctx.beginPath();
  ctx.moveTo(cx - 4, by - 14);
  ctx.lineTo(cx + 3, by - 8);
  ctx.moveTo(cx + 4, by - 14);
  ctx.lineTo(cx - 3, by - 8);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Arms raised (both holding axe overhead)
  filled(ctx, SKIN, () => {
    ctx.moveTo(cx - 5, by - 14);
    ctx.lineTo(cx - 6, by - 18);
    ctx.lineTo(cx - 3, by - 18);
    ctx.lineTo(cx - 3, by - 14);
    ctx.closePath();
  });
  filled(ctx, SKIN, () => {
    ctx.moveTo(cx + 4, by - 14);
    ctx.lineTo(cx + 5, by - 18);
    ctx.lineTo(cx + 3, by - 18);
    ctx.lineTo(cx + 3, by - 14);
    ctx.closePath();
  });

  // Axe handle (horizontal overhead)
  ctx.beginPath();
  ctx.moveTo(cx - 8, by - 19);
  ctx.lineTo(cx + 7, by - 19);
  ctx.strokeStyle = WOOD;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Axe head (large, double-sided)
  filled(ctx, METAL_LIGHT, () => {
    ctx.moveTo(cx + 4, by - 19);
    ctx.lineTo(cx + 9, by - 23);
    ctx.lineTo(cx + 10, by - 19);
    ctx.lineTo(cx + 9, by - 15);
    ctx.closePath();
  });
  filled(ctx, METAL_MID, () => {
    ctx.moveTo(cx + 10, by - 19);
    ctx.lineTo(cx + 9, by - 15);
    ctx.lineTo(cx + 4, by - 19);
    ctx.closePath();
  });

  // Head
  outlined(ctx, SKIN, () => {
    ctx.arc(cx, by - 17, 3, 0, Math.PI * 2);
  });

  // Horned helmet
  outlined(ctx, METAL_DARK, () => {
    ctx.moveTo(cx - 3.5, by - 17);
    ctx.lineTo(cx - 3, by - 21);
    ctx.lineTo(cx + 3, by - 21);
    ctx.lineTo(cx + 3.5, by - 17);
    ctx.closePath();
  });
  // Horns
  filled(ctx, '#d4c5a0', () => {
    ctx.moveTo(cx - 3, by - 20);
    ctx.lineTo(cx - 7, by - 24);
    ctx.lineTo(cx - 2, by - 21);
    ctx.closePath();
  });
  filled(ctx, '#d4c5a0', () => {
    ctx.moveTo(cx + 3, by - 20);
    ctx.lineTo(cx + 7, by - 24);
    ctx.lineTo(cx + 2, by - 21);
    ctx.closePath();
  });

  // Angry eyes
  filled(ctx, '#ff4444', () => {
    ctx.fillRect(cx - 2, by - 17.5, 1.5, 1);
    ctx.fillRect(cx + 1, by - 17.5, 1.5, 1);
  });
}

// ═══════════════════════════════════════
// IRONCLAD SIEGE TOWER — tall wooden tower
// ═══════════════════════════════════════
function drawSiegeTower(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y;

  // Wheels
  outlined(ctx, WOOD_DARK, () => {
    ctx.arc(cx - 5, by - 1, 2.5, 0, Math.PI * 2);
  });
  outlined(ctx, WOOD_DARK, () => {
    ctx.arc(cx + 5, by - 1, 2.5, 0, Math.PI * 2);
  });

  // Tower body (tall rectangle)
  outlined(ctx, WOOD, () => {
    ctx.moveTo(cx - 7, by - 3);
    ctx.lineTo(cx + 7, by - 3);
    ctx.lineTo(cx + 7, by - 22);
    ctx.lineTo(cx - 7, by - 22);
    ctx.closePath();
  });

  // Wood plank lines
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 0.5;
  for (let i = 1; i <= 4; i++) {
    const py = by - 3 - i * 4;
    ctx.beginPath();
    ctx.moveTo(cx - 6, py);
    ctx.lineTo(cx + 6, py);
    ctx.stroke();
  }
  // Vertical plank line
  ctx.beginPath();
  ctx.moveTo(cx, by - 3);
  ctx.lineTo(cx, by - 22);
  ctx.stroke();

  // Battlements (top)
  for (let i = -2; i <= 2; i++) {
    if (Math.abs(i) === 1) continue; // gaps between merlons
    filled(ctx, WOOD, () => {
      ctx.fillRect(cx + i * 3 - 2, by - 25, 4, 3);
    });
  }

  // Color banner/flag
  filled(ctx, color, () => {
    ctx.moveTo(cx, by - 25);
    ctx.lineTo(cx, by - 30);
    ctx.lineTo(cx + 5, by - 28);
    ctx.lineTo(cx + 4, by - 26);
    ctx.lineTo(cx, by - 27);
    ctx.closePath();
  });

  // Door
  filled(ctx, WOOD_DARK, () => {
    ctx.moveTo(cx - 2, by - 3);
    ctx.lineTo(cx + 2, by - 3);
    ctx.lineTo(cx + 2, by - 8);
    ctx.arc(cx, by - 8, 2, 0, Math.PI, true);
    ctx.closePath();
  });

  // Window slits
  filled(ctx, OUTLINE, () => {
    ctx.fillRect(cx - 4, by - 14, 1.5, 3);
    ctx.fillRect(cx + 3, by - 14, 1.5, 3);
    ctx.fillRect(cx - 4, by - 20, 1.5, 3);
    ctx.fillRect(cx + 3, by - 20, 1.5, 3);
  });

  // Metal bands
  filled(ctx, METAL_DARK, () => {
    ctx.fillRect(cx - 7, by - 11, 14, 1.5);
    ctx.fillRect(cx - 7, by - 19, 14, 1.5);
  });
}

// ═══════════════════════════════════════
// SYLVAN RANGER — cloaked archer, nature-themed
// ═══════════════════════════════════════
function drawRanger(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y;

  // Legs
  filled(ctx, '#2d4a1e', () => {
    ctx.moveTo(cx - 2, by - 7);
    ctx.lineTo(cx - 3, by);
    ctx.lineTo(cx, by);
    ctx.closePath();
  });
  filled(ctx, '#2d4a1e', () => {
    ctx.moveTo(cx + 1, by - 7);
    ctx.lineTo(cx + 2, by);
    ctx.lineTo(cx + 4, by);
    ctx.closePath();
  });

  // Leaf cloak (flows around body)
  filled(ctx, dark, () => {
    ctx.moveTo(cx - 3, by - 15);
    ctx.lineTo(cx - 8, by - 3);
    ctx.quadraticCurveTo(cx - 6, by - 1, cx - 3, by - 4);
    ctx.closePath();
  });
  filled(ctx, dark, () => {
    ctx.moveTo(cx + 3, by - 15);
    ctx.lineTo(cx + 7, by - 4);
    ctx.quadraticCurveTo(cx + 5, by - 2, cx + 3, by - 5);
    ctx.closePath();
  });

  // Body (slim)
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 3, by - 7);
    ctx.lineTo(cx + 3, by - 7);
    ctx.lineTo(cx + 3, by - 15);
    ctx.lineTo(cx - 3, by - 15);
    ctx.closePath();
  });

  // Long bow (elegant curve)
  ctx.beginPath();
  ctx.moveTo(cx - 6, by - 20);
  ctx.quadraticCurveTo(cx - 10, by - 11, cx - 6, by - 2);
  ctx.strokeStyle = '#5a3e28';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Bowstring
  ctx.beginPath();
  ctx.moveTo(cx - 6, by - 20);
  ctx.lineTo(cx - 6, by - 2);
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Head
  outlined(ctx, SKIN, () => {
    ctx.arc(cx, by - 17, 2.5, 0, Math.PI * 2);
  });

  // Leaf crown / nature hood
  filled(ctx, '#1b6b3a', () => {
    ctx.moveTo(cx - 3, by - 18);
    ctx.lineTo(cx, by - 22);
    ctx.lineTo(cx + 3, by - 18);
    ctx.closePath();
  });
  // Leaf tips
  filled(ctx, '#2d9a50', () => {
    ctx.moveTo(cx - 3, by - 19);
    ctx.lineTo(cx - 5, by - 22);
    ctx.lineTo(cx - 2, by - 20);
    ctx.closePath();
  });
  filled(ctx, '#2d9a50', () => {
    ctx.moveTo(cx + 3, by - 19);
    ctx.lineTo(cx + 5, by - 22);
    ctx.lineTo(cx + 2, by - 20);
    ctx.closePath();
  });

  // Eyes (green glow)
  filled(ctx, '#66ff66', () => {
    ctx.fillRect(cx - 2, by - 17.5, 1, 1);
    ctx.fillRect(cx + 1, by - 17.5, 1, 1);
  });
}

// ═══════════════════════════════════════
// SYLVAN TREANT — tree creature
// ═══════════════════════════════════════
function drawTreant(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y;

  // Root-feet
  filled(ctx, '#5a3e28', () => {
    ctx.moveTo(cx - 6, by);
    ctx.lineTo(cx - 3, by - 5);
    ctx.lineTo(cx - 1, by);
    ctx.closePath();
  });
  filled(ctx, '#5a3e28', () => {
    ctx.moveTo(cx + 1, by);
    ctx.lineTo(cx + 3, by - 5);
    ctx.lineTo(cx + 6, by);
    ctx.closePath();
  });

  // Trunk body (thick, gnarled)
  outlined(ctx, '#6b4c1e', () => {
    ctx.moveTo(cx - 5, by - 5);
    ctx.lineTo(cx + 5, by - 5);
    ctx.quadraticCurveTo(cx + 6, by - 10, cx + 5, by - 15);
    ctx.lineTo(cx - 5, by - 15);
    ctx.quadraticCurveTo(cx - 6, by - 10, cx - 5, by - 5);
    ctx.closePath();
  });

  // Bark texture lines
  ctx.strokeStyle = '#4a3010';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - 2, by - 6);
  ctx.lineTo(cx - 3, by - 14);
  ctx.moveTo(cx + 2, by - 7);
  ctx.lineTo(cx + 1, by - 13);
  ctx.stroke();

  // Branch arms
  filled(ctx, '#5a3e28', () => {
    ctx.moveTo(cx - 5, by - 13);
    ctx.lineTo(cx - 10, by - 17);
    ctx.lineTo(cx - 9, by - 14);
    ctx.lineTo(cx - 5, by - 11);
    ctx.closePath();
  });
  filled(ctx, '#5a3e28', () => {
    ctx.moveTo(cx + 5, by - 13);
    ctx.lineTo(cx + 10, by - 17);
    ctx.lineTo(cx + 9, by - 14);
    ctx.lineTo(cx + 5, by - 11);
    ctx.closePath();
  });

  // Twig fingers
  ctx.strokeStyle = '#5a3e28';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 10, by - 17);
  ctx.lineTo(cx - 12, by - 19);
  ctx.moveTo(cx - 10, by - 17);
  ctx.lineTo(cx - 11, by - 15);
  ctx.moveTo(cx + 10, by - 17);
  ctx.lineTo(cx + 12, by - 19);
  ctx.moveTo(cx + 10, by - 17);
  ctx.lineTo(cx + 11, by - 15);
  ctx.stroke();

  // Leaf canopy (crown of foliage — uses player color)
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 8, by - 14);
    ctx.lineTo(cx - 4, by - 22);
    ctx.lineTo(cx, by - 16);
    ctx.lineTo(cx + 4, by - 22);
    ctx.lineTo(cx + 8, by - 14);
    ctx.closePath();
  });
  filled(ctx, light, () => {
    ctx.moveTo(cx - 5, by - 15);
    ctx.lineTo(cx - 2, by - 20);
    ctx.lineTo(cx, by - 16);
    ctx.closePath();
  });
  filled(ctx, light, () => {
    ctx.moveTo(cx + 1, by - 16);
    ctx.lineTo(cx + 3, by - 21);
    ctx.lineTo(cx + 6, by - 15);
    ctx.closePath();
  });

  // Top leaf sprout
  filled(ctx, dark, () => {
    ctx.moveTo(cx - 1, by - 22);
    ctx.lineTo(cx, by - 26);
    ctx.lineTo(cx + 1, by - 22);
    ctx.closePath();
  });

  // Face in trunk (glowing eyes)
  filled(ctx, '#ffcc00', () => {
    ctx.arc(cx - 2, by - 11, 1, 0, Math.PI * 2);
  });
  filled(ctx, '#ffcc00', () => {
    ctx.arc(cx + 2, by - 11, 1, 0, Math.PI * 2);
  });
  // Mouth
  ctx.beginPath();
  ctx.moveTo(cx - 2, by - 8);
  ctx.quadraticCurveTo(cx, by - 7, cx + 2, by - 8);
  ctx.strokeStyle = '#4a3010';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ═══════════════════════════════════════
// SCUTTLING — zergling: low insectoid, raised scythe claws
// ═══════════════════════════════════════
function drawScuttling(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y;

  // Four little legs
  ctx.strokeStyle = dark; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 4, by - 5); ctx.lineTo(cx - 7, by);
  ctx.moveTo(cx - 1, by - 5); ctx.lineTo(cx - 2, by);
  ctx.moveTo(cx + 1, by - 5); ctx.lineTo(cx + 2, by);
  ctx.moveTo(cx + 4, by - 5); ctx.lineTo(cx + 7, by);
  ctx.stroke();

  // Low carapace body
  outlined(ctx, color, () => { ctx.ellipse(cx, by - 6, 6, 3.5, 0, 0, Math.PI * 2); });
  filled(ctx, light, () => { ctx.ellipse(cx - 1, by - 7, 3, 1.3, -0.3, 0, Math.PI * 2); });

  // Two raised scythe claws (the zergling silhouette)
  filled(ctx, METAL_LIGHT, () => {
    ctx.moveTo(cx - 3, by - 8); ctx.lineTo(cx - 7, by - 15); ctx.lineTo(cx - 4, by - 9); ctx.closePath();
  });
  filled(ctx, METAL_LIGHT, () => {
    ctx.moveTo(cx + 1, by - 8); ctx.lineTo(cx - 1, by - 15); ctx.lineTo(cx + 2, by - 9); ctx.closePath();
  });

  // Head forward with mandibles
  outlined(ctx, dark, () => { ctx.ellipse(cx + 5, by - 7, 2.5, 2, 0, 0, Math.PI * 2); });
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx + 7, by - 7.5); ctx.lineTo(cx + 9, by - 8.5);
  ctx.moveTo(cx + 7, by - 6.5); ctx.lineTo(cx + 9, by - 5.5);
  ctx.stroke();
  filled(ctx, '#ffdd44', () => { ctx.arc(cx + 5, by - 7.5, 0.7, 0, Math.PI * 2); });
}

// ═══════════════════════════════════════
// SCAB — hydralisk: upright serpent, back spines, bone scythe
// ═══════════════════════════════════════
function drawScab(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y;

  // Coiled serpent base
  outlined(ctx, dark, () => { ctx.ellipse(cx, by - 3, 6, 3.5, 0, 0, Math.PI * 2); });
  filled(ctx, color, () => { ctx.ellipse(cx + 1, by - 3.5, 3, 1.5, 0, 0, Math.PI * 2); });

  // Upright torso
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 3, by - 5); ctx.lineTo(cx + 3, by - 5);
    ctx.lineTo(cx + 2, by - 16); ctx.lineTo(cx - 2, by - 16); ctx.closePath();
  });

  // Back spines (row of needle spikes)
  filled(ctx, light, () => { ctx.moveTo(cx - 2, by - 7); ctx.lineTo(cx - 7, by - 8); ctx.lineTo(cx - 2, by - 9); ctx.closePath(); });
  filled(ctx, light, () => { ctx.moveTo(cx - 2, by - 11); ctx.lineTo(cx - 7, by - 12); ctx.lineTo(cx - 2, by - 13); ctx.closePath(); });

  // Forward bone scythe / needle arm
  filled(ctx, METAL_LIGHT, () => {
    ctx.moveTo(cx + 2, by - 13); ctx.lineTo(cx + 10, by - 17); ctx.lineTo(cx + 9, by - 15); ctx.lineTo(cx + 2, by - 12); ctx.closePath();
  });

  // Hooded snake head
  outlined(ctx, dark, () => { ctx.ellipse(cx, by - 18, 3, 2.5, 0, 0, Math.PI * 2); });
  filled(ctx, '#88ff88', () => { ctx.fillRect(cx - 2, by - 18.5, 1, 1); ctx.fillRect(cx + 1, by - 18.5, 1, 1); });
}

// ═══════════════════════════════════════
// REAPER — ultralisk: bulky quadruped, head blades
// ═══════════════════════════════════════
function drawReaper(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y;

  // Four stubby legs
  for (const lx of [cx - 7, cx - 3, cx + 1, cx + 5]) {
    filled(ctx, dark, () => { ctx.fillRect(lx, by - 4, 2.5, 4); });
  }

  // Bulky humped body
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 8, by - 4);
    ctx.quadraticCurveTo(cx - 9, by - 14, cx - 1, by - 16);
    ctx.quadraticCurveTo(cx + 6, by - 16, cx + 8, by - 7);
    ctx.lineTo(cx + 8, by - 4); ctx.closePath();
  });
  filled(ctx, light, () => { ctx.ellipse(cx - 2, by - 13, 4, 2, -0.3, 0, Math.PI * 2); });

  // Head (lower front)
  outlined(ctx, dark, () => { ctx.ellipse(cx + 7, by - 6, 3, 2.5, 0, 0, Math.PI * 2); });

  // Big kaiser blades / tusks
  filled(ctx, METAL_LIGHT, () => { ctx.moveTo(cx + 8, by - 7); ctx.lineTo(cx + 14, by - 11); ctx.lineTo(cx + 11, by - 6); ctx.closePath(); });
  filled(ctx, METAL_LIGHT, () => { ctx.moveTo(cx + 8, by - 5); ctx.lineTo(cx + 14, by - 4); ctx.lineTo(cx + 10, by - 3); ctx.closePath(); });

  filled(ctx, '#ff6622', () => { ctx.arc(cx + 7, by - 6.5, 0.9, 0, Math.PI * 2); });
}

// ═══════════════════════════════════════
// LANCER — StarCraft marine: armored human with rifle
// ═══════════════════════════════════════
function drawLancer(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, dark: string, light: string,
) {
  const by = cy + FOOT_Y;

  // Armored legs
  filled(ctx, METAL_DARK, () => { ctx.moveTo(cx - 3, by - 7); ctx.lineTo(cx - 4, by); ctx.lineTo(cx - 1, by); ctx.closePath(); });
  filled(ctx, METAL_DARK, () => { ctx.moveTo(cx + 1, by - 7); ctx.lineTo(cx + 2, by); ctx.lineTo(cx + 5, by); ctx.closePath(); });

  // Bulky armored torso
  outlined(ctx, color, () => {
    ctx.moveTo(cx - 6, by - 7); ctx.lineTo(cx + 6, by - 7);
    ctx.lineTo(cx + 5, by - 16); ctx.lineTo(cx - 5, by - 16); ctx.closePath();
  });
  filled(ctx, dark, () => { ctx.fillRect(cx - 3, by - 14, 6, 4); }); // chest plate

  // Shoulder pauldrons
  outlined(ctx, light, () => { ctx.ellipse(cx - 6, by - 15, 2.5, 2, 0, 0, Math.PI * 2); });
  outlined(ctx, light, () => { ctx.ellipse(cx + 6, by - 15, 2.5, 2, 0, 0, Math.PI * 2); });

  // Rifle held across the body (+ muzzle, magazine)
  filled(ctx, METAL_DARK, () => { ctx.fillRect(cx - 2, by - 12, 12, 2); });
  filled(ctx, METAL_MID, () => { ctx.fillRect(cx + 9, by - 12.5, 3, 1); });
  filled(ctx, METAL_DARK, () => { ctx.fillRect(cx, by - 10, 2, 3); });

  // Helmet + visor
  outlined(ctx, METAL_MID, () => { ctx.arc(cx, by - 18, 3, 0, Math.PI * 2); });
  filled(ctx, dark, () => { ctx.fillRect(cx - 3, by - 20.5, 6, 1.5); });
  filled(ctx, '#66ccff', () => { ctx.fillRect(cx - 2, by - 19, 4, 1.5); });
}

// ═══════════════════════════════════════
// GENERIC fallback — simple circle with letter
// ═══════════════════════════════════════
function drawGenericUnit(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, _dark: string, _light: string,
) {
  outlined(ctx, color, () => {
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  }, 1.5);
}
