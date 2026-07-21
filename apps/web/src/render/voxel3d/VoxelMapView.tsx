import React from 'react';
import type { Action } from '@tactica/engine';
import { useGameStore } from '../../store/gameStore.js';
import { VoxelArena } from './VoxelArena.js';
import { VoxelErrorBoundary } from './VoxelErrorBoundary.js';
import type { Facing, TileHighlight, UnitView } from './types.js';
import { TEAM_COLORS } from './palette.js';

/** Fresh facing derivation for the voxel pipeline (render-side only). */
function facingFromDelta(dx: number, dy: number): Facing | null {
  if (dx > 0) return 'se';
  if (dx < 0) return 'nw';
  if (dy > 0) return 'sw';
  if (dy < 0) return 'ne';
  return null;
}

const DEFAULT_FACING: Facing = 'se';

interface Targets {
  move: Map<string, Action>;
  attack: Map<string, Action>;
  slash: Map<string, Action>;
  ability: Map<string, Action>;
}

/**
 * Store adapter for the voxel3d renderer. Reads engine state from the game
 * store and derives the VoxelArena props. Built fresh for the voxel pipeline —
 * intentionally shares no code with the 2D iso renderer.
 *
 * Highlight semantics: legal moves → 'move' (green), attack/slash targets →
 * 'threat' (red), the selected unit's own tile → 'select' (cyan), armed-ability
 * targets → 'path' (amber).
 */
export function VoxelMapView() {
  const {
    visibleState, legalActions, selectedUnitId, abilityMode,
    selectUnit, executeAction, setSelectedCity, setInspectedTile,
  } = useGameStore();

  const quality = React.useMemo<'high' | 'low'>(
    () => (new URLSearchParams(window.location.search).get('quality') === 'low' ? 'low' : 'high'),
    [],
  );

  // Facing is remembered per unit and updated from move deltas.
  const facingsRef = React.useRef(new Map<number, Facing>());
  const prevPosRef = React.useRef(new Map<number, { x: number; y: number }>());

  const unitViews = React.useMemo<UnitView[]>(() => {
    if (!visibleState) return [];
    const facings = facingsRef.current;
    const prev = prevPosRef.current;
    return visibleState.units.map(u => {
      const last = prev.get(u.id);
      if (last) {
        const f = facingFromDelta(u.position.x - last.x, u.position.y - last.y);
        if (f) facings.set(u.id, f);
      }
      prev.set(u.id, { x: u.position.x, y: u.position.y });
      return {
        id: u.id,
        gridPos: { x: u.position.x, y: u.position.y },
        facing: facings.get(u.id) ?? DEFAULT_FACING,
        teamColor: TEAM_COLORS[u.owner % TEAM_COLORS.length],
        kind: u.typeId,
        hostile: u.owner !== visibleState.currentPlayer,
      };
    });
  }, [visibleState]);

  // Target tiles for the selected unit / armed ability, straight from the
  // engine's legal-action list (the engine has no separate "threat map").
  const targets = React.useMemo<Targets>(() => {
    const t: Targets = { move: new Map(), attack: new Map(), slash: new Map(), ability: new Map() };
    if (!visibleState) return t;
    for (const action of legalActions) {
      if (action.type === 'move' && action.unitId === selectedUnitId) {
        // A bump move targets the impassable tile it reveals, matching engine rules.
        const to = action.bumpReveal ?? action.to;
        t.move.set(`${to.x},${to.y}`, action);
      } else if (action.type === 'attack' && action.unitId === selectedUnitId) {
        const target = visibleState.units.find(u => u.id === action.targetId);
        if (target) t.attack.set(`${target.position.x},${target.position.y}`, action);
      } else if (action.type === 'slash' && action.unitId === selectedUnitId) {
        t.slash.set(`${action.target.x},${action.target.y}`, action);
      } else if (
        abilityMode &&
        action.type === 'useAbility' &&
        action.unitId === abilityMode.unitId &&
        action.abilityId === abilityMode.abilityId
      ) {
        t.ability.set(`${action.target.x},${action.target.y}`, action);
      }
    }
    return t;
  }, [visibleState, legalActions, selectedUnitId, abilityMode]);

  const highlights = React.useMemo<TileHighlight[]>(() => {
    const list: TileHighlight[] = [];
    const push = (key: string, kind: TileHighlight['kind']) => {
      const [x, y] = key.split(',').map(Number);
      list.push({ x, y, kind });
    };
    for (const key of targets.move.keys()) push(key, 'move');
    for (const key of targets.attack.keys()) push(key, 'threat');
    for (const key of targets.slash.keys()) push(key, 'threat');
    for (const key of targets.ability.keys()) push(key, 'path');
    const selected = visibleState?.units.find(u => u.id === selectedUnitId);
    if (selected) list.push({ x: selected.position.x, y: selected.position.y, kind: 'select' });
    return list;
  }, [targets, visibleState, selectedUnitId]);

  // Same interaction contract as the 2D renderer's click priority:
  // ability target → move → attack/slash → unit select → city → inspect.
  const onTileClick = React.useCallback((x: number, y: number) => {
    const key = `${x},${y}`;
    const act = targets.ability.get(key) ?? targets.move.get(key)
      ?? targets.attack.get(key) ?? targets.slash.get(key);
    if (act) {
      executeAction(act);
      return;
    }
    const unit = visibleState?.units.find(u => u.position.x === x && u.position.y === y);
    if (unit && unit.id !== selectedUnitId) {
      selectUnit(unit.id);
      return;
    }
    const tile = visibleState?.map.tiles[y]?.[x];
    if (tile?.isCity) {
      setSelectedCity({ x, y });
      return;
    }
    selectUnit(null);
    setInspectedTile({ x, y });
  }, [targets, visibleState, selectedUnitId, executeAction, selectUnit, setSelectedCity, setInspectedTile]);

  if (!visibleState) return null;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <VoxelErrorBoundary>
        <VoxelArena
          map={visibleState.map}
          units={unitViews}
          highlights={highlights}
          quality={quality}
          onTileClick={onTileClick}
          visibility={visibleState.visibility}
        />
      </VoxelErrorBoundary>
    </div>
  );
}
