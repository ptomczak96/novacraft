import React, { useMemo, useEffect } from 'react';
import { cityPop, citySupplyProgress, getRecruitOptions, playerEconomy } from '@tactica/engine';
import { useGameStore } from '../store/gameStore.js';
import { IsoCanvas } from '../iso/IsoCanvas.js';
import { TerritorySelectBar } from './TerritorySelectBar.js';
import { CityEconomyLines } from './EconomyBreakdown.js';

const UNIT_ICONS: Record<string, string> = {
  scout: '🏃',
  warrior: '⚔️',
  lancer: '🪖',
  archer: '🏹',
  defender: '🛡️',
  catapult: '💣',
  scuttling: '🐛',
  hive_scout: '👁️',
  reaper: '🦅',
  scab: '⚗️',
  ironclad_berserker: '🪓',
  ironclad_siege_tower: '🏰',
  sylvan_ranger: '🌿',
  sylvan_treant: '🌳',
};

const RESOURCE_LABEL: Record<string, string> = { ore: 'Ore ◈', plasma: 'Plasma ✦' };

export function MapView() {
  const {
    gameState, visibleState, registry,
    selectedCity, executeAction, setSelectedCity,
    inspectedTile, setInspectedTile,
  } = useGameStore();

  const [showRecruit, setShowRecruit] = React.useState(false);

  // Terrain / resource readout for the inspected tile (the click-to-inspect box).
  const tileInfo = useMemo(() => {
    if (!inspectedTile || !visibleState) return null;
    // Don't reveal terrain under fog — hidden tiles are drawn as clouds.
    if (visibleState.visibility[inspectedTile.y]?.[inspectedTile.x] === 'hidden') return null;
    const tile = visibleState.map.tiles[inspectedTile.y]?.[inspectedTile.x];
    if (!tile) return null;
    const terrain = registry.terrainTypes[tile.terrain];
    if (!terrain) return null;
    const notes: string[] = [];
    if (terrain.id === 'mountain') notes.push('Impassable to most units');
    else if (!terrain.passable) notes.push('Impassable');
    if (terrain.id === 'forest') notes.push('+20% defence for light units');
    if (terrain.defenceBonus > 0 && terrain.id !== 'forest') notes.push(`+${Math.round(terrain.defenceBonus * 100)}% defence`);
    if (tile.isRuin) notes.push('Ruin — a scout can found a city here');
    return {
      icon: terrain.icon,
      name: terrain.name,
      resource: tile.resourceKind ? (RESOURCE_LABEL[tile.resourceKind] ?? tile.resourceKind) : null,
      notes,
      coord: inspectedTile,
    };
  }, [inspectedTile, visibleState, registry]);

  // Full recruit roster for the selected city (incl. unaffordable units, flagged),
  // so they can be shown red rather than hidden.
  const recruitOptions = useMemo(() => {
    if (!selectedCity || !gameState) return [];
    return getRecruitOptions(gameState, registry, gameState.currentPlayer, selectedCity);
  }, [gameState, registry, selectedCity]);

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
    // Weighted, rounded up — scuttlings count 0.5 each (a pair = 1).
    const popUsed = Math.ceil(visibleState.units
      .filter(u => visibleState.unitHomeCity[u.id] === city.id)
      .reduce((s, u) => s + (registry.unitTypes[u.typeId]?.popCost ?? 1), 0));
    const supply = citySupplyProgress(city, registry);
    return { city, popUsed, popMax, supply };
  }, [selectedCity, visibleState, registry]);

  // Ore / plasma production breakdown for the selected city — only for the current
  // player's own cities (we don't reveal an enemy city's economy). Uses full game
  // state so blocked REBs are reflected accurately.
  const cityEco = useMemo(() => {
    if (!selectedCity || !gameState) return null;
    const city = gameState.cities.find(c => c.position.x === selectedCity.x && c.position.y === selectedCity.y);
    if (!city || city.owner !== gameState.currentPlayer) return null;
    return playerEconomy(gameState, gameState.currentPlayer, registry).find(e => e.cityId === city.id) ?? null;
  }, [selectedCity, gameState, registry]);

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
          {cityEco && (
            <div className="city-info-eco">
              <CityEconomyLines city={cityEco} />
            </div>
          )}
        </div>
      )}

      {/* Tile info box — terrain / resource for the click-inspected tile */}
      {tileInfo && (
        <div className="city-info tile-info">
          <div className="city-info-head">
            <span className="city-info-title">
              {tileInfo.icon} {tileInfo.name}
            </span>
            <button className="city-info-close" onClick={() => setInspectedTile(null)} aria-label="Close">×</button>
          </div>
          {tileInfo.resource && (
            <div className="city-info-row">
              <span className="city-info-ico" aria-hidden>⛏️</span>
              <span className="city-info-label">Resource</span>
              <span className="city-info-val">{tileInfo.resource}</span>
            </div>
          )}
          {tileInfo.notes.map((n, i) => (
            <div key={i} className="tile-info-note">{n}</div>
          ))}
          <div className="tile-info-note tile-info-coord">({tileInfo.coord.x}, {tileInfo.coord.y})</div>
        </div>
      )}

      {/* Recruit button — shown when an owned city is selected and can build a unit */}
      {selectedCity && recruitOptions.length > 0 && (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)' }}>
          <button className="primary" onClick={() => setShowRecruit(s => !s)}>
            Recruit ({recruitOptions.length})
          </button>
        </div>
      )}

      {/* Recruit panel — all buildable units; unaffordable ones are tinted red */}
      {showRecruit && selectedCity && recruitOptions.length > 0 && (
        <div className="recruit-panel">
          {recruitOptions.map(opt => {
            const ut = registry.unitTypes[opt.unitTypeId];
            if (!ut) return null;
            const cls = `recruit-card${opt.affordable ? '' : ' recruit-card--unaffordable'}`;
            return (
              <div
                key={opt.unitTypeId}
                className={cls}
                title={opt.affordable ? undefined : 'Not enough resources'}
                onClick={() => {
                  if (!opt.affordable) return;
                  executeAction({ type: 'recruit', unitTypeId: opt.unitTypeId, cityPosition: selectedCity });
                  setShowRecruit(false);
                }}
              >
                <div className="name">{UNIT_ICONS[opt.unitTypeId] || '●'} {ut.name}</div>
                <div className="cost">{opt.cost}◈{opt.plasmaCost > 0 ? ` ${opt.plasmaCost}✦` : ''}</div>
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
