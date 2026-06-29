import React, { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import type { CombatBreakdown } from '@tactica/engine';

function BreakdownSection({ label, breakdown, attackerName, defenderName }: {
  label: string;
  breakdown: CombatBreakdown;
  attackerName: string;
  defenderName: string;
}) {
  const terrainNote = breakdown.terrainBonus > 1
    ? ` (${breakdown.terrainName})`
    : '';

  return (
    <div className="combat-breakdown-section">
      <div className="combat-breakdown-header">{label}</div>
      <div className="combat-breakdown">
        <div className="combat-breakdown-row">
          <span className="cb-label">Atk Force</span>
          <span className="cb-formula">
            {breakdown.attackForce.toFixed(1)}
          </span>
        </div>
        <div className="combat-breakdown-row">
          <span className="cb-label">Def Force</span>
          <span className="cb-formula">
            {breakdown.defenseForce.toFixed(1)}
            {terrainNote && <span className="cb-note">{terrainNote}</span>}
          </span>
        </div>
        <div className="combat-breakdown-row cb-separator">
          <span className="cb-label">Total Force</span>
          <span className="cb-formula">{breakdown.totalForce.toFixed(1)}</span>
        </div>
        <div className="combat-breakdown-row">
          <span className="cb-label">Raw Dmg</span>
          <span className="cb-formula">{breakdown.rawDamage.toFixed(1)}</span>
        </div>
        <div className="combat-breakdown-row cb-result">
          <span className="cb-label">Damage</span>
          <span className="cb-formula cb-damage">{breakdown.finalDamage}</span>
        </div>
      </div>
    </div>
  );
}

export function CombatLog() {
  const { lastCombatResult } = useGameStore();
  const [collapsed, setCollapsed] = useState(false);
  if (!lastCombatResult) return null;

  // Collapsed → a small tab on the left to bring it back.
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Show combat log"
        style={{
          position: 'fixed', left: 8, top: 110, zIndex: 50,
          background: 'rgba(20,20,35,0.92)', color: '#fff',
          border: '1px solid #444', borderRadius: 4, padding: '4px 8px', cursor: 'pointer',
        }}
      >
        ▶ Log
      </button>
    );
  }

  const { attacker, defender, attackBreakdown, retaliationBreakdown, defenderKilled, attackerKilled } = lastCombatResult;

  // Guard against stale store data missing breakdowns
  if (!attackBreakdown) {
    return (
      <div className="combat-log-panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Combat Log</h3>
        <button
          onClick={() => setCollapsed(true)}
          title="Hide"
          style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px' }}
        >
          ◀
        </button>
      </div>
        <div className="combat-log-matchup">
          <span className="combat-log-unit">{attacker.name}</span>
          <span className="combat-log-arrow">&rarr;</span>
          <span className="combat-log-unit">{defender.name}</span>
        </div>
        <div className="combat-log-hp-result">
          <span>{defender.name}: {defender.hpBefore} &rarr; {defender.hpAfter} HP</span>
          {defenderKilled && <span className="combat-log-killed">Killed</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="combat-log-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Combat Log</h3>
        <button
          onClick={() => setCollapsed(true)}
          title="Hide"
          style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px' }}
        >
          ◀
        </button>
      </div>

      {/* Matchup: two unit columns (Tile · VS · Tile), each with stacked stats */}
      <div className="combat-log-stats">
        <div className="cls-col">
          <div className="cls-name">{attacker.name}</div>
          <div className="cls-role">attacker</div>
          <div className="cls-line"><span className="cls-ico">♥</span> HP: {attacker.hpBefore}/{attacker.maxHP}</div>
          <div className="cls-line"><span className="cls-ico">⚔</span> Attack: {attacker.attack}</div>
          <div className="cls-line"><span className="cls-ico">🛡</span> Defense: {attacker.defence}</div>
        </div>
        <div className="cls-vs">VS</div>
        <div className="cls-col">
          <div className="cls-name">{defender.name}</div>
          <div className="cls-role">defender</div>
          <div className="cls-line"><span className="cls-ico">♥</span> HP: {defender.hpBefore}/{defender.maxHP}</div>
          <div className="cls-line"><span className="cls-ico">⚔</span> Attack: {defender.attack}</div>
          <div className="cls-line"><span className="cls-ico">🛡</span> Defense: {defender.defence}</div>
        </div>
      </div>

      {/* Attack calculation */}
      <BreakdownSection
        label={`${attacker.name} attacks`}
        breakdown={attackBreakdown}
        attackerName={attacker.name}
        defenderName={defender.name}
      />
      <div className="combat-log-hp-result">
        <span>{defender.name}: {defender.hpBefore} &rarr; {defender.hpAfter} HP</span>
        {defenderKilled && <span className="combat-log-killed">Killed</span>}
      </div>

      {/* Defense calculation (the defender's counter, driven by its defense stat) */}
      {retaliationBreakdown ? (
        <>
          <BreakdownSection
            label={`${defender.name} defends`}
            breakdown={retaliationBreakdown}
            attackerName={defender.name}
            defenderName={attacker.name}
          />
          <div className="combat-log-hp-result">
            <span>{attacker.name}: {attacker.hpBefore} &rarr; {attacker.hpAfter} HP</span>
            {attackerKilled && <span className="combat-log-killed">Killed</span>}
          </div>
        </>
      ) : (
        <div className="combat-log-no-retaliation">
          {defenderKilled
            ? `${defender.name} was defeated — no defense`
            : `${defender.name} can't counter (attacker out of range)`}
        </div>
      )}
    </div>
  );
}
