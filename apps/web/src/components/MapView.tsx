import React, { useMemo, useEffect } from 'react';
import { cityPop, citySupplyProgress } from '@tactica/engine';
import { useGameStore } from '../store/gameStore.js';
import { IsoCanvas } from '../iso/IsoCanvas.js';
import { TerritorySelectBar } from './TerritorySelectBar.js';

const UNIT_ICONS: Record<string, string> = {
  scout: '🏃',
  warrior: '⚔️',
  lancer: '🔱',
  archer: '🏹',
  defender: '🛡️',
  catapult: '💣',
  ironclad_berserker: '🪓',
  ironclad_siege_tower: '🏰',
  sylvan_ranger: '🌿',
  sylvan_treant: '🌳',
};

export function MapView() {
  const {
    gameState, visibleState, registry, legalActions,
    selectedCity, executeAction, setSelectedCity,
  } = useGameStore();

  const [showRecruit, setShowRecruit] = React.useState(false);

  // Recruit options for the currently selected city only — so recruited units
  // belong to (and count against the pop of) the city you clicked.
  const recruitActions = useMemo(() => {
    if (!selectedCity) return [];
    return legalActions.filter(
      a => a.type === 'recruit' && a.cityPosition.x === selectedCity.x && a.cityPosition.y === selectedCity.y,
    );
  }, [legalActions, selectedCity]);

  // Collapse the menu whenever the selected city changes.
  useEffect(() => { setShowRecruit(false); }, [selectedCity]);

  // Pop / supply readout for the selected city (any owner).
  const cityInfo = useMemo(() => {
    if (!selectedCity || !visibleState) return null;
    const city = visibleState.cities.find(
      c => c.position.x === selectedCity.x && c.position.y === selectedCity.y,
    );
    if (!city) return null;
    const popMax = cityPop(city, registry);
    const popUsed = visibleState.units.filter(u => visibleState.unitHomeCity[u.id] === city.id).length;
    const supply = citySupplyProgress(city, registry);
    return { city, popUsed, popMax, supply };
  }, [selectedCity, visibleState, registry]);

  if (!gameState || !visibleState) return null;

  return (
    <div className="map-container" style={{ position: 'relative' }}>
      <IsoCanvas mode="game" />

      {/* Territory-expansion picker — pinned to the map's top-right corner */}
      <TerritorySelectBar />

      {/* City info card — pop & supply for the selected city (any owner) */}
      {cityInfo && (
        <div className="city-info">
          <div className="city-info-head">
            <span className="city-info-title">
              {cityInfo.city.isCapital ? 'Capital' : 'City'} · Lv {cityInfo.city.level}
            </span>
            <button className="city-info-close" onClick={() => setSelectedCity(null)} aria-label="Close">×</button>
          </div>
          <div className="city-info-row">
            <span className="city-info-ico" aria-hidden>🧍</span>
            <span className="city-info-label">Population</span>
            <span className="city-info-val">{cityInfo.popUsed}/{cityInfo.popMax}</span>
          </div>
          <div className="city-info-row">
            <span className="city-info-ico" aria-hidden>🏭</span>
            <span className="city-info-label">Supply</span>
            <span className="city-info-val">
              {cityInfo.supply.atMax ? 'MAX' : `${cityInfo.supply.current}/${cityInfo.supply.needed}`}
            </span>
          </div>
        </div>
      )}

      {/* Recruit button — shown when an owned city is selected and can build a unit */}
      {selectedCity && recruitActions.length > 0 && (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)' }}>
          <button className="primary" onClick={() => setShowRecruit(s => !s)}>
            Recruit ({recruitActions.length})
          </button>
        </div>
      )}

      {/* Recruit panel — units recruited here belong to the selected city */}
      {showRecruit && selectedCity && recruitActions.length > 0 && (
        <div className="recruit-panel">
          {recruitActions.map(action => {
            if (action.type !== 'recruit') return null;
            const utId = action.unitTypeId;
            const ut = registry.unitTypes[utId];
            if (!ut) return null;
            return (
              <div key={utId} className="recruit-card" onClick={() => { executeAction(action); setShowRecruit(false); }}>
                <div className="name">{UNIT_ICONS[utId] || '●'} {ut.name}</div>
                <div className="cost">{ut.cost}◈</div>
                <div className="stats">
                  HP:{ut.maxHP} ATK:{ut.attack} DEF:{ut.defence} MOV:{ut.movement} RNG:{ut.attackRange}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
