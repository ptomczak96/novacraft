import React from 'react';
import { useGameStore } from '../store/gameStore.js';
import { calculateIncome, computeScores } from '@tactica/engine';

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
        const income = calculateIncome(gameState, p.id, registry);
        const cityCount = getCityCount(gameState, p.id);
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
              <span className="stat-label">Gold</span>
              <span className="stat-value">{p.gold}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Income/turn</span>
              <span className="stat-value">+{income}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Cities</span>
              <span className="stat-value">{cityCount}</span>
            </div>
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

function getCityCount(state: { map: { width: number; height: number; tiles: { isCity: boolean; owner: number | null }[][] } }, playerId: number): number {
  let count = 0;
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (state.map.tiles[y][x].isCity && state.map.tiles[y][x].owner === playerId) count++;
    }
  }
  return count;
}

function formatAction(a: { type: string; [key: string]: unknown }): string {
  switch (a.type) {
    case 'move': return `Move unit#${a.unitId} → (${(a.to as {x:number,y:number}).x},${(a.to as {x:number,y:number}).y})`;
    case 'attack': return `Attack unit#${a.unitId} → unit#${a.targetId}`;
    case 'recruit': return `Recruit ${a.unitTypeId}`;
    case 'research': return `Research ${a.techId}`;
    case 'endTurn': return '── End Turn ──';
    default: return JSON.stringify(a);
  }
}
