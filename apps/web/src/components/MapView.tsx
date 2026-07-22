import React, { useMemo, useEffect } from 'react';
import { cityPop, citySupplyProgress, getRecruitOptions, playerEconomy } from '@tactica/engine';
import { useGameStore } from '../store/gameStore.js';
import { IsoCanvas } from '../iso/IsoCanvas.js';
import { Starfield } from '../iso/Starfield.js';
import { TerritorySelectBar } from './TerritorySelectBar.js';
import { VolleySelectBar } from './VolleySelectBar.js';
import { StrikeSelectBar } from './StrikeSelectBar.js';
import { TargetSelectBar } from './TargetSelectBar.js';
import { NodeCancelDialog } from './NodeCancelDialog.js';
import { MarkRemovalBar } from './MarkRemovalBar.js';
import { CityEconomyLines } from './EconomyBreakdown.js';
import { abilityDef } from './UnitSheet.js';
import { coordLabel } from '../data/notation.js';

const UNIT_ICONS: Record<string, string> = {
  scout: '🏃',
  warrior: '⚔️',
  lancer: '🪖',
  archer: '🏹',
  defender: '🛡️',
  medic: '🧑‍⚕️',
  engineer: '👷',
  wraith: '🥷',
  stalker: '🕷️',
  titan: '🗿',
  sentinel: '📡',
  tank: '🛞',
  catapult: '💣',
  scuttling: '🐛',
  hive_scout: '👁️',
  reaper: '🦅',
  burstling: '💣',
  scab: '⚗️',
  vindrace: '🦏',
  seercaust: '🔮',
  behemoth: '🦖',
  ravener: '🦇',
  wyrm: '🪱',
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
      notes,
      bile,
      coord: inspectedTile,
    };
  }, [inspectedTile, visibleState, registry]);

  // Full recruit roster for the selected city (incl. unaffordable units, flagged),
  // so they can be shown red rather than hidden.
  const recruitOptions = useMemo(() => {
    if (!selectedCity || !gameState) return [];
    return getRecruitOptions(gameState, registry, gameState.currentPlayer, selectedCity);
  }, [gameState, registry, selectedCity]);

  // Pop is "full" when the city can't fit even the smallest available unit.
  const popFull = recruitOptions.length > 0 && recruitOptions.every(o => !o.fitsPop);

  // Collapse the menu whenever the selected city changes.
  useEffect(() => { setShowRecruit(false); }, [selectedCity]);

  // Pop / supply readout for the selected city (any owner).
  const cityInfo = useMemo(() => {
    if (!selectedCity || !visibleState) return null;
    const city = visibleState.cities.find(
      c => c.position.x === selectedCity.x && c.position.y === selectedCity.y,
    );
    if (!city) return null;
    const popMax = cityPop(city, registry, gameState ?? undefined);
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
      <Starfield pan={pan} />
      {/* Only the board scrolls/zooms; overlays below stay pinned to the visible box. */}
      <div className="map-scroll">
        <IsoCanvas mode="game" pan={pan} onPanChange={setPan} />
      </div>

      {/* Territory-expansion picker — pinned to the map's top-right corner */}
      <TerritorySelectBar />

      {/* Ballistic Volley 2×2 target picker (Titan) */}
      <VolleySelectBar />

      {/* Wyrm Body Slam 2-cell picker */}
      <StrikeSelectBar />

      {/* Cure / Repair multi-unit target picker (Medic / Engineer) */}
      <TargetSelectBar />

      {/* Confirm dialog for cancelling in-progress Node construction */}
      <NodeCancelDialog />

      {/* Remove tracer round / explosives prompt */}
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
              <span className="city-info-val">{tileInfo.resource}</span>
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
          <div className="tile-info-note tile-info-coord">{coordLabel(tileInfo.coord.x, tileInfo.coord.y)}</div>
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

      {/* Recruit panel — the full roster as a table; locked / unaffordable / pop-blocked
          rows are greyed rather than hidden. A "Population Full" banner tops the list when
          the city has no room. The Abilities column shows a ? (hover/click for details)
          or "None". */}
      {showRecruit && selectedCity && recruitOptions.length > 0 && (
        <div className="recruit-panel recruit-panel--table">
          {popFull && (
            <div className="recruit-popfull">
              <span className="recruit-popfull-ico" aria-hidden>⚠️</span> Population Full
            </div>
          )}
          <table className="recruit-table">
            <thead>
              <tr>
                <th className="ru-unit">Unit</th>
                <th>HP</th><th>ATT</th><th>DEF</th><th>MOV</th><th>RNG</th><th>VIS</th>
                <th>Abilities</th>
              </tr>
            </thead>
            <tbody>
              {recruitOptions.map(opt => {
                const ut = registry.unitTypes[opt.unitTypeId];
                if (!ut) return null;
                const recruitable = !opt.locked && opt.affordable && opt.fitsPop;
                const rowCls = `recruit-row${opt.locked ? ' recruit-row--locked' : !opt.fitsPop ? ' recruit-row--nopop' : opt.affordable ? '' : ' recruit-row--unaffordable'}`;
                const title = opt.locked
                  ? `Locked — research ${opt.lockedBy && opt.lockedBy.length ? opt.lockedBy.join(' / ') : 'the required tech'} to unlock`
                  : !opt.fitsPop ? 'Population full — no room for this unit'
                  : opt.affordable ? undefined : 'Not enough resources';
                // Inherent actives (ability casts) + passives (passive-category conditions).
                const actives = ut.abilities.map(a => abilityDef(a.id));
                const passives = (ut.conditions ?? []).map(id => abilityDef(id)).filter(d => d.category === 'passive');
                const rows = [
                  ...actives.map(d => ({ kind: 'Active', ...d })),
                  ...passives.map(d => ({ kind: 'Passive', ...d })),
                ];
                return (
                  <tr
                    key={opt.unitTypeId}
                    className={rowCls}
                    title={title}
                    onClick={() => {
                      if (!recruitable) return;
                      executeAction({ type: 'recruit', unitTypeId: opt.unitTypeId, cityPosition: selectedCity });
                      setShowRecruit(false);
                    }}
                  >
                    <td className="ru-unit">
                      <span className="ru-ico" aria-hidden>{UNIT_ICONS[opt.unitTypeId] || '●'}</span>
                      <span className="ru-name">{ut.name}</span>
                      <span className="ru-cost">
                        {opt.locked
                          ? <>🔒 {opt.lockedBy && opt.lockedBy.length ? opt.lockedBy.join(' / ') : 'Locked'}</>
                          : <>{opt.cost}◈{opt.plasmaCost > 0 ? ` ${opt.plasmaCost}✦` : ''}</>}
                      </span>
                    </td>
                    <td>{ut.maxHP}</td>
                    <td>{ut.attack}</td>
                    <td>{ut.defence}</td>
                    <td>{ut.movement}</td>
                    <td>{ut.attackRange}</td>
                    <td>{ut.visibility}</td>
                    <td className="ru-abil-cell">
                      {rows.length === 0
                        ? <span className="ru-none">None</span>
                        : (
                          <span className="ru-abil" tabIndex={0} onClick={e => e.stopPropagation()}>
                            <span className="ru-abil-q" aria-label="Abilities">❓</span>
                            <span className="ru-abil-pop" role="tooltip">
                              <span className="ru-abil-title">{ut.name} — Abilities</span>
                              <table className="ru-abil-table">
                                <thead><tr><th>Type</th><th>Name</th><th>Effect</th></tr></thead>
                                <tbody>
                                  {rows.map((r, i) => (
                                    <tr key={i}>
                                      <td className={`ru-abil-kind ${r.kind.toLowerCase()}`}>{r.kind}</td>
                                      <td className="ru-abil-name">{r.name}</td>
                                      <td className="ru-abil-desc">{r.desc || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </span>
                          </span>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
