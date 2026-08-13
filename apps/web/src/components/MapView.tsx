import React, { useMemo, useEffect } from 'react';
import { cityPop, citySupplyProgress, getRecruitOptions, playerEconomy } from '@tactica/engine';
import { useGameStore } from '../store/gameStore.js';
import { IsoCanvas } from '../iso/IsoCanvas.js';
import { Starfield } from '../iso/Starfield.js';
// Lazy so the three.js stack is only downloaded when the 3D renderer is chosen.
const VoxelMapView = React.lazy(() =>
  import('../render/voxel3d/VoxelMapView.js').then(m => ({ default: m.VoxelMapView })));
import { PlasmaIcon } from './PlasmaIcon.js';
import { TerritorySelectBar } from './TerritorySelectBar.js';
import { VolleySelectBar } from './VolleySelectBar.js';
import { StrikeSelectBar } from './StrikeSelectBar.js';
import { TargetSelectBar } from './TargetSelectBar.js';
import { NodeCancelDialog } from './NodeCancelDialog.js';
import { MarkRemovalBar } from './MarkRemovalBar.js';
import { EvoRecruitPanel } from './evo/EvoRecruitPanel.js';
import { CityEconomyLines } from './EconomyBreakdown.js';

export const UNIT_ICONS: Record<string, string> = {
  scout: '🏃',
  warrior: '⚔️',
  lancer: '🪖',
  archer: '🏹',
  defender: '🛡️',
  wraith: '🥷',
  stalker: '🕷️',
  titan: '🗿',
  sentinel: '📡',
  tank: '🛞',
  catapult: '💣',
  scuttling: '🐛',
  hive_scout: '👁️',
  reaper: '🦅',
  scab: '⚗️',
  vindrace: '🦏',
  seercaust: '🔮',
  wyrm: '🪱',
  ironclad_berserker: '🪓',
  ironclad_siege_tower: '🏰',
  sylvan_ranger: '🌿',
  sylvan_treant: '🌳',
};

const RESOURCE_LABEL: Record<string, string> = { ore: 'Ore', plasma: 'Plasma' };

type RendererKind = 'iso' | 'voxel3d';

