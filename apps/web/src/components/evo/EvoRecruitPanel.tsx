import React from 'react';
import type { DataRegistry, RecruitOption } from '@tactica/engine';
import { playUi } from './uiSounds.js';

/** Unit glyphs for the recruit cards (shared with the map HUD). */
const UNIT_ICONS: Record<string, string> = {
  scout: '🏃', warrior: '⚔️', lancer: '🪖', archer: '🏹', defender: '🛡️',
  wraith: '🥷', stalker: '🕷️', titan: '🗿', sentinel: '📡', tank: '🛞',
  scab: '⚗️', vindrace: '🦏', seercaust: '🔮', wyrm: '🪱',
};

/**
 * Recruit menu in the EvoUI skin — pops up immediately when a base is
 * selected (no intermediate button). Cards show cost/stats; locked and
 * unaffordable units render dimmed with the reason.
 */
export function EvoRecruitPanel({ options, registry, onRecruit, onClose, hint }: {
  options: RecruitOption[];
  registry: DataRegistry;
  onRecruit: (unitTypeId: string) => void;
  onClose: () => void;
  /** Shown instead of cards when recruiting is blocked (e.g. occupied spawn). */
  hint?: string;
}) {
  return (
    <div className="evo-recruit-panel">
      <div className="evo-recruit-head">
        <span className="evo-recruit-title">Recruit</span>
        <button
          type="button"
          className="evo-recruit-close"
          aria-label="Close"
          onClick={() => {
            playUi('click');
            onClose();
          }}
        >
          ×
        </button>
      </div>
      {hint && <div className="evo-recruit-hint">{hint}</div>}
      <div className="evo-recruit-cards">
        {options.map(opt => {
          const ut = registry.unitTypes[opt.unitTypeId];
          if (!ut) return null;
          const disabled = opt.locked || !opt.affordable;
          const reason = opt.locked
            ? `Locked — research ${opt.lockedBy?.length ? opt.lockedBy.join(' / ') : 'the required tech'}`
            : opt.affordable ? undefined : 'Not enough resources';
          return (
            <button
              type="button"
              key={opt.unitTypeId}
              className={`evo-recruit-card${opt.locked ? ' locked' : ''}${!opt.locked && !opt.affordable ? ' unaffordable' : ''}`}
              title={reason}
              onPointerEnter={() => { if (!disabled) playUi('hover', 0.15); }}
              onClick={() => {
                if (disabled) return;
                playUi('click');
                onRecruit(opt.unitTypeId);
              }}
            >
              <span className="evo-recruit-icon" aria-hidden>{UNIT_ICONS[opt.unitTypeId] || '●'}</span>
              <span className="evo-recruit-name">{ut.name}</span>
              <span className="evo-recruit-cost">
                {opt.locked ? '🔒' : (
                  <>
                    <em>{opt.cost}◈</em>
                    {opt.plasmaCost > 0 && <em className="plasma"> {opt.plasmaCost}✦</em>}
                  </>
                )}
              </span>
              <span className="evo-recruit-stats">
                HP {ut.maxHP} · ATK {ut.attack} · DEF {ut.defence} · MOV {ut.movement} · RNG {ut.attackRange}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
