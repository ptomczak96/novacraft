import React from 'react';
import { useGameStore } from '../store/gameStore.js';

export function UnitSheet() {
  const { visibleState, selectedUnitId, registry } = useGameStore();
  if (!visibleState || selectedUnitId === null) return null;

  const unit = visibleState.units.find(u => u.id === selectedUnitId);
  if (!unit) return null;

  const unitType = registry.unitTypes[unit.typeId];
  if (!unitType) return null;

  const tile = visibleState.map.tiles[unit.position.y][unit.position.x];
  const terrain = registry.terrainTypes[tile.terrain];

  const hpPercent = (unit.hp / unitType.maxHP) * 100;
  const hpColor = hpPercent > 60 ? 'var(--success)' : hpPercent > 30 ? 'var(--warning)' : 'var(--danger)';
  const playerColor = unit.owner === 0 ? 'var(--p0-color)' : 'var(--p1-color)';
  const faction = registry.factions[visibleState.players[unit.owner]?.factionId];

  const defenseLabel = terrain
    ? (terrain.defenceBonus > 0 || tile.isCity)
      ? `${terrain.name}${tile.isCity ? ' (City)' : ''} — 1.5x`
      : `${terrain.name} — 1.0x`
    : 'Unknown';

  return (
    <div className="side-panel unit-sheet">
      <h3>Unit Info</h3>

      {/* Header */}
      <div className="unit-sheet-header">
        <span className="unit-sheet-name">{unitType.name}</span>
        <span className="unit-sheet-owner" style={{ color: playerColor }}>
          {faction?.name ?? `Player ${unit.owner + 1}`}
        </span>
      </div>

      {/* HP Bar */}
      <div className="unit-sheet-hp-section">
        <div className="hp-label">
          <span>HP</span>
          <span>{unit.hp} / {unitType.maxHP}</span>
        </div>
        <div className="hp-bar-track">
          <div
            className="hp-bar-fill"
            style={{ width: `${hpPercent}%`, background: hpColor }}
          />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stat-grid">
        <div className="stat-grid-item">
          <span className="stat-label">Attack</span>
          <span className="stat-value">{unitType.attack}</span>
        </div>
        <div className="stat-grid-item">
          <span className="stat-label">Defence</span>
          <span className="stat-value">{unitType.defence}</span>
        </div>
        <div className="stat-grid-item">
          <span className="stat-label">Movement</span>
          <span className="stat-value">{unitType.movement}</span>
        </div>
        <div className="stat-grid-item">
          <span className="stat-label">Range</span>
          <span className="stat-value">{unitType.attackRange}</span>
        </div>
        <div className="stat-grid-item">
          <span className="stat-label">Sight</span>
          <span className="stat-value">{unitType.sightRange}</span>
        </div>
        <div className="stat-grid-item">
          <span className="stat-label">Cost</span>
          <span className="stat-value">{unitType.cost}g</span>
        </div>
      </div>

      {/* Traits */}
      {unitType.traits.length > 0 && (
        <div className="unit-sheet-traits">
          <span className="stat-label">Traits</span>
          <div className="unit-sheet-trait-list">
            {unitType.traits.map(t => (
              <span key={t} className="unit-sheet-trait">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Terrain */}
      <div className="unit-sheet-terrain">
        <span className="stat-label">Terrain</span>
        <span className="stat-value">{defenseLabel}</span>
      </div>

      {/* Position */}
      <div className="unit-sheet-terrain">
        <span className="stat-label">Position</span>
        <span className="stat-value">({unit.position.x}, {unit.position.y})</span>
      </div>
    </div>
  );
}
