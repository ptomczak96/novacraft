import React from 'react';
import { useGameStore } from '../store/gameStore.js';

/**
 * Prompt shown when a detecting friendly unit is selected and the player clicks a friendly
 * ally carrying a (visible) Tracer / Explosives mark. Confirming removes the mark and spends
 * the remover's attack/cast for the turn.
 */
export function MarkRemovalBar() {
  const { markRemoval, setMarkRemoval, executeAction } = useGameStore();
  if (!markRemoval) return null;
  const { removerId, target, kind } = markRemoval;
  const label = kind === 'tracer' ? 'tracer round' : 'explosives';

  return (
    <div className="territory-bar">
      <div className="territory-count">Remove {label}?</div>
      <div className="territory-hint">Defusing spends this unit’s attack/cast for the turn (it can still have moved first).</div>
      <div className="territory-actions">
        <button className="ghost" onClick={() => setMarkRemoval(null)}>Cancel</button>
        <button
          className="primary"
          onClick={() => { setMarkRemoval(null); executeAction({ type: 'removeMark', unitId: removerId, target, kind }); }}
        >
          Remove {label}
        </button>
      </div>
    </div>
  );
}
