import React from 'react';
import { useGameStore } from '../../store/gameStore.js';
import { VoxelArena } from './VoxelArena.js';
import type { Facing, UnitView } from './types.js';
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

/**
 * Store adapter for the voxel3d renderer. Reads engine state from the game
 * store and derives the VoxelArena props. Built fresh for the voxel pipeline —
 * intentionally shares no code with the 2D iso renderer.
 */
export function VoxelMapView() {
  const { visibleState } = useGameStore();

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
      };
    });
  }, [visibleState]);

  if (!visibleState) return null;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <VoxelArena
        map={visibleState.map}
        units={unitViews}
        highlights={[]}
        quality={quality}
        visibility={visibleState.visibility}
      />
    </div>
  );
}