export function MapView() {
  const {
    gameState, visibleState, registry,
    selectedCity, executeAction, setSelectedCity,
    inspectedTile, setInspectedTile, tileTheme,
  } = useGameStore();

  // Renderer selection: `?renderer=voxel3d` or the on-screen toggle. The 2D iso
  // canvas remains the default and is untouched by the voxel3d option. The
  // GEN 8 — 3D Tileset map-generation option is inherently 3D, so it starts on
  // the voxel renderer (the toggle still allows dropping back to 2D).
  const [renderer, setRenderer] = React.useState<RendererKind>(() =>
    new URLSearchParams(window.location.search).get('renderer') === 'voxel3d'
      || tileTheme === 'gen8_tileset3d'
      ? 'voxel3d'
      : 'iso');
  useEffect(() => {
    if (tileTheme === 'gen8_tileset3d') setRenderer('voxel3d');
  }, [tileTheme]);

  // Map pan offset (drag-to-pan). Drives both the board's CSS translate and the
  // starfield parallax. Reset to centre whenever a new game starts.
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const seed = gameState?.prng?.seed;
  useEffect(() => { setPan({ x: 0, y: 0 }); }, [seed]);

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
    // "Spray Bile" (infected tile): buffs/debuffs + a turns-left counter.
    const bile = tile.bile
      ? { owner: tile.bile.owner, turnsLeft: Math.max(0, tile.bile.expiresTurn - visibleState.turn) }
      : null;
    return {
      icon: terrain.icon,
      name: terrain.name,
      resource: tile.resourceKind ? (RESOURCE_LABEL[tile.resourceKind] ?? tile.resourceKind) : null,
      resourceKind: tile.resourceKind ?? null,
      notes,
      bile,
      coord: inspectedTile,
    };
  }, [inspectedTile, visibleState, registry]);

  // The engine hides all options while a unit stands on the spawn tile — the
  // panel shows a hint in that case instead of silently showing nothing.
  const spawnBlocked = useMemo(() => {
    if (!selectedCity || !gameState) return false;
    const city = gameState.cities.find(
      c => c.position.x === selectedCity.x && c.position.y === selectedCity.y,
    );
    if (!city || city.owner !== gameState.currentPlayer) return false;
    return gameState.units.some(
      u => u.position.x === selectedCity.x && u.position.y === selectedCity.y,
    );
  }, [selectedCity, gameState]);

  // Full recruit roster for the selected city (incl. unaffordable units, flagged),
  // so they can be shown red rather than hidden.
  const recruitOptions = useMemo(() => {
    if (!selectedCity || !gameState) return [];
    return getRecruitOptions(gameState, registry, gameState.currentPlayer, selectedCity);
  }, [gameState, registry, selectedCity]);

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
      {renderer === 'iso' ? (
        <>
          <Starfield pan={pan} />
          <IsoCanvas mode="game" pan={pan} onPanChange={setPan} />
        </>
      ) : (
        <React.Suspense fallback={null}>
          <VoxelMapView />
        </React.Suspense>
      )}

      {/* Renderer toggle — 2D iso canvas ⟷ 3D voxel arena */}
      <button
        onClick={() => setRenderer(r => (r === 'iso' ? 'voxel3d' : 'iso'))}
        title={renderer === 'iso' ? 'Switch to 3D voxel renderer' : 'Switch to 2D renderer'}
        style={{
          position: 'absolute', top: 8, left: 8, zIndex: 10,
          padding: '4px 10px', fontSize: 12, fontFamily: 'monospace',
          background: 'rgba(20, 24, 38, 0.85)', color: '#8ecbff',
          border: '1px solid #2a3a55', borderRadius: 4, cursor: 'pointer',
        }}
      >
        {renderer === 'iso' ? '3D' : '2D'}
      </button>

      {/* Ability / gameplay pickers & prompts (David's economy-branch UI) */}
      <TerritorySelectBar />
      <VolleySelectBar />
      <StrikeSelectBar />
      <TargetSelectBar />
      <NodeCancelDialog />
      <MarkRemovalBar />

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
              <span className="city-info-val">{tileInfo.resource} {tileInfo.resourceKind === 'plasma' ? <PlasmaIcon /> : '◈'}</span>
            </div>
          )}
          {tileInfo.notes.map((n, i) => (
            <div key={i} className="tile-info-note">{n}</div>
          ))}
          {tileInfo.bile && (
            <div className="tile-info-bile">
              <div className="tile-info-bile-head">
                🟣 Infected (Bile) · P{tileInfo.bile.owner + 1}'s ·{' '}
                {tileInfo.bile.turnsLeft} turn{tileInfo.bile.turnsLeft === 1 ? '' : 's'} left
              </div>
              <div className="tile-info-note">Owner's units: +20% ATK, +20% DEF</div>
              <div className="tile-info-note">Enemy units: −20% DEF · movement penalty (TBD)</div>
            </div>
          )}
          <div className="tile-info-note tile-info-coord">({tileInfo.coord.x}, {tileInfo.coord.y})</div>
        </div>
      )}

      {/* Recruit menu — pops up immediately when an owned base is selected.
          If a unit is parked on the spawn tile, show why nothing is listed. */}
      {selectedCity && (recruitOptions.length > 0 || spawnBlocked) && (
        <EvoRecruitPanel
          options={recruitOptions}
          registry={registry}
          hint={recruitOptions.length === 0 && spawnBlocked
            ? 'Move the unit off the base tile to recruit.'
            : undefined}
          onRecruit={unitTypeId => {
            executeAction({ type: 'recruit', unitTypeId, cityPosition: selectedCity });
          }}
          onClose={() => setSelectedCity(null)}
        />
      )}
    </div>
  );
}
