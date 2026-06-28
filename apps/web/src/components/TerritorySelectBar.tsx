import React from 'react';
import { useGameStore } from '../store/gameStore.js';

/**
 * Bottom-of-map bar shown while expanding a city's territory (L4 reward).
 * The actual tile ticking happens on the map (IsoCanvas); this just shows the
 * 0/3 counter and the Confirm / Cancel controls.
 */
export function TerritorySelectBar() {
  const { territorySelect, executeAction, setTerritorySelect } = useGameStore();
  if (!territorySelect) return null;

  const { cityId, picks } = territorySelect;
  const done = picks.length === 3;

  return (
    <div className="territory-bar">
      <div className="territory-count">
        Territory <b>{picks.length}/3</b>
      </div>
      <div className="territory-hint">
        Click open tiles touching your border (need ≥2 of your own surrounding tiles). Click a green tick to remove it.
      </div>
      <div className="territory-actions">
        <button className="ghost" onClick={() => setTerritorySelect(null)}>Cancel</button>
        <button
          className="primary"
          disabled={!done}
          onClick={() => done && executeAction({ type: 'expandTerritory', cityId, tiles: picks })}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
