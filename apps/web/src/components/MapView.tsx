import React, { useMemo } from 'react';
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
    selectedUnitId, executeAction,
  } = useGameStore();

  const [showRecruit, setShowRecruit] = React.useState(false);

  // Recruit actions for cities
  const recruitActions = useMemo(() => {
    return legalActions.filter(a => a.type === 'recruit');
  }, [legalActions]);

  if (!gameState || !visibleState) return null;

  return (
    <div className="map-container" style={{ position: 'relative' }}>
      <IsoCanvas mode="game" />

      {/* Recruit button */}
      {recruitActions.length > 0 && !selectedUnitId && (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)' }}>
          <button className="primary" onClick={() => setShowRecruit(!showRecruit)}>
            Recruit ({recruitActions.length} available)
          </button>
        </div>
      )}

      {/* Recruit panel */}
      {showRecruit && recruitActions.length > 0 && (
        <div className="recruit-panel">
          {[...new Set(recruitActions.filter(a => a.type === 'recruit').map(a => a.type === 'recruit' ? a.unitTypeId : ''))].map(utId => {
            const ut = registry.unitTypes[utId];
            if (!ut) return null;
            const action = recruitActions.find(a => a.type === 'recruit' && a.unitTypeId === utId);
            return (
              <div key={utId} className="recruit-card" onClick={() => {
                if (action) {
                  executeAction(action);
                  setShowRecruit(false);
                }
              }}>
                <div className="name">{UNIT_ICONS[utId] || '●'} {ut.name}</div>
                <div className="cost">{ut.cost}g</div>
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
