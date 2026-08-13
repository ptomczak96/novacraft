import React from 'react';
import { canBuildLocation } from '@tactica/engine';
import type { Action, BuildingKind } from '@tactica/engine';
import { useGameStore } from '../../store/gameStore.js';
import { UNIT_ICONS } from '../MapView.js';
import './gen8hud.css';

/**
 * GEN 8 HUD — the RIGBOUND_3js in-game overlay (objectives, top-centre END
 * TURN, faction turn tag + unit tray, hostile intel card) ported onto the
 * RIGBOUND game screen. Mounted over the map area only when the GEN 8 -
 * 3D Tileset map style is active; the standard UnitSheet keeps serving as the
 * friendly unit card (re-chromed by gen8hud.css), while a selected HOSTILE
 * unit swaps it for the red intel card, matching the reference layout.
 */

const TRAY_MAX = 9;

const BUILD_LABELS: Record<string, string> = {
  mine: 'Build Mine',
  extractor: 'Build Extractor',
  refinery: 'Build Refinery',
  purifier: 'Build Purifier',
};

export function Gen8Hud({ onEndTurn }: { onEndTurn: () => void }) {
  const {
    gameState, visibleState, config, registry, legalActions,
    selectedUnitId, selectUnit, botSettings, executeAction,
  } = useGameStore();

  if (!gameState || !visibleState || gameState.phase !== 'playing') return null;

  const currentPlayer = gameState.currentPlayer;
  const faction = registry.factions[gameState.players[currentPlayer].factionId];
  const humanTurn = botSettings[currentPlayer] === 'human';
  const hiveish = gameState.players[currentPlayer].factionId === 'hive';

  // ── Objectives: the configured win conditions with live progress ──
  const myCities = visibleState.cities.filter(c => c.owner === currentPlayer).length;
  const knownCities = visibleState.cities.length;
  const wc = config.winConditions;
  const objectives: Array<{ text: string; sub?: string }> = [];
  if (wc.captureAllCities) {
    objectives.push({ text: 'Capture all cities', sub: `Cities held: ${myCities} / ${knownCities}` });
  }
  if (wc.captureCapital) {
    objectives.push({ text: 'Capture the enemy capital' });
  }
  if (wc.eliminateAllUnits) {
    objectives.push({ text: 'Eliminate all enemy units' });
  }
  if (wc.highestScoreAtLimit) {
    objectives.push({ text: 'Highest score at the limit', sub: `Turn ${gameState.turn} / ${config.turnLimit}` });
  }

  // ── Tray: your units first, then sighted hostiles ──
  const mine = visibleState.units.filter(u => u.owner === currentPlayer);
  const seen = visibleState.units.filter(u => u.owner !== currentPlayer);

  // ── Hostile intel card for a selected enemy unit ──
  const selected = selectedUnitId != null
    ? visibleState.units.find(u => u.id === selectedUnitId)
    : undefined;
  const enemy = selected && selected.owner !== currentPlayer ? selected : undefined;
  const enemyType = enemy ? registry.unitTypes[enemy.typeId] : undefined;
  const enemyFaction = enemy
    ? registry.factions[gameState.players[enemy.owner]?.factionId]
    : undefined;

  const turnLabel = wc.highestScoreAtLimit && config.turnLimit
    ? `Turn ${gameState.turn} / ${config.turnLimit}`
    : `Turn ${gameState.turn}`;

  // ── Site actions for the selected unit's tile: found / capture city, build
  // or upgrade a REB. The iso renderer draws these as on-canvas boxes; here
  // they're HUD buttons (the reason ruins/REBs "didn't work" in GEN 8). ──
  const prompts: Array<{ key: string; label: string; cost?: string; action: Action; disabled?: boolean }> = [];
  if (humanTurn && selected && selected.owner === currentPlayer) {
    const pos = selected.position;
    for (const a of legalActions) {
      if (a.type === 'foundCity' && a.position.x === pos.x && a.position.y === pos.y) {
        prompts.push({ key: 'found', label: 'Found City', action: a });
      }
      if (a.type === 'captureCity' && a.unitId === selected.id) {
        prompts.push({ key: 'capture', label: 'Capture City', action: a });
      }
    }
    const existing = gameState.buildings.find(b => b.position.x === pos.x && b.position.y === pos.y);
    if (existing) {
      const def = registry.economy.buildings[existing.kind];
      const nextLevel = existing.level + 1;
      if (def && nextLevel <= def.maxLevel) {
        const hasAction = legalActions.some(a => a.type === 'upgradeBuilding' && a.position.x === pos.x && a.position.y === pos.y);
        const ore = def.costByLevel?.[nextLevel - 1] ?? 0;
        const plasma = def.plasmaCostByLevel?.[nextLevel - 1] ?? 0;
        prompts.push({
          key: 'upgrade',
          label: `Upgrade → L${nextLevel}`,
          cost: `${ore}◈${plasma > 0 ? ` ${plasma}✦` : ''}`,
          action: { type: 'upgradeBuilding', position: { x: pos.x, y: pos.y } },
          disabled: !hasAction,
        });
      }
    } else {
      for (const kind of ['mine', 'extractor', 'refinery', 'purifier'] as BuildingKind[]) {
        if (!canBuildLocation(gameState, registry, currentPlayer, kind, pos)) continue;
        const def = registry.economy.buildings[kind];
        const ore = def?.costByLevel?.[0] ?? 0;
        const plasma = def?.plasmaCostByLevel?.[0] ?? 0;
        const me = gameState.players[currentPlayer];
        prompts.push({
          key: `build-${kind}`,
          label: BUILD_LABELS[kind] ?? 'Build',
          cost: `${ore}◈${plasma > 0 ? ` ${plasma}✦` : ''}`,
          action: { type: 'build', kind, position: { x: pos.x, y: pos.y } },
          disabled: me.ore < ore || me.plasma < plasma,
        });
        break; // one site, one build kind
      }
    }
  }

  return (
    <div className="g8-hud">
      {/* Objectives — top left */}
      {objectives.length > 0 && (
        <div className="g8-obj">
          <h4>Objectives</h4>
          {objectives.map((o, i) => (
            <React.Fragment key={i}>
              <div className="o-item"><span className="bullet" />{o.text}</div>
              {o.sub && <div className="o-sub">{o.sub}</div>}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* End turn — top centre */}
      <div className="g8-topcenter">
        <button className="g8-endturn" disabled={!humanTurn} onClick={onEndTurn}>
          End Turn
        </button>
        <div className="g8-turntab">{turnLabel}</div>
      </div>

      {/* Hostile intel card — bottom right */}
      {enemy && enemyType && (
        <div className="g8-card g8-enemy">
          <div className="e-head">
            <span>{enemyType.name}</span>
            <span className="e-fac">{enemyFaction?.name ?? `P${enemy.owner + 1}`}</span>
          </div>
          <div className="e-row">
            <span className="k">HP</span>
            <HpPips hp={enemy.hp} max={enemyType.maxHP} />
            <span className="num">{enemy.hp}/{enemyType.maxHP}</span>
          </div>
          <div className="e-row"><span className="k">Atk</span><span className="num">{enemyType.attack}</span></div>
          <div className="e-row"><span className="k">Def</span><span className="num">{enemyType.defence}</span></div>
          <div className="e-row"><span className="k">Move</span><span className="num">{enemyType.movement}</span></div>
          <div className="e-row"><span className="k">Range</span><span className="num">{enemyType.attackRange}</span></div>
          {(enemyType.abilities?.length ?? 0) > 0 && (
            <div className="e-abil">
              <div className="mini-title">Abilities</div>
              {enemyType.abilities!.slice(0, 3).map(a => (
                <div key={a.id}>
                  <div className="a-name">{a.name}</div>
                  <p className="a-info">
                    {[
                      a.range != null ? `Range ${a.range}` : null,
                      a.cooldown != null ? `Cooldown ${a.cooldown}` : null,
                    ].filter(Boolean).join(' · ') || 'Special'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Site actions (found/capture city, build/upgrade REB) — bottom centre */}
      {prompts.length > 0 && (
        <div className="g8-prompts">
          {prompts.map(p => (
            <button
              key={p.key}
              className="g8-prompt"
              disabled={p.disabled}
              onClick={() => executeAction(p.action)}
            >
              <span className="pl">{p.label}</span>
              {p.cost && <span className="pc">{p.cost}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Bottom strip: faction turn tag + unit tray */}
      <div className="g8-bottombar">
        <div className={`g8-turntag${hiveish ? ' hostile' : ''}`}>
          <span>{faction?.name ?? `Player ${currentPlayer + 1}`} Turn</span>
        </div>
        <div className="g8-tray">
          {mine.slice(0, TRAY_MAX).map(u => (
            <TraySlot key={u.id} icon={UNIT_ICONS[u.typeId] ?? '❔'}
              hpFrac={u.hp / (registry.unitTypes[u.typeId]?.maxHP || u.hp || 1)}
              active={u.id === selectedUnitId}
              onClick={() => selectUnit(u.id)} />
          ))}
          {mine.length > TRAY_MAX && <span className="g8-more">+{mine.length - TRAY_MAX}</span>}
          {seen.length > 0 && <span className="g8-tray-gap" />}
          {seen.slice(0, TRAY_MAX).map(u => (
            <TraySlot key={u.id} icon={UNIT_ICONS[u.typeId] ?? '❔'} hostile
              hpFrac={u.hp / (registry.unitTypes[u.typeId]?.maxHP || u.hp || 1)}
              active={u.id === selectedUnitId}
              onClick={() => selectUnit(u.id)} />
          ))}
          {seen.length > TRAY_MAX && <span className="g8-more">+{seen.length - TRAY_MAX}</span>}
        </div>
      </div>
    </div>
  );
}

function TraySlot({ icon, hpFrac, active, hostile, onClick }: {
  icon: string;
  hpFrac: number;
  active?: boolean;
  hostile?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`g8-slot${hostile ? ' hostile' : ''}${active ? ' active' : ''}`}
      onClick={onClick}
    >
      <span aria-hidden>{icon}</span>
      <span className="tbar"><i style={{ width: `${Math.max(0, Math.min(1, hpFrac)) * 100}%` }} /></span>
    </button>
  );
}

/** Short segmented HP row (capped at 12 pips, reference-style). */
function HpPips({ hp, max }: { hp: number; max: number }) {
  const count = Math.max(1, Math.min(12, max));
  const filled = Math.round((Math.max(0, hp) / (max || 1)) * count);
  return (
    <span className="g8-pips">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`g8-pip${i < filled ? ' on' : ''}`} />
      ))}
    </span>
  );
}
