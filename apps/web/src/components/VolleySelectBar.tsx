import React from 'react';
import { useGameStore } from '../store/gameStore.js';

/**
 * Bottom-of-map bar shown while aiming the Titan's Ballistic Volley.
 * Tile ticking happens on the map (IsoCanvas); this shows the 0/4 counter and the
 * Confirm / Cancel controls. Confirm fires the ability with the 4 chosen tiles.
 */
export function VolleySelectBar() {
  const { volleySelect, executeAction, setVolleySelect } = useGameStore();
  if (!volleySelect) return null;

  const { unitId, abilityId, picks } = volleySelect;
  const done = picks.length === 4;

  return (
    <div className="territory-bar">
      <div className="territory-count">
        Ballistic Volley <b>{picks.length}/4</b>
      </div>
      <div className="territory-hint">
        Pick a 2×2 square at range 2–3. Every unit inside — friend or foe — takes a 2-attack hit. Click a tick to remove it.
      </div>
      <div className="territory-actions">
        <button className="ghost" onClick={() => setVolleySelect(null)}>Cancel</button>
        <button
          className="primary"
          disabled={!done}
          onClick={() => done && executeAction({
            type: 'useAbility', unitId, abilityId,
            target: { ...picks[0] }, tiles: picks,
          })}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
