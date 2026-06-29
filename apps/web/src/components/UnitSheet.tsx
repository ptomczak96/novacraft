import React from 'react';
import { getDefenseMultiplier } from '@tactica/engine';
import { useGameStore } from '../store/gameStore.js';

// Friendly names + explanations for special conditions (hover tooltips).
const CONDITION_INFO: Record<string, { name: string; desc: string }> = {
  mountain_restricted: { name: 'Mountain Restricted', desc: 'Cannot move onto mountain tiles (this is the default for all units).' },
  mountain_defense: { name: 'Mountain Defense', desc: 'Can move onto mountains; gains ×1.2 defence while standing on one.' },
  mountain_shooter: { name: 'Mountain Shooter', desc: 'Can move onto mountains; gains ×1.2 attack while standing on one.' },
  mountain_sight: { name: 'Mountain Sight', desc: 'Can move onto mountains; its visibility becomes 2 while standing on one.' },
  low_horizons: { name: 'Low Horizons', desc: 'Mountains block its line of sight — it sees the mountain but nothing beyond it.' },
  impotent_founder: { name: 'Impotent Founder', desc: 'Cannot found cities.' },
  sacrificial_founder: { name: 'Sacrificial Founder', desc: 'Dies when it founds a city.' },
  blind: { name: 'Blind', desc: 'Sees only its own tile; can move into clouds and bumps into hidden enemies to reveal them.' },
  squinting_eyes_1: { name: 'Squinting Eyes I', desc: 'Sees its 3×3 as fog only (terrain, not units).' },
  squinting_eyes_2: { name: 'Squinting Eyes II', desc: '3×3 fully visible; the surrounding 5×5 ring shown as fog.' },
  corrosive: { name: 'Corrosive', desc: 'Its attack also applies the Corrosive status (−20% defence) to the target.' },
  frazzled: { name: 'Frazzled', desc: 'While inside an enemy’s area of influence (within an enemy’s attack range), its movement is capped at 1.' },
};
function conditionInfo(id: string): { name: string; desc: string } {
  const dash = /^dash_(\d+)$/.exec(id);
  if (dash) return { name: `Dash ${dash[1]}`, desc: `After attacking, may move up to ${dash[1]} tile${dash[1] === '1' ? '' : 's'} (units normally can't move after attacking).` };
  return CONDITION_INFO[id] ?? { name: id.replace(/_/g, ' '), desc: '' };
}

// Active status effects (applied during play, stored on unit.statuses).
const STATUS_INFO: Record<string, { name: string; effect: string; desc: string }> = {
  corrosive: { name: 'Corrosive', effect: '−20% DEF', desc: 'Defence reduced by 20% (from a corrosive attack).' },
};

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

  // Actual defensive multiplier for THIS unit on THIS tile (matches combat exactly).
  const defMult = getDefenseMultiplier(tile, terrain, unitType);
  const tileNote = tile.fortified ? ' (Fortified)' : tile.isCity ? ' (City)' : '';
  const defenseLabel = `${terrain?.name ?? 'Unknown'}${tileNote} — ${defMult}×`;

  const statuses = unit.statuses ?? [];

  return (
    <div className="side-panel unit-sheet">
      <h3>Unit Info</h3>

      <div className="unit-sheet-header">
        <span className="unit-sheet-name">{unitType.name}</span>
        <span className="unit-sheet-owner" style={{ color: playerColor }}>
          {faction?.name ?? `Player ${unit.owner + 1}`}
        </span>
      </div>

      {/* HP */}
      <div className="unit-sheet-hp-section">
        <div className="hp-label">
          <span>HP</span>
          <span>{unit.hp} / {unitType.maxHP}</span>
        </div>
        <div className="hp-bar-track">
          <div className="hp-bar-fill" style={{ width: `${hpPercent}%`, background: hpColor }} />
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-grid-item"><span className="stat-label">Attack</span><span className="stat-value">{unitType.attack}</span></div>
        <div className="stat-grid-item"><span className="stat-label">Defence</span><span className="stat-value">{unitType.defence}</span></div>
        <div className="stat-grid-item"><span className="stat-label">Movement</span><span className="stat-value">{unitType.movement}</span></div>
        <div className="stat-grid-item"><span className="stat-label">Range</span><span className="stat-value">{unitType.attackRange}</span></div>
        <div className="stat-grid-item"><span className="stat-label">Visibility</span><span className="stat-value">{unitType.visibility}</span></div>
        {unitType.unitClass && (
          <div className="stat-grid-item"><span className="stat-label">Class</span><span className="stat-value" style={{ textTransform: 'capitalize' }}>{unitType.unitClass}</span></div>
        )}
        <div className="stat-grid-item"><span className="stat-label">Cost</span><span className="stat-value">{unitType.cost}g</span></div>
      </div>

      {/* Active status effects */}
      {statuses.length > 0 && (
        <div className="unit-sheet-traits">
          <span className="stat-label">Status</span>
          <div className="unit-sheet-trait-list">
            {statuses.map(s => {
              const info = STATUS_INFO[s];
              return (
                <span key={s} className="unit-sheet-status">
                  {info ? `${info.name} (${info.effect})` : s}
                  <span className="cond-tip">{info?.desc ?? s}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Special conditions — hover for an explanation */}
      {unitType.conditions && unitType.conditions.length > 0 && (
        <div className="unit-sheet-traits">
          <span className="stat-label">Special Conditions</span>
          <div className="unit-sheet-trait-list">
            {unitType.conditions.map(c => {
              const info = conditionInfo(c);
              return (
                <span key={c} className="unit-sheet-trait unit-sheet-condition">
                  {info.name}
                  {info.desc && <span className="cond-tip">{info.desc}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Traits */}
      {unitType.traits.length > 0 && (
        <div className="unit-sheet-traits">
          <span className="stat-label">Traits</span>
          <div className="unit-sheet-trait-list">
            {unitType.traits.map(t => <span key={t} className="unit-sheet-trait">{t}</span>)}
          </div>
        </div>
      )}

      <div className="unit-sheet-terrain">
        <span className="stat-label">Terrain (def)</span>
        <span className="stat-value">{defenseLabel}</span>
      </div>
      <div className="unit-sheet-terrain">
        <span className="stat-label">Position</span>
        <span className="stat-value">({unit.position.x}, {unit.position.y})</span>
      </div>
    </div>
  );
}
