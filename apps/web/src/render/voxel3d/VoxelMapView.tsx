import React from 'react';
import { useGameStore } from '../../store/gameStore.js';
import { VoxelArena } from './VoxelArena.js';

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

  if (!visibleState) return null;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <VoxelArena
        map={visibleState.map}
        units={[]}
        highlights={[]}
        quality={quality}
        visibility={visibleState.visibility}
      />
    </div>
  );
}
