import React from 'react';
import { useGameStore } from '../store/gameStore.js';

/**
 * Confirmation shown when a node-building Engineer is told to move or use an active.
 * Yes → cancels the half-built node (the deferred action is then dispatched, which the
 * engine treats as cancelling construction). No → keep building.
 */
export function NodeCancelDialog() {
  const { pendingNodeCancel, setPendingNodeCancel, executeAction } = useGameStore();
  if (!pendingNodeCancel) return null;

  return (
    <div className="levelup-overlay">
      <div className="levelup-modal">
        <div className="levelup-title">Cancel Node construction?</div>
        <p className="levelup-sub">This Engineer is building a Node. Moving or acting will destroy the half-built Node.</p>
        <div className="setup-actions" style={{ marginTop: 16, justifyContent: 'center' }}>
          <button
            className="primary"
            onClick={() => { const a = pendingNodeCancel; setPendingNodeCancel(null); executeAction(a); }}
          >
            Yes, cancel it
          </button>
          <button className="ghost" onClick={() => setPendingNodeCancel(null)}>Keep building</button>
        </div>
      </div>
    </div>
  );
}
