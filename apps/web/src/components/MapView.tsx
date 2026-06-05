import React, { useMemo, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';
import type { Coord, Action, Unit } from '@tactica/engine';
import { previewCombat } from '@tactica/engine';

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
    gameState, visibleState, registry, config,
    selectedUnitId, hoveredTile, legalActions,
    selectUnit, setHoveredTile, executeAction,
  } = useGameStore();

  if (!gameState || !visibleState) return null;

  const map = visibleState.map;
  const units = visibleState.units;
  const currentPlayer = gameState.currentPlayer;

  // Build lookup maps
  const unitByPos = useMemo(() => {
    const m = new Map<string, Unit>();
    for (const u of units) {
      m.set(`${u.position.x},${u.position.y}`, u);
    }
    return m;
  }, [units]);

  // Compute move/attack targets for selected unit
  const { moveTargets, attackTargets } = useMemo(() => {
    const moveTargets = new Set<string>();
    const attackTargets = new Map<string, Action>();

    if (selectedUnitId == null) return { moveTargets, attackTargets };

    for (const action of legalActions) {
      if (action.type === 'move' && action.unitId === selectedUnitId) {
        moveTargets.add(`${action.to.x},${action.to.y}`);
      }
      if (action.type === 'attack' && action.unitId === selectedUnitId) {
        const target = units.find(u => u.id === action.targetId);
        if (target) {
          attackTargets.set(`${target.position.x},${target.position.y}`, action);
        }
      }
    }

    return { moveTargets, attackTargets };
  }, [selectedUnitId, legalActions, units]);

  // Recruit actions for cities
  const recruitActions = useMemo(() => {
    return legalActions.filter(a => a.type === 'recruit');
  }, [legalActions]);

  const handleTileClick = useCallback((x: number, y: number) => {
    const key = `${x},${y}`;
    const unit = unitByPos.get(key);

    // If we have a selected unit and click a move target
    if (selectedUnitId != null && moveTargets.has(key)) {
      const moveAction = legalActions.find(
        a => a.type === 'move' && a.unitId === selectedUnitId && a.to.x === x && a.to.y === y,
      );
      if (moveAction) {
        executeAction(moveAction);
        return;
      }
    }

    // If we have a selected unit and click an attack target
    if (selectedUnitId != null && attackTargets.has(key)) {
      const action = attackTargets.get(key)!;
      executeAction(action);
      return;
    }

    // Select/deselect unit
    if (unit && unit.owner === currentPlayer) {
      selectUnit(unit.id === selectedUnitId ? null : unit.id);
    } else {
      selectUnit(null);
    }
  }, [selectedUnitId, moveTargets, attackTargets, legalActions, unitByPos, currentPlayer, executeAction, selectUnit]);

  // Recruit panel
  const [showRecruit, setShowRecruit] = React.useState(false);

  const selectedUnit = selectedUnitId != null ? units.find(u => u.id === selectedUnitId) : null;

  return (
    <div className="map-container">
      <div className="map-grid" style={{
        gridTemplateColumns: `repeat(${map.width}, var(--tile-size))`,
        gridTemplateRows: `repeat(${map.height}, var(--tile-size))`,
      }}>
        {Array.from({ length: map.height }, (_, y) =>
          Array.from({ length: map.width }, (_, x) => {
            const tile = map.tiles[y][x];
            const terrain = registry.terrainTypes[tile.terrain];
            const key = `${x},${y}`;
            const unit = unitByPos.get(key);
            const isSelected = unit && unit.id === selectedUnitId;
            const isMoveTarget = moveTargets.has(key);
            const isAttackTarget = attackTargets.has(key);

            // Fog
            const vis = visibleState.visibility[y]?.[x] || 'visible';
            const fogClass = vis === 'hidden' ? 'fog-hidden' : vis === 'explored' ? 'fog-explored' : '';

            // Damage preview on hover
            let damagePreview: number | null = null;
            if (isAttackTarget && selectedUnitId != null && hoveredTile?.x === x && hoveredTile?.y === y) {
              const attacker = units.find(u => u.id === selectedUnitId);
              if (attacker && unit) {
                const at = registry.unitTypes[attacker.typeId];
                const dt = registry.unitTypes[unit.typeId];
                if (at && dt) {
                  const result = previewCombat(attacker, at, unit, dt, map, registry, config.combatConfig);
                  damagePreview = result.damageToDefender;
                }
              }
            }

            // Tile owner indicator
            const ownerColor = tile.owner !== null
              ? tile.owner === 0 ? 'var(--p0-color)' : 'var(--p1-color)'
              : undefined;

            return (
              <div
                key={key}
                className={[
                  'tile',
                  isSelected && 'selected',
                  isMoveTarget && 'move-target',
                  isAttackTarget && 'attack-target',
                  fogClass,
                ].filter(Boolean).join(' ')}
                style={{
                  backgroundColor: terrain?.color || '#333',
                  borderBottom: ownerColor ? `2px solid ${ownerColor}` : undefined,
                }}
                onClick={() => handleTileClick(x, y)}
                onMouseEnter={() => setHoveredTile({ x, y })}
                onMouseLeave={() => setHoveredTile(null)}
              >
                {tile.isCity && <span className="city-marker">🏛️</span>}
                {tile.isResourceTile && !tile.isCity && <span className="resource-marker">💎</span>}

                {unit && vis !== 'hidden' && (
                  <div className="unit-display">
                    <span className={`unit-icon p${unit.owner}`}>
                      {UNIT_ICONS[unit.typeId] || '●'}
                    </span>
                    <div className="hp-bar">
                      <div
                        className={`hp-bar-fill ${
                          unit.hp / (registry.unitTypes[unit.typeId]?.maxHP || 1) > 0.6 ? 'high' :
                          unit.hp / (registry.unitTypes[unit.typeId]?.maxHP || 1) > 0.3 ? 'mid' : 'low'
                        }`}
                        style={{ width: `${(unit.hp / (registry.unitTypes[unit.typeId]?.maxHP || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {damagePreview !== null && (
                  <span className="damage-preview">-{damagePreview}</span>
                )}
              </div>
            );
          }),
        )}
      </div>

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
          {/* Deduplicate by unit type */}
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
