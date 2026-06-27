import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { previewCombat } from '@tactica/engine';
import type { Coord, Unit, Action } from '@tactica/engine';

import { ELEVATION, BG_COLOR } from './constants.js';
import { canvasSize, screenToTile } from './projection.js';
import { drawTile } from './drawTile.js';
import { drawUnitAt } from './drawUnit.js';
import { loadTileSprites } from './tileSprites.js';
import {
  drawMoveHighlight,
  drawAttackHighlight,
  drawFogExplored,
  drawDamagePreview,
  drawGridLabel,
  drawTerritoryBorders,
} from './drawOverlays.js';
import {
  drawBuildingLabel, drawResourceLabel, drawActionBox, drawNameBadge, pointInRect,
  type ScreenRect,
} from './drawEconomy.js';

interface IsoCanvasProps {
  mode: 'game' | 'editor';
  /** Editor: called on single click / drag paint */
  onPaint?: (x: number, y: number) => void;
}

export function IsoCanvas({ mode, onPaint }: IsoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);

  // Bumped once tile sprites finish loading, to force a re-render with images.
  const [spriteTick, setSpriteTick] = useState(0);
  useEffect(() => {
    loadTileSprites(() => setSpriteTick(t => t + 1));
  }, []);

  // ── Unit move animation (simple glide) ──
  // When a unit's tile changes, glide it from old → new over MOVE_ANIM_MS by
  // drawing it at fractional tile coords. A rAF loop bumps animTick to redraw.
  const MOVE_ANIM_MS = 250;
  const animsRef = useRef<Map<number, { fx: number; fy: number; tx: number; ty: number; start: number }>>(new Map());
  const prevPosRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const rafRef = useRef<number | undefined>(undefined);
  const [animTick, setAnimTick] = useState(0);

  // Tile the player clicked an ore/plasma resource on → show its "Build …?" box.
  const [buildPromptTile, setBuildPromptTile] = useState<Coord | null>(null);
  // Action boxes drawn this frame (found-city / build), kept for click hit-testing.
  const actionBoxesRef = useRef<{ rect: ScreenRect; action: Action }[]>([]);

  const {
    gameState, visibleState, registry, config,
    selectedUnitId, hoveredTile, legalActions,
    selectUnit, setHoveredTile, executeAction,
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
      }
      prevPosRef.current.set(u.id, { x: u.position.x, y: u.position.y });
    }
    // Forget units that no longer exist.
    for (const id of [...prevPosRef.current.keys()]) {
      if (!live.has(id)) { prevPosRef.current.delete(id); animsRef.current.delete(id); }
    }
    // Kick the animation loop if needed.
    if (animsRef.current.size > 0 && rafRef.current === undefined) {
      const step = () => {
        const t = performance.now();
        for (const [id, a] of animsRef.current) {
          if (t - a.start >= MOVE_ANIM_MS) animsRef.current.delete(id);
        }
        setAnimTick(v => v + 1); // force redraw
        rafRef.current = animsRef.current.size > 0 ? requestAnimationFrame(step) : undefined;
      };
      rafRef.current = requestAnimationFrame(step);
    }
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

  // ── Render the full scene ──
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvasSize(map.width, map.height);

    // Set canvas size (retina)
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    // ── Painter's algorithm: row 0→H, col 0→W ──
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y][x];
        const vis = visibility?.[y]?.[x] ?? 'visible';
        const key = `${x},${y}`;

        // Hidden tiles: skip entirely (dark background shows through)
        if (vis === 'hidden') continue;

        // ── 1. Draw tile prism ──
        drawTile(ctx, tile, x, y, map.height, registry);

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
          drawUnitAt(ctx, unit, map.height, elev, registry, unit.id === selectedUnitId, posOverride);
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

    // ── Territory borders: one outline per CITY territory (so touching cities
    // don't fuse), drawn last ──
    drawTerritoryBorders(ctx, map, map.height, cities);

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
    map, visibility, registry, config, units, unitByPos, buildings, buildingByPos, cities,
    selectedUnitId, hoveredTile, legalActions, moveTargets, attackTargets, mode,
    buildPromptTile, spriteTick, animTick,
  ]);

  // Re-render whenever state changes
  useEffect(() => { render(); }, [render]);

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
    if (mode === 'editor') {
      const t = getTileFromEvent(e);
      if (t) onPaint?.(t.x, t.y);
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
    if (unit && unit.owner === currentPlayer) {
      selectUnit(unit.id === selectedUnitId ? null : unit.id);
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
    moveTargets, attackTargets, legalActions, executeAction, selectUnit, onPaint,
  ]);

  // ── Hover handler ──
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const tile = getTileFromEvent(e);

    if (mode === 'editor' && paintingRef.current && tile) {
      onPaint?.(tile.x, tile.y);
    }

    if (mode === 'game') {
      setHoveredTile(tile);
    }
  }, [mode, getTileFromEvent, setHoveredTile, onPaint]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === 'editor') {
      paintingRef.current = true;
      const tile = getTileFromEvent(e);
      if (tile) onPaint?.(tile.x, tile.y);
    }
  }, [mode, getTileFromEvent, onPaint]);

  const handleMouseUp = useCallback(() => {
    paintingRef.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    paintingRef.current = false;
    if (mode === 'game') setHoveredTile(null);
  }, [mode, setHoveredTile]);

  if (!map) return null;

  const { width, height } = canvasSize(map.width, map.height);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        maxWidth: '100%',
        maxHeight: '100%',
        width,
        height,
        cursor: 'pointer',
      }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    />
  );
}
