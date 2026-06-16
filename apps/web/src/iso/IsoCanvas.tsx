import React, { useRef, useEffect, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { previewCombat } from '@tactica/engine';
import type { Coord, Unit, Action } from '@tactica/engine';

import { ELEVATION, BG_COLOR } from './constants.js';
import { canvasSize, screenToTile } from './projection.js';
import { drawTile } from './drawTile.js';
import { drawUnitAt } from './drawUnit.js';
import {
  drawMoveHighlight,
  drawAttackHighlight,
  drawFogExplored,
  drawDamagePreview,
  drawGridLabel,
} from './drawOverlays.js';

interface IsoCanvasProps {
  mode: 'game' | 'editor';
  /** Editor: called on single click / drag paint */
  onPaint?: (x: number, y: number) => void;
}

export function IsoCanvas({ mode, onPaint }: IsoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);

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
  const currentPlayer = state?.currentPlayer ?? 0;

  // ── Build unit position map ──
  const unitByPos = React.useMemo(() => {
    const m = new Map<string, Unit>();
    for (const u of units) {
      m.set(`${u.position.x},${u.position.y}`, u);
    }
    return m;
  }, [units]);

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
          drawUnitAt(ctx, unit, map.height, elev, registry, unit.id === selectedUnitId);
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
  }, [
    map, visibility, registry, config, units, unitByPos,
    selectedUnitId, hoveredTile, legalActions, moveTargets, attackTargets, mode,
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
    const tile = getTileFromEvent(e);
    if (!tile) return;

    if (mode === 'editor') {
      onPaint?.(tile.x, tile.y);
      return;
    }

    // Game mode click logic (same as old MapView)
    const key = `${tile.x},${tile.y}`;
    const unit = unitByPos.get(key);

    if (selectedUnitId != null && moveTargets.has(key)) {
      const moveAction = legalActions.find(
        a => a.type === 'move' && a.unitId === selectedUnitId && a.to.x === tile.x && a.to.y === tile.y,
      );
      if (moveAction) { executeAction(moveAction); return; }
    }

    if (selectedUnitId != null && attackTargets.has(key)) {
      const action = attackTargets.get(key)!;
      executeAction(action);
      return;
    }

    if (unit && unit.owner === currentPlayer) {
      selectUnit(unit.id === selectedUnitId ? null : unit.id);
    } else {
      selectUnit(null);
    }
  }, [
    mode, getTileFromEvent, unitByPos, selectedUnitId, currentPlayer,
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
