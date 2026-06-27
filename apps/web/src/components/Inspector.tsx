import React from 'react';
import { useGameStore } from '../store/gameStore.js';
import { calculateOreIncome, calculatePlasmaIncome, computeScores, cityProduction, cityPop, unitsHomedAt } from '@tactica/engine';
import type { Action } from '@tactica/engine';

export function Inspector() {
  const { gameState, registry } = useGameStore();
  if (!gameState) return null;

  const scores = computeScores(gameState, registry);

  return (
    <div className="side-panel inspector">
      <h3>State Inspector</h3>

      <div className="stat-row">
        <span className="stat-label">Turn</span>
        <span className="stat-value">{gameState.turn} / {gameState.config.turnLimit}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Phase</span>
        <span className="stat-value">{gameState.phase}</span>
      </div>

      {gameState.players.map(p => {
        const faction = registry.factions[p.factionId];
        const unitCount = gameState.units.filter(u => u.owner === p.id).length;
        const oreIncome = calculateOreIncome(gameState, p.id, registry);
        const plasmaIncome = calculatePlasmaIncome(gameState, p.id, registry);
        const playerCities = gameState.cities.filter(c => c.owner === p.id);
        const cityCount = playerCities.length;
        return (
          <div key={p.id} style={{ marginTop: 12 }}>
            <div style={{
              fontWeight: 700,
              color: p.id === 0 ? 'var(--p0-color)' : 'var(--p1-color)',
              marginBottom: 4,
            }}>
              {faction?.name || `Player ${p.id + 1}`}
            </div>
            <div className="stat-row">
              <span className="stat-label">Ore ◈</span>
              <span className="stat-value">{p.ore}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Plasma ✦</span>
              <span className="stat-value">{p.plasma}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Income/turn</span>
              <span className="stat-value">+{oreIncome}◈ +{plasmaIncome}✦</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Cities</span>
              <span className="stat-value">{cityCount}</span>
            </div>
            {playerCities.map(c => (
              <div className="stat-row" key={c.id} style={{ paddingLeft: 10, fontSize: '0.85em', opacity: 0.85 }}>
                <span className="stat-label">
                  {c.isCapital ? '★ Capital' : 'City'} (L{c.level})
                </span>
                <span className="stat-value">
                  units {unitsHomedAt(gameState, c.id)}/{cityPop(c, registry)} · {cityProduction(c, registry)}◈ · supply {c.supply}
                </span>
              </div>
            ))}
            <div className="stat-row">
              <span className="stat-label">Units</span>
              <span className="stat-value">{unitCount}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Score</span>
              <span className="stat-value">{scores[p.id] || 0}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Techs</span>
              <span className="stat-value">{p.researchedTechs.length}</span>
            </div>
          </div>
        );
      })}

      <h3 style={{ marginTop: 16 }}>Action Log</h3>
      <div className="action-log">
        {gameState.actionLog.slice(-30).map((a, i) => (
          <div key={i} className="entry">
            {formatAction(a)}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatAction(a: Action): string {
  switch (a.type) {
    case 'move': return `Move unit#${a.unitId} → (${a.to.x},${a.to.y})`;
    case 'attack': return `Attack unit#${a.unitId} → unit#${a.targetId}`;
    case 'recruit': return `Recruit ${a.unitTypeId}`;
    case 'research': return `Research ${a.techId}`;
    case 'useAbility': return `Ability ${a.abilityId}`;
    case 'build': return `Build ${a.kind} @ (${a.position.x},${a.position.y})`;
    case 'upgradeBuilding': return `Upgrade building @ (${a.position.x},${a.position.y})`;
    case 'foundCity': return `Found city @ (${a.position.x},${a.position.y})`;
    case 'captureCity': return `Capture city (unit#${a.unitId})`;
    case 'endTurn': return '── End Turn ──';
    default: return JSON.stringify(a);
  }
}
