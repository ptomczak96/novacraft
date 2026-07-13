import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { previewCombat, isExpansionTileEligible } from '@tactica/engine';
import type { Coord, Unit, Action } from '@tactica/engine';

import type { GameState, DataRegistry, CityState } from '@tactica/engine';
import { ELEVATION, BG_COLOR } from './constants.js';

// Greedily keep the picks that still form a valid chain (drops any tile orphaned
// when an earlier pick it depended on is removed). Order = current pick order.
function coherentSubset(state: GameState, registry: DataRegistry, city: CityState, picks: Coord[]): Coord[] {
  const accepted: Coord[] = [];
  const remaining = [...picks];
  let progress = true;
  while (remaining.length && progress) {
    progress = false;
    for (let i = 0; i < remaining.length; i++) {
      if (isExpansionTileEligible(state, registry, city, remaining[i], accepted)) {
        accepted.push(remaining[i]);
        remaining.splice(i, 1);
        progress = true;
        break;
      }
    }
  }
  return accepted;
}
import { canvasSize, screenToTile, tileToScreenShifted } from './projection.js';
import { drawTile } from './drawTile.js';
import { drawUnitAt } from './drawUnit.js';
import { loadTileSprites, setActiveTheme } from './tileSprites.js';
import { loadUnitSprites, facingFromDelta, DEFAULT_FACING, type Facing } from './unitSprites.js';
import {
  drawMoveHighlight,
  drawAttackHighlight,
  drawFogExplored,
  drawCloud,
  drawDamagePreview,
  drawGridLabel,
  drawTerritoryBorders,
  drawTerritoryPicker,
} from './drawOverlays.js';
import {
  drawBuildingLabel, drawResourceLabel, drawActionBox, drawNameBadge, pointInRect,
  type ScreenRect,
} from './drawEconomy.js';

interface IsoCanvasProps {
  mode: 'game' | 'editor';
  /** Editor: called on single click / drag paint */
  onPaint?: (x: number, y: number) => void;
  /** Game: current pan offset (px), applied as a CSS translate. */
  pan?: { x: number; y: number };
  /** Game: report a new pan offset while the board is dragged. */
  onPanChange?: (pan: { x: number; y: number }) => void;
}

