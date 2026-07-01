import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { previewCombat, isExpansionTileEligible, buildingBlocked, canBuildLocation } from '@tactica/engine';
import type { Coord, Unit, Action, BuildingKind } from '@tactica/engine';

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
import { canvasSize, screenToTile } from './projection.js';
import { drawTile } from './drawTile.js';
import { drawUnitAt } from './drawUnit.js';
import { loadTileSprites } from './tileSprites.js';
import {
  drawMoveHighlight,
  drawAttackHighlight,
  drawFogExplored,
  drawCloud,
  drawDamagePreview,
  drawGridLabel,
  drawTerritoryBorders,
  drawTerritoryPicker,
  drawTileOutline,
} from './drawOverlays.js';
import {
  drawBuildingLabel, drawResourceLabel, drawActionBox, drawNameBadge, pointInRect,
  drawBlockedMark,
  type ScreenRect,
} from './drawEconomy.js';

// Prompt labels for each buildable structure (shown in the on-canvas build box).
const BUILD_LABELS: Record<string, string> = {
  mine: 'Build Mine?',
  extractor: 'Build Extractor?',
  refinery: 'Build Refinery?',
  purifier: 'Build Purifier?',
};

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

  // Scroll-to-zoom factor (applied as a CSS transform; clicking stays accurate
  // because hit-testing uses the canvas's on-screen bounding box).
  const [zoom, setZoom] = useState(1);

  // Tile the player clicked an ore/plasma resource on → show its "Build …?" box.
  const [buildPromptTile, setBuildPromptTile] = useState<Coord | null>(null);
  // Action boxes drawn this frame (found-city / build), kept for click hit-testing.
  const actionBoxesRef = useRef<{ rect: ScreenRect; action: Action; disabled?: boolean }[]>([]);

  const {
    gameState, visibleState, registry, config,
    selectedUnitId, hoveredTile, legalActions, inspectedTile,
    selectUnit, setSelectedCity, setHoveredTile, executeAction, setInspectedTile,
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

  // First structure the current player could build on a tile, ignoring whether they
  // can currently afford it (so a valid site still shows its prompt when short on ore).
  const buildKindAt = useCallback((pos: Coord): BuildingKind | null => {
    if (mode !== 'game' || !gameState) return null;
    for (const k of ['mine', 'extractor', 'refinery', 'purifier'] as const) {
      if (canBuildLocation(gameState, registry, currentPlayer, k, pos)) return k;
    }
    return null;
  }, [mode, gameState, registry, currentPlayer]);

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

        // Hidden (undiscovered) tiles: cover with a white cloud. A selected blind
        // unit still shows its move targets (blue) on the cloud so it can advance.
        if (vis === 'hidden') {
          drawCloud(ctx, x, y, map.height);
          // 'plains' → flat (elevation 0), so the blue diamond sits on the flat cloud.
          if (selectedUnitBlind && moveTargets.has(key)) drawMoveHighlight(ctx, x, y, map.height, 'plains');
          continue;
        }

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
    drawTerritoryBorders(ctx, map, map.height, cities, visibility);

    // ── Buildings + plasma-vent labels (drawn on top of tiles) ──
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if ((visibility?.[y]?.[x] ?? 'visible') === 'hidden') continue;
        const b = buildingByPos.get(`${x},${y}`);
        if (b) {
          drawBuildingLabel(ctx, b, map.height);
          // Enemy sitting on a REB blocks its output → red ✕ on the bottom-right.
          if (gameState && buildingBlocked(gameState, b)) drawBlockedMark(ctx, x, y, map.height);
          continue;
        }
        const tile = map.tiles[y][x];
        if (tile.resourceKind === 'plasma') drawResourceLabel(ctx, x, y, map.height, 'plasma');
      }
    }

    // ── Action boxes (found-city always; build-mine/extractor on prompt) ──
    const boxes: { rect: ScreenRect; action: Action; disabled?: boolean }[] = [];
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
      if (buildPromptTile && gameState) {
        const { x, y } = buildPromptTile;
        const kind = buildKindAt({ x, y });
        if (kind && !buildingByPos.has(`${x},${y}`)) {
          const def = registry.economy.buildings[kind];
          const ore = def?.costByLevel?.[0] ?? 0;
          const plasma = def?.plasmaCostByLevel?.[0] ?? 0;
          const player = gameState.players[currentPlayer];
          const affordable = player.ore >= ore && player.plasma >= plasma;
          const label = BUILD_LABELS[kind] ?? 'Build?';
          const cost = `${ore}◈${plasma > 0 ? ` ${plasma}✦` : ''}`;
          const action: Action = { type: 'build', kind, position: { x, y } };
          boxes.push({
            rect: drawActionBox(ctx, x, y, map.height, label, cost, !affordable),
            action,
            disabled: !affordable,
          });
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

    // ── Inspected-tile outline (the tile whose info box is open) ──
    if (mode === 'game' && inspectedTile) {
      const t = map.tiles[inspectedTile.y]?.[inspectedTile.x];
      if (t) drawTileOutline(ctx, inspectedTile.x, inspectedTile.y, map.height, t.terrain, '#ffd24a');
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
    map, visibility, registry, config, units, unitByPos, buildings, buildingByPos, cities,
    selectedUnitId, hoveredTile, legalActions, moveTargets, attackTargets, mode,
    buildPromptTile, spriteTick, animTick, territorySelect, gameState, selectedUnitBlind, inspectedTile,
    buildKindAt, currentPlayer,
  ]);

  // Re-render whenever state changes
  useEffect(() => { render(); }, [render]);

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
          if (box.disabled) return; // valid build site but unaffordable → no-op, keep the prompt
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
    // A tile can hold a build site (any REB — mine/extractor on a resource tile,
    // refinery/purifier on a land tile). Shown even if currently unaffordable, and
    // even when a unit stands on the tile.
    const buildable = buildKindAt(tile) !== null;

    if (unit) {
      // Click-cycling: the FIRST click on a tile with a unit selects the unit
      // (own units also get move/attack highlights; enemy selection is
      // inspection-only). Clicking the SAME unit's tile AGAIN falls through to
      // the tile itself — its terrain info box, and any resource build prompt —
      // so a resource under a unit is still reachable. See docs/DEVELOPMENT_RATIONALE.md.
      if (unit.id !== selectedUnitId) {
        selectUnit(unit.id);
        setBuildPromptTile(null);
        return;
      }
      // second click on the already-selected unit → inspect its tile
      setInspectedTile({ x: tile.x, y: tile.y });
      setBuildPromptTile(buildable ? tile : null);
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

    // Empty tile (no unit, no city): inspect it — show the terrain info box, and
    // a build prompt if it's a buildable resource tile.
    selectUnit(null);
    setInspectedTile({ x: tile.x, y: tile.y });
    setBuildPromptTile(buildable ? tile : null);
  }, [
    mode, getTileFromEvent, map, unitByPos, selectedUnitId, currentPlayer,
    moveTargets, attackTargets, legalActions, executeAction, selectUnit, setSelectedCity, onPaint,
    territorySelect, setTerritorySelect, gameState, registry, setInspectedTile, buildKindAt,
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
        transform: `scale(${zoom})`,
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
