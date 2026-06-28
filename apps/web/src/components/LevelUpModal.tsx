import React, { useState, useEffect } from 'react';
import type { Action } from '@tactica/engine';
import { useGameStore } from '../store/gameStore.js';

type LevelUpAction = Extract<Action, { type: 'levelUpCity' }>;

// Display metadata per reward. `ready: false` options are designed but their
// effect lands in a later group (reveal → fog, territory → tile picker); they
// show disabled so the player can't pick an inert reward.
const CHOICE_META: Record<string, { label: string; desc: string; icon: string; ready: boolean }> = {
  income:    { label: 'City Income +30', desc: '+30 ore every turn, permanently — kept even if the city is captured.', icon: '💰', ready: true },
  pop:       { label: '+1 Population',    desc: '+1 unit capacity here, stacking on top of the normal per-level gain.', icon: '🧍', ready: true },
  fortify:   { label: 'Fortify',          desc: 'Units defending inside this city gain a ×1.5 defence bonus.', icon: '🛡️', ready: true },
  reveal:    { label: 'Reveal Map',       desc: 'Reveal fog toward the nearest enemy city.', icon: '🔭', ready: false },
  supply:    { label: '+3 Supply',        desc: 'Permanently add 3 supply toward this city’s future levels.', icon: '🏭', ready: true },
  territory: { label: 'Expand Territory', desc: 'Claim 3 new tiles for this city’s territory.', icon: '🗺️', ready: false },
};

export function LevelUpModal() {
  const { gameState, legalActions, executeAction, botSettings } = useGameStore();
  const [dismissed, setDismissed] = useState<number[]>([]);

  const turn = gameState?.turn;
  const cur = gameState?.currentPlayer;
  // Clear "decide later" choices at the start of each player's turn.
  useEffect(() => { setDismissed([]); }, [turn, cur]);

  if (!gameState || cur == null) return null;
  if (botSettings[cur] !== 'human') return null; // never interrupt a bot turn

  const levelUps = legalActions.filter((a): a is LevelUpAction => a.type === 'levelUpCity');
  if (levelUps.length === 0) return null;

  // Show one city at a time; skip any the player chose to defer this turn.
  const cityId = levelUps.map(a => a.cityId).find(id => !dismissed.includes(id));
  if (cityId == null) return null;
  const city = gameState.cities.find(c => c.id === cityId);
  if (!city) return null;

  const targetLevel = city.level + 1;
  const actions = levelUps.filter(a => a.cityId === cityId);

  return (
    <div className="levelup-overlay">
      <div className="levelup-modal">
        <div className="levelup-title">Congratulations!</div>
        <div className="levelup-sub">
          Your {city.isCapital ? 'capital' : 'city'} has reached <b>level {targetLevel}</b>.
        </div>
        <div className="levelup-choose">Choose one:</div>
        <div className="levelup-options">
          {actions.map(action => {
            const meta = CHOICE_META[action.choice];
            if (!meta) return null;
            return (
              <button
                key={action.choice}
                className="levelup-option"
                disabled={!meta.ready}
                onClick={() => meta.ready && executeAction(action)}
              >
                <div className="levelup-opt-icon" aria-hidden>{meta.icon}</div>
                <div className="levelup-opt-label">{meta.label}</div>
                <div className="levelup-opt-desc">{meta.desc}</div>
                {!meta.ready && <div className="levelup-opt-soon">Coming soon</div>}
              </button>
            );
          })}
        </div>
        <button className="levelup-later" onClick={() => setDismissed(d => [...d, cityId])}>
          Decide later
        </button>
      </div>
    </div>
  );
}