export function IsoCanvas({ mode, onPaint, pan, onPanChange }: IsoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);

  // ── Drag-to-pan (game) ──
  // A press records the start; once the pointer moves past a small threshold we
  // treat it as a pan (not a click) and translate the board. On release, if we
  // panned, the following click is suppressed so dragging never selects a tile.
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  // Clamp a proposed pan so the board can be moved across its overflow (when
  // zoomed) plus ~half a screen of slack, but never flung entirely out of view.
  const clampPan = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return { x, y };
    const rect = canvas.getBoundingClientRect(); // size reflects zoom, not translate
    const maxX = Math.max(0, (rect.width - container.clientWidth) / 2) + container.clientWidth * 0.5;
    const maxY = Math.max(0, (rect.height - container.clientHeight) / 2) + container.clientHeight * 0.5;
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, []);

  // Tile art theme (pure render setting). Applying it before loading swaps which
  // sprite set the renderer draws; reloading bumps spriteTick to repaint.
  const tileTheme = useGameStore(s => s.tileTheme);

  // Bumped once tile sprites finish loading, to force a re-render with images.
  const [spriteTick, setSpriteTick] = useState(0);
  useEffect(() => {
    setActiveTheme(tileTheme);
    loadTileSprites(tileTheme, () => setSpriteTick(t => t + 1));
    loadUnitSprites(() => setSpriteTick(t => t + 1));
    // Repaint immediately too: if this theme was already cached, onReady fires
    // synchronously and the tick bump above still forces the swap to show.
    setSpriteTick(t => t + 1);
  }, [tileTheme]);

  // ── Unit move animation (simple glide) ──
  // When a unit's tile changes, glide it from old → new over MOVE_ANIM_MS by
  // drawing it at fractional tile coords. A rAF loop bumps animTick to redraw.
  const MOVE_ANIM_MS = 250;
  const DEATH_FADE_MS = 600;
  const animsRef = useRef<Map<number, { fx: number; fy: number; tx: number; ty: number; start: number }>>(new Map());
  const prevPosRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Render-side unit facing (which of the 4 directional sprites to use), derived
  // from the last move delta. Never part of engine state.
  const facingRef = useRef<Map<number, Facing>>(new Map());
  // Last full snapshot of each unit, so a unit that vanishes (death, or lost to
  // fog) can be drawn fading out at its final position.
  const prevUnitsRef = useRef<Map<number, Unit>>(new Map());
  const deathsRef = useRef<Map<number, { unit: Unit; facing: Facing; start: number; flash: boolean }>>(new Map());
  // Generic combat animations (Into-the-Breach style): attacker lunge toward the
  // target, white hit flash on the victim, floating damage numbers. All render-
  // side; driven by the store's lastCombatEvent.
  const LUNGE_MS = 200;
  const FLASH_MS = 220;
  const POPUP_MS = 750;
  const lungesRef = useRef<Map<number, { tx: number; ty: number; start: number }>>(new Map());
  const flashesRef = useRef<Map<number, { start: number }>>(new Map());
  const popupsRef = useRef<{ x: number; y: number; text: string; start: number }[]>([]);
  const rafRef = useRef<number | undefined>(undefined);
  const [animTick, setAnimTick] = useState(0);

  // Scroll-to-zoom factor. Magnifies via CSS transform for display, and also feeds
  // the backing-store resolution (render-at-display) so tiles stay crisp when
  // zoomed. Clicking stays accurate because hit-testing uses the on-screen bbox.
  const [zoom, setZoom] = useState(1);

  // Bumped when the container resizes or DPR changes, so the backing store is
  // re-rasterized at the new on-screen resolution.
  const [viewTick, setViewTick] = useState(0);

  // Debounced follower of `zoom` used for the backing-store resolution. `zoom`
  // drives the CSS transform instantly (smooth), while re-rasterizing the board at
  // the new resolution is deferred until scrolling settles — so a fast wheel spin
  // doesn't reallocate the backing on every tick. The transient is briefly soft
  // (old backing stretched by the transform), then snaps crisp.
  const [renderZoom, setRenderZoom] = useState(1);
  useEffect(() => {
    const id = setTimeout(() => setRenderZoom(zoom), 120);
    return () => clearTimeout(id);
  }, [zoom]);

  // Tile the player clicked an ore/plasma resource on → show its "Build …?" box.
  const [buildPromptTile, setBuildPromptTile] = useState<Coord | null>(null);
  // Action boxes drawn this frame (found-city / build), kept for click hit-testing.
  const actionBoxesRef = useRef<{ rect: ScreenRect; action: Action }[]>([]);

  const {
    gameState, visibleState, registry, config,
    selectedUnitId, hoveredTile, legalActions,
    selectUnit, setSelectedCity, setHoveredTile, executeAction,
    territorySelect, setTerritorySelect,
    mapEditorState,
  } = useGameStore();

  // Pick the state source based on mode
  const state = mode === 'game' ? gameState : mapEditorState;
  const map = mode === 'game' ? visibleState?.map : mapEditorState?.map;
  const units = mode === 'game' ? (visibleState?.units ?? []) : (mapEditorState?.units ?? []);
  const visibility = mode === 'game' ? visibleState?.visibility : null;
  const buildings = mode === 'game' ? (visibleState?.buildings ?? []) : (mapEditorState?.buildings ?? []);
  const cities = mode === 'game' ? (visibleState?.cities ?? []) : (mapEditorState?.cities ?? []);
  const currentPlayer = state?.currentPlayer ?? 0;

  // ── Build unit position map ──
  const unitByPos = React.useMemo(() => {
    const m = new Map<string, Unit>();
    for (const u of units) {
      m.set(`${u.position.x},${u.position.y}`, u);
    }
    return m;
  }, [units]);

  const buildingByPos = React.useMemo(() => {
    const m = new Map<string, (typeof buildings)[number]>();
    for (const b of buildings) m.set(`${b.position.x},${b.position.y}`, b);
    return m;
  }, [buildings]);

  // Map a city's centre tile → its level, so themed base sprites (themes with
  // tiered base art) can show the right tier (level 1..5).
  const cityLevelByPos = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cities) m.set(`${c.position.x},${c.position.y}`, c.level);
    return m;
  }, [cities]);

  // Owner (player index) → factionId, for faction-scoped unit sprite sets.
  const factionByOwner = React.useMemo(() => {
    const m = new Map<number, string>();
    state?.players.forEach((p, i) => m.set(i, p.factionId));
    return m;
  }, [state?.players]);

  // Shared rAF loop for every render-side animation (glides, fades, lunges,
  // flashes, popups). Kicked by whichever effect starts an animation; expires
  // entries and stops itself when everything is done.
  const animActive = () =>
    animsRef.current.size > 0 || deathsRef.current.size > 0 ||
    lungesRef.current.size > 0 || flashesRef.current.size > 0 ||
    popupsRef.current.length > 0;
  const kickAnimLoop = () => {
    if (!animActive() || rafRef.current !== undefined) return;
    const step = () => {
      const t = performance.now();
      for (const [id, a] of animsRef.current) if (t - a.start >= MOVE_ANIM_MS) animsRef.current.delete(id);
      for (const [id, d] of deathsRef.current) if (t - d.start >= DEATH_FADE_MS) deathsRef.current.delete(id);
      for (const [id, l] of lungesRef.current) if (t - l.start >= LUNGE_MS) lungesRef.current.delete(id);
      for (const [id, f] of flashesRef.current) if (t - f.start >= FLASH_MS) flashesRef.current.delete(id);
      popupsRef.current = popupsRef.current.filter(p => t - p.start < POPUP_MS);
      setAnimTick(v => v + 1); // force redraw
      rafRef.current = animActive() ? requestAnimationFrame(step) : undefined;
    };
    rafRef.current = requestAnimationFrame(step);
  };

  // ── Combat events → lunge, hit flash, damage popups ──
  const { lastCombatEvent } = useGameStore();
  useEffect(() => {
    const ev = lastCombatEvent;
    if (!ev || mode !== 'game') return;
    const now = performance.now();
    const impact = LUNGE_MS * 0.5; // flash/popup land at the lunge's apex
    lungesRef.current.set(ev.attackerId, { tx: ev.defenderPos.x, ty: ev.defenderPos.y, start: now });
    // Attacker turns to face its target.
    const f = facingFromDelta(ev.defenderPos.x - ev.attackerPos.x, ev.defenderPos.y - ev.attackerPos.y);
    if (f) facingRef.current.set(ev.attackerId, f);
    // Dead units flash inside their death fade instead.
    if (!ev.defenderKilled) flashesRef.current.set(ev.defenderId, { start: now + impact });
    popupsRef.current.push({ x: ev.defenderPos.x, y: ev.defenderPos.y, text: `-${ev.damage}`, start: now + impact });
    if (ev.retaliation > 0) {
      if (!ev.attackerKilled) flashesRef.current.set(ev.attackerId, { start: now + impact + 120 });
      popupsRef.current.push({ x: ev.attackerPos.x, y: ev.attackerPos.y, text: `-${ev.retaliation}`, start: now + impact + 120 });
    }
    kickAnimLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCombatEvent]);

  // ── Detect unit moves → start glide animations ──
  useEffect(() => {
    const now = performance.now();
    const live = new Set<number>();
    for (const u of units) {
      live.add(u.id);
      const prev = prevPosRef.current.get(u.id);
      if (prev && (prev.x !== u.position.x || prev.y !== u.position.y)) {
        animsRef.current.set(u.id, {
          fx: prev.x, fy: prev.y, tx: u.position.x, ty: u.position.y, start: now,
        });
        const f = facingFromDelta(u.position.x - prev.x, u.position.y - prev.y);
        if (f) facingRef.current.set(u.id, f);
      }
      prevPosRef.current.set(u.id, { x: u.position.x, y: u.position.y });
      prevUnitsRef.current.set(u.id, u);
    }
    // If every previously-known unit vanished at once, this is a game reset /
    // load, not deaths — drop the old roster without fading ghosts.
    const wholesale = prevPosRef.current.size > 0 &&
      [...prevPosRef.current.keys()].every(id => !live.has(id));
    // Forget units that no longer exist; fade out the ones that just vanished.
    for (const id of [...prevPosRef.current.keys()]) {
      if (!live.has(id)) {
        const snap = prevUnitsRef.current.get(id);
        if (snap && !wholesale) {
          // Combat kills flash white at the start of their fade.
          const ev = useGameStore.getState().lastCombatEvent;
          const combatKill = !!ev && Date.now() - ev.at < 600 &&
            ((ev.defenderKilled && ev.defenderId === id) || (ev.attackerKilled && ev.attackerId === id));
          deathsRef.current.set(id, {
            unit: snap,
            facing: facingRef.current.get(id) ?? DEFAULT_FACING,
            start: now,
            flash: combatKill,
          });
        }
        prevPosRef.current.delete(id); animsRef.current.delete(id);
        facingRef.current.delete(id); prevUnitsRef.current.delete(id);
        lungesRef.current.delete(id); flashesRef.current.delete(id);
      }
    }
    kickAnimLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units]);

  // Cancel any running animation frame on unmount.
  useEffect(() => () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current); }, []);

  // ── Compute move/attack targets ──
  const { moveTargets, attackTargets } = React.useMemo(() => {
    const moveTargets = new Set<string>();
    const attackTargets = new Map<string, Action>();
    if (mode !== 'game' || selectedUnitId == null) return { moveTargets, attackTargets };
    for (const action of legalActions) {
      if (action.type === 'move' && action.unitId === selectedUnitId) {
        moveTargets.add(`${action.to.x},${action.to.y}`);
      }
      if (action.type === 'attack' && action.unitId === selectedUnitId) {
        const target = units.find(u => u.id === action.targetId);
        if (target) {
          attackTargets.set(`${target.position.x},${target.position.y}`, action);
        }
      }
    }
    return { moveTargets, attackTargets };
  }, [mode, selectedUnitId, legalActions, units]);

  // Blind units (e.g. scuttlings) reveal nothing but may move into cloud tiles —
  // so their move targets are highlighted even on undiscovered (cloud) tiles.
  const selectedUnitBlind = React.useMemo(() => {
    if (selectedUnitId == null) return false;
    const u = units.find(uu => uu.id === selectedUnitId);
    return !!(u && registry.unitTypes[u.typeId]?.conditions?.includes('blind'));
  }, [selectedUnitId, units, registry]);

  // ── Render the full scene ──
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvasSize(map.width, map.height);

    // ── Render at the true on-screen resolution ──
    // Fit the logical board into its container (uniform scale, preserves aspect),
    // then size the BACKING store to the actual device pixels it occupies at the
    // current zoom: backing = displayCSS × dpr × zoom. Each tile is therefore drawn
    // ~1:1 with its final on-screen size, so the source PNGs are resampled ONCE —
    // instead of being upscaled into a fixed dpr×2 buffer and then downscaled to
    // fit (an up-then-down round trip that softened them). This keeps the art crisp
    // at every zoom level; the cost is that changing zoom re-rasterizes the board.
    //
    // CSS size is set explicitly and UNIFORMLY here (a single fitScale for BOTH
    // axes). That is safe — unlike setting logical px per-axis together with
    // maxWidth/maxHeight:100%, which let the browser clamp the axes INDEPENDENTLY
    // and distorted the 2:1 tile geometry ~16-19% (the floor "stepped"). One shared
    // scale can't distort. Hit-testing uses getBoundingClientRect (post-transform),
    // so it is unaffected by the backing resolution.
    const container = canvas.parentElement;
    const cW = container?.clientWidth || width;
    const cH = container?.clientHeight || height;
    const fitScale = Math.min(cW / width, cH / height) || 1;
    const cssW = Math.floor(width * fitScale);
    const cssH = Math.floor(height * fitScale);

    const MAX_DIM = 8192;        // per-side browser canvas safety limit
    const MAX_AREA = 30_000_000; // ~120 MB rgba backing cap
    const renderScale = Math.max(1, Math.min(
      fitScale * renderZoom * dpr, // device pixels the board occupies at (settled) zoom
      MAX_DIM / width,
      MAX_DIM / height,
      Math.sqrt(MAX_AREA / (width * height)),
    ));

    canvas.width = Math.round(width * renderScale);
    canvas.height = Math.round(height * renderScale);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    // High-quality resampling of the source PNGs at this internal resolution.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Clear. Game: leave the canvas transparent so the parallax starfield behind
    // it shows through the gaps between tiles, unexplored tiles, and the empty
    // margins around the isometric diamond. Editor: keep the solid backdrop.
    if (mode === 'editor') {
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    // Terrain lookup for shore autotiling (null off-map).
    const terrainAt = (x: number, y: number): string | null =>
      (x >= 0 && y >= 0 && x < map.width && y < map.height) ? map.tiles[y][x].terrain : null;

    // ── Painter's algorithm: row 0→W ──
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y][x];
        const vis = visibility?.[y]?.[x] ?? 'visible';
        const key = `${x},${y}`;

        // Hidden (undiscovered) tiles: cover with a white cloud. A selected blind
        // unit still shows its move targets (blue) on the cloud so it can advance.
        if (vis === 'hidden') {
          drawCloud(ctx, x, y, map.height);
          // 'plains' → flat (elevation 0), so the blue diamond sits on the flat cloud.
          if (selectedUnitBlind && moveTargets.has(key)) drawMoveHighlight(ctx, x, y, map.height, 'plains');
          continue;
        }

        // ── 1. Draw tile prism ──
        drawTile(ctx, tile, x, y, map.height, registry, cityLevelByPos.get(key) ?? 1, terrainAt);

        // ── 2. Explored fog overlay ──
        if (vis === 'explored') {
          drawFogExplored(ctx, x, y, map.height, tile.terrain);
        }

        // ── 3. Move/attack highlights ──
        if (moveTargets.has(key)) {
          drawMoveHighlight(ctx, x, y, map.height, tile.terrain);
        }
        if (attackTargets.has(key)) {
          drawAttackHighlight(ctx, x, y, map.height, tile.terrain);
        }

        // ── 4. Unit ──
        const unit = unitByPos.get(key);
        if (unit) {
          const elev = ELEVATION[tile.terrain] ?? 0;
          // Glide animation: interpolate fractional tile pos if mid-move.
          const anim = animsRef.current.get(unit.id);
          let posOverride: { x: number; y: number } | undefined;
          if (anim) {
            const t = Math.min(1, (performance.now() - anim.start) / MOVE_ANIM_MS);
            const e = t * t * (3 - 2 * t); // smoothstep ease
            posOverride = { x: anim.fx + (anim.tx - anim.fx) * e, y: anim.fy + (anim.ty - anim.fy) * e };
          }
          // Attack lunge: dart ~35% toward the target and back (sin bump).
          const lunge = lungesRef.current.get(unit.id);
          if (!posOverride && lunge) {
            const lt = Math.min(1, (performance.now() - lunge.start) / LUNGE_MS);
            const k = Math.sin(Math.PI * lt) * 0.35;
            posOverride = {
              x: unit.position.x + (lunge.tx - unit.position.x) * k,
              y: unit.position.y + (lunge.ty - unit.position.y) * k,
            };
          }
          // Hit flash: white pop decaying over FLASH_MS (start may be scheduled ahead).
          let flash = 0;
          const fl = flashesRef.current.get(unit.id);
          if (fl) {
            const ft = (performance.now() - fl.start) / FLASH_MS;
            if (ft >= 0 && ft <= 1) flash = 1 - ft;
          }
          drawUnitAt(ctx, unit, map.height, elev, registry, unit.id === selectedUnitId, posOverride,
            facingRef.current.get(unit.id) ?? DEFAULT_FACING, factionByOwner.get(unit.owner), flash);
        }

        // ── 5. Damage preview ──
        if (
          mode === 'game' &&
          attackTargets.has(key) &&
          selectedUnitId != null &&
          hoveredTile?.x === x &&
          hoveredTile?.y === y
        ) {
          const attacker = units.find(u => u.id === selectedUnitId);
          if (attacker && unit) {
            const at = registry.unitTypes[attacker.typeId];
            const dt = registry.unitTypes[unit.typeId];
            if (at && dt) {
              const result = previewCombat(attacker, at, unit, dt, map, registry, config.combatConfig);
              drawDamagePreview(ctx, x, y, map.height, tile.terrain, result.attackerDamage);
            }
          }
        }

        // ── 6. Grid labels (editor) ──
        if (mode === 'editor') {
          drawGridLabel(ctx, x, y, map.height, tile.terrain);
        }
      }
    }

    // ── Dying units: (flash if killed in combat, then) fade out in place ──
    for (const { unit, facing, start, flash } of deathsRef.current.values()) {
      const { x, y } = unit.position;
      const vis = visibility?.[y]?.[x] ?? 'visible';
      if (vis === 'hidden') continue;
      const t = Math.min(1, (performance.now() - start) / DEATH_FADE_MS);
      if (t >= 1) continue;
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;
      const deathFlash = flash && t < 0.3 ? 1 - t / 0.3 : 0;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      drawUnitAt(ctx, unit, map.height, ELEVATION[tile.terrain] ?? 0, registry, false, undefined, facing,
        factionByOwner.get(unit.owner), deathFlash);
      ctx.restore();
    }

    // ── Floating damage numbers ──
    for (const p of popupsRef.current) {
      const pt = (performance.now() - p.start) / POPUP_MS;
      if (pt < 0 || pt > 1) continue;
      if ((visibility?.[p.y]?.[p.x] ?? 'visible') === 'hidden') continue;
      const tile = map.tiles[p.y]?.[p.x];
      if (!tile) continue;
      const { sx, sy } = tileToScreenShifted(p.x, p.y, map.height, ELEVATION[tile.terrain] ?? 0);
      ctx.save();
      ctx.globalAlpha = pt < 0.6 ? 1 : 1 - (pt - 0.6) / 0.4;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const py = sy - 40 - 24 * pt;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20, 20, 30, 0.85)';
      ctx.strokeText(p.text, sx, py);
      ctx.fillStyle = '#ffe082';
      ctx.fillText(p.text, sx, py);
      ctx.restore();
    }

    // ── Territory borders: one outline per CITY territory (so touching cities
    // don't fuse), drawn last ──
    drawTerritoryBorders(ctx, map, map.height, cities, visibility);

    // ── Buildings + plasma-vent labels (drawn on top of tiles) ──
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if ((visibility?.[y]?.[x] ?? 'visible') === 'hidden') continue;
        const b = buildingByPos.get(`${x},${y}`);
        if (b) { drawBuildingLabel(ctx, b, map.height); continue; }
        const tile = map.tiles[y][x];
        if (tile.resourceKind === 'plasma') drawResourceLabel(ctx, x, y, map.height, 'plasma');
      }
    }

    // ── Action boxes (found-city always; build-mine/extractor on prompt) ──
    const boxes: { rect: ScreenRect; action: Action }[] = [];
    if (mode === 'game') {
      for (const a of legalActions) {
        if (a.type === 'foundCity') {
          boxes.push({ rect: drawActionBox(ctx, a.position.x, a.position.y, map.height, 'Found City'), action: a });
        }
        if (a.type === 'captureCity') {
          const u = units.find(uu => uu.id === a.unitId);
          if (u) boxes.push({ rect: drawActionBox(ctx, u.position.x, u.position.y, map.height, 'Capture City?'), action: a });
        }
      }
      if (buildPromptTile) {
        const { x, y } = buildPromptTile;
        const a = legalActions.find(
          ac => ac.type === 'build' && (ac.kind === 'mine' || ac.kind === 'extractor') && ac.position.x === x && ac.position.y === y,
        );
        const tile = map.tiles[y]?.[x];
        if (a && tile && !buildingByPos.has(`${x},${y}`)) {
          const label = tile.resourceKind === 'plasma' ? 'Build Extractor?' : 'Build Mine?';
          boxes.push({ rect: drawActionBox(ctx, x, y, map.height, label), action: a });
        }
      }
    }
    actionBoxesRef.current = boxes;

    // ── Territory-expansion picker overlay (eligible tiles + ticks) ──
    if (mode === 'game' && territorySelect && gameState) {
      const city = gameState.cities.find(c => c.id === territorySelect.cityId);
      if (city) {
        const picks = territorySelect.picks;
        const eligible: Coord[] = [];
        if (picks.length < 3) {
          for (let yy = 0; yy < map.height; yy++) {
            for (let xx = 0; xx < map.width; xx++) {
              if (picks.some(p => p.x === xx && p.y === yy)) continue;
              if (isExpansionTileEligible(gameState, registry, city, { x: xx, y: yy }, picks)) {
                eligible.push({ x: xx, y: yy });
              }
            }
          }
        }
        drawTerritoryPicker(ctx, map, map.height, eligible, picks);
      }
    }

    // ── Hover name tooltip (unit / building / resource / ruin) ──
    if (mode === 'game' && hoveredTile) {
      const { x, y } = hoveredTile;
      const u = unitByPos.get(`${x},${y}`);
      const b = buildingByPos.get(`${x},${y}`);
      const tile = map.tiles[y]?.[x];
      const name = u ? (registry.unitTypes[u.typeId]?.name ?? u.typeId)
        : b ? b.kind
        : tile?.resourceKind ? tile.resourceKind
        : tile?.isRuin ? 'ruin'
        : null;
      if (name) drawNameBadge(ctx, x, y, map.height, name);
    }
  }, [
    map, visibility, registry, config, units, unitByPos, buildings, buildingByPos, cities, cityLevelByPos,
    selectedUnitId, hoveredTile, legalActions, moveTargets, attackTargets, mode,
    buildPromptTile, spriteTick, animTick, territorySelect, gameState, selectedUnitBlind,
    renderZoom, viewTick,
  ]);

  // Re-render whenever state changes
  useEffect(() => { render(); }, [render]);

  // Re-rasterize at the on-screen resolution when the container resizes or the
  // display DPR changes (e.g. dragging the window to another monitor).
  useEffect(() => {
    const container = canvasRef.current?.parentElement;
    if (!container) return;
    const ro = new ResizeObserver(() => setViewTick(t => t + 1));
    ro.observe(container);
    const onWin = () => setViewTick(t => t + 1);
    window.addEventListener('resize', onWin);
    return () => { ro.disconnect(); window.removeEventListener('resize', onWin); };
  }, []);

  // ── Scroll-to-zoom ──
  // Out-cap so a small map can't shrink away; in-cap ~ showing a handful of tiles.
  const minZoom = 0.5;
  const maxZoom = Math.max(2, (map?.width ?? 12) / 5);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z => Math.min(maxZoom, Math.max(minZoom, z * (e.deltaY < 0 ? 1.12 : 0.89))));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [minZoom, maxZoom]);

  // ── Mouse → tile coordinate translation ──
  const getTileFromEvent = useCallback((e: React.MouseEvent<HTMLCanvasElement>): Coord | null => {
    if (!map) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { width, height } = canvasSize(map.width, map.height);
    // Scale mouse coords from CSS-rendered size to logical canvas size
    const mx = (e.clientX - rect.left) * (width / rect.width);
    const my = (e.clientY - rect.top) * (height / rect.height);
    return screenToTile(mx, my, map);
  }, [map]);

  // ── Click handler ──
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // A drag just ended → swallow the click so panning never selects a tile.
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }

    if (mode === 'editor') {
      const t = getTileFromEvent(e);
      if (t) onPaint?.(t.x, t.y);
      return;
    }

    // Territory-expansion picker: clicks tick / untick tiles instead of selecting.
    if (territorySelect && gameState) {
      const t = getTileFromEvent(e);
      if (!t) return;
      const city = gameState.cities.find(c => c.id === territorySelect.cityId);
      if (!city) return;
      const picks = territorySelect.picks;
      const idx = picks.findIndex(p => p.x === t.x && p.y === t.y);
      if (idx >= 0) {
        const remaining = picks.filter((_, i) => i !== idx);
        setTerritorySelect({ cityId: city.id, picks: coherentSubset(gameState, registry, city, remaining) });
      } else if (picks.length < 3 && isExpansionTileEligible(gameState, registry, city, t, picks)) {
        setTerritorySelect({ cityId: city.id, picks: [...picks, { x: t.x, y: t.y }] });
      }
      return;
    }

    // 1. Did the click land on an on-canvas action box (Found City / Build …)?
    const canvas = canvasRef.current;
    if (canvas && map) {
      const rect = canvas.getBoundingClientRect();
      const { width, height } = canvasSize(map.width, map.height);
      const mx = (e.clientX - rect.left) * (width / rect.width);
      const my = (e.clientY - rect.top) * (height / rect.height);
      for (const box of actionBoxesRef.current) {
        if (pointInRect(mx, my, box.rect)) {
          executeAction(box.action);
          setBuildPromptTile(null);
          return;
        }
      }
    }

    const tile = getTileFromEvent(e);
    if (!tile) { setBuildPromptTile(null); return; }
    const key = `${tile.x},${tile.y}`;
    const unit = unitByPos.get(key);

    if (selectedUnitId != null && moveTargets.has(key)) {
      const moveAction = legalActions.find(
        a => a.type === 'move' && a.unitId === selectedUnitId && a.to.x === tile.x && a.to.y === tile.y,
      );
      if (moveAction) { executeAction(moveAction); setBuildPromptTile(null); return; }
    }
    if (selectedUnitId != null && attackTargets.has(key)) {
      executeAction(attackTargets.get(key)!);
      setBuildPromptTile(null);
      return;
    }
    if (unit) {
      // Select any visible unit (own or enemy) to inspect it. Own units also get
      // their move/attack highlights; enemy selection is inspection-only.
      selectUnit(unit.id === selectedUnitId ? null : unit.id);
      setBuildPromptTile(null);
      return;
    }

    // Clicked any city tile → select it (shows the pop/supply info box; owned
    // empty cities additionally get the recruit panel via MapView).
    const here = map?.tiles[tile.y]?.[tile.x];
    if (here?.isCity) {
      setSelectedCity({ x: tile.x, y: tile.y });
      setBuildPromptTile(null);
      return;
    }

    // 2. Clicked an ore/plasma tile where a mine/extractor can be built → prompt.
    const buildable = legalActions.some(
      a => a.type === 'build' && (a.kind === 'mine' || a.kind === 'extractor') && a.position.x === tile.x && a.position.y === tile.y,
    );
    if (buildable) { setBuildPromptTile(tile); selectUnit(null); return; }

    selectUnit(null);
    setBuildPromptTile(null);
  }, [
    mode, getTileFromEvent, map, unitByPos, selectedUnitId, currentPlayer,
    moveTargets, attackTargets, legalActions, executeAction, selectUnit, setSelectedCity, onPaint,
    territorySelect, setTerritorySelect, gameState, registry,
  ]);

  // ── Hover / drag-pan handler ──
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === 'game') {
      const d = dragRef.current;
      if (d && onPanChange) {
        const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
        if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
        if (d.moved) {
          onPanChange(clampPan(d.panX + dx, d.panY + dy));
          setHoveredTile(null);
          return;
        }
      }
      setHoveredTile(getTileFromEvent(e));
      return;
    }

    // Editor: paint on drag.
    const tile = getTileFromEvent(e);
    if (paintingRef.current && tile) onPaint?.(tile.x, tile.y);
  }, [mode, getTileFromEvent, setHoveredTile, onPaint, onPanChange, clampPan]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === 'editor') {
      paintingRef.current = true;
      const tile = getTileFromEvent(e);
      if (tile) onPaint?.(tile.x, tile.y);
      return;
    }
    // Game: begin a potential pan drag (promoted to a pan once it moves).
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan?.x ?? 0, panY: pan?.y ?? 0, moved: false };
  }, [mode, getTileFromEvent, onPaint, pan]);

  const handleMouseUp = useCallback(() => {
    paintingRef.current = false;
    const d = dragRef.current;
    if (d && d.moved) suppressClickRef.current = true;
    dragRef.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    paintingRef.current = false;
    dragRef.current = null;
    if (mode === 'game') setHoveredTile(null);
  }, [mode, setHoveredTile]);

  if (!map) return null;

  const { width, height } = canvasSize(map.width, map.height);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        // Display size (canvas.style.width/height) is set imperatively in render()
        // — a single uniform fitScale for both axes, so the browser never clamps
        // them independently (which previously distorted the 2:1 geometry ~16-19%
        // and stepped the floor). maxWidth/maxHeight are a harmless overflow guard:
        // the explicit sizes are already ≤ the container, so they never clamp.
        maxWidth: '100%',
        maxHeight: '100%',
        cursor: 'pointer',
        // translate = pan (screen px, outside the zoom); scale = zoom. `position:
        // relative` keeps the canvas painting above the absolute starfield behind
        // it while staying below the absolutely-positioned UI overlays.
        position: 'relative',
        transform: `translate(${pan?.x ?? 0}px, ${pan?.y ?? 0}px) scale(${zoom})`,
        transformOrigin: 'center center',
      }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    />
  );
}
