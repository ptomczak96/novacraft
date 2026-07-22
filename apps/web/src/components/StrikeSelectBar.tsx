import React from 'react';
import { useGameStore } from '../store/gameStore.js';

/**
 * Bottom-of-map bar shown while aiming the Wyrm's Body Slam.
 * Tile ticking happens on the map (IsoCanvas); this shows the 0/2 counter and the
 * Continue / Cancel controls. Continue fires the slam with the 2 chosen cells
 * (primary = 100% damage, secondary = 50%). You must pick both.
 */
export function StrikeSelectBar() {
  const { strikeSelect, executeAction, setStrikeSelect } = useGameStore();
  if (!strikeSelect) return null;

  const { unitId, picks } = strikeSelect;
  const done = picks.length === 2;

  return (
    <div className="territory-bar">
      <div className="territory-count">
        Body Slam <b>{picks.length}/2</b>
      </div>
      <div className="territory-hint">
        Pick a first tile (in the Wyrm's 3×3), then a touching second tile — you must pick both. First hits for 100%, second for 50% (friend or foe). Click a tick to remove it.
      </div>
      <div className="territory-actions">
        <button className="ghost" onClick={() => setStrikeSelect(null)}>Cancel</button>
        <button
          className="primary"
          disabled={!done}
          onClick={() => done && executeAction({ type: 'wyrmStrike', unitId, tiles: picks })}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
