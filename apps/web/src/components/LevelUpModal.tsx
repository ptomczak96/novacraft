import React, { useState, useEffect } from 'react';
import type { Action, LevelUpChoice } from '@tactica/engine';
import { levelUpChoices } from '@tactica/engine';
import { useGameStore } from '../store/gameStore.js';

// Display metadata per reward. Territory routes into a follow-up tile picker. `hero` is always
// greyed out for now (no heroes yet; only one living hero allowed).
const CHOICE_META: Record<LevelUpChoice, { label: string; desc: string; icon: string }> = {
  income:      { label: 'City Income +20', desc: '+20 ore every turn, permanently — kept even if the city is captured.', icon: '💰' },
  pop:         { label: '+1 Population',    desc: '+1 unit capacity here, stacking on top of the normal per-level gain.', icon: '🧍' },
  fortify:     { label: 'Fortify',          desc: 'City walls: units defending on the city tile gain ×3 defence (vs ×1.5 in a normal city).', icon: '🛡️' },
  beacon:      { label: 'Beacon',           desc: 'City sight radius +1 — it now sees the 5×5 around it.', icon: '📡' },
  supply:      { label: '+3 Supply',        desc: 'Permanently add 3 supply toward this city’s future levels.', icon: '🏭' },
  territory:   { label: 'Expand Territory', desc: 'Claim 3 new tiles for this city’s territory.', icon: '🗺️' },
  muster:      { label: 'Muster',           desc: 'Units recruited here may MOVE the turn they’re built (they still can’t attack).', icon: '🏃' },
  detect:      { label: 'Detect',           desc: 'Exposes cloaked & burrowed enemy units within this city’s 3×3.', icon: '🛰️' },
  conscription:{ label: 'Conscription',     desc: 'Units recruited here cost 20% less ore.', icon: '📜' },
  plasma:      { label: '+10 Plasma',       desc: '+10 plasma every turn, permanently.', icon: '🔥' },
  hero:        { label: 'Hero',             desc: 'Recruit a Hero. Coming soon — and you may only have one living hero at a time.', icon: '⭐' },
};

export function LevelUpModal() {
  const { gameState, legalActions, executeAction, botSettings, territorySelect, setTerritorySelect } = useGameStore();
  const [dismissed, setDismissed] = useState<number[]>([]);

  const turn = gameState?.turn;
  const cur = gameState?.currentPlayer;
  // Clear "decide later" choices at the start of each player's turn.
  useEffect(() => { setDismissed([]); }, [turn, cur]);

  if (!gameState || cur == null) return null;
  if (botSettings[cur] !== 'human') return null; // never interrupt a bot turn
  if (territorySelect) return null; // hidden while the territory picker is open

  // A city can level up if it has ANY levelUpCity action available (Hero is never emitted).
  const levelUps = legalActions.filter((a): a is Extract<Action, { type: 'levelUpCity' }> => a.type === 'levelUpCity');
  if (levelUps.length === 0) return null;

  const cityId = levelUps.map(a => a.cityId).find(id => !dismissed.includes(id));
  if (cityId == null) return null;
  const city = gameState.cities.find(c => c.id === cityId);
  if (!city) return null;

  const targetLevel = city.level + 1;
  const choices = levelUpChoices(targetLevel);
  if (!choices) return null;
  const options: LevelUpChoice[] = [choices.a, choices.b];

  return (
    <div className="levelup-overlay">
      <div className="levelup-modal">
        <div className="levelup-title">Congratulations!</div>
        <div className="levelup-sub">
          Your {city.isCapital ? 'capital' : 'city'} has reached <b>level {targetLevel}</b>.
        </div>
        <div className="levelup-choose">Choose one:</div>
        <div className="levelup-options">
          {options.map(choice => {
            const meta = CHOICE_META[choice];
            if (!meta) return null;
            const isHero = choice === 'hero';
            const disabled = isHero; // Hero greyed out (no heroes yet / one-at-a-time)
            return (
              <button
                key={choice}
                className="levelup-option"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  // Territory routes into the tile picker (it commits the level-up on confirm);
                  // every other reward applies immediately.
                  if (choice === 'territory') setTerritorySelect({ cityId, picks: [] });
                  else executeAction({ type: 'levelUpCity', cityId, choice });
                }}
              >
                <div className="levelup-opt-icon" aria-hidden>{meta.icon}</div>
                <div className="levelup-opt-label">{meta.label}</div>
                <div className="levelup-opt-desc">{meta.desc}</div>
                {isHero && <div className="levelup-opt-soon">Coming soon</div>}
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
