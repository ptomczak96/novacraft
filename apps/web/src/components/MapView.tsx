import React, { useMemo, useEffect } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { IsoCanvas } from '../iso/IsoCanvas.js';

const UNIT_ICONS: Record<string, string> = {
  scout: '🏃',
  warrior: '⚔️',
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
    selectedCity, executeAction,
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

  if (!gameState || !visibleState) return null;

  return (
    <div className="map-container" style={{ position: 'relative' }}>
      <IsoCanvas mode="game" />

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
