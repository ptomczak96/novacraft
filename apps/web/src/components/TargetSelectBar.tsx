import React from 'react';
import { useGameStore } from '../store/gameStore.js';

/**
 * Bottom-of-map bar shown while picking targets for a multi-unit ability (Cure / Repair).
 * Tile ticking happens on the map (IsoCanvas); this shows the count and Confirm / Cancel.
 * You may pick 1..maxTargets distinct eligible allies, then Confirm to cast.
 */
export function TargetSelectBar() {
  const { targetSelect, executeAction, setTargetSelect } = useGameStore();
  if (!targetSelect) return null;

  const { unitId, abilityId, name, maxTargets, picks } = targetSelect;
  const ready = picks.length >= 1;

  return (
    <div className="territory-bar">
      <div className="territory-count">
        {name} <b>{picks.length}/{maxTargets}</b>
      </div>
      <div className="territory-hint">
        Click up to {maxTargets} highlighted friendly unit{maxTargets === 1 ? '' : 's'} in range. Click a tick to remove it, then Confirm.
      </div>
      <div className="territory-actions">
        <button className="ghost" onClick={() => setTargetSelect(null)}>Cancel</button>
        <button
          className="primary"
          disabled={!ready}
          onClick={() => ready && executeAction({ type: 'useAbility', unitId, abilityId, target: picks[0], targets: picks })}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
