import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { MapView } from './MapView.js';
import { EditorPanel } from './EditorPanel.js';
import { Inspector } from './Inspector.js';
import { UnitSheet } from './UnitSheet.js';
import { CoachPanel } from './CoachPanel.js';
import { CombatLog } from './CombatLog.js';
import { Gen8Hud } from './gen8/Gen8Hud.js';
import { TechTreeView } from './TechTreeView.js';
import { LevelUpModal } from './LevelUpModal.js';
import type { Action } from '@tactica/engine';
import { getLegalActions, playerEconomy } from '@tactica/engine';
import { OdysseusBot, GreedyBot } from '@tactica/bots';
import { ResourceBreakdown } from './EconomyBreakdown.js';
import { PlasmaIcon } from './PlasmaIcon.js';

export function GameScreen() {
  const {
    gameState, visibleState, config, registry, legalActions,
    selectedUnitId, showInterstitial, dismissInterstitial,
    executeAction, undo, saveGame, setScreen,
    editorOpen, setEditorOpen, inspectorOpen, setInspectorOpen,
    botSettings, autoPlay, setAutoPlay,
    mySeat, mpStatus, tileTheme,
  } = useGameStore();

  // GEN 8 - 3D Tileset carries its own neon HUD skin (ported from
  // RIGBOUND_3js) over the map area; `?tileset=1` is the dev override.
  const gen8 = tileTheme === 'gen8_tileset3d' ||
    new URLSearchParams(window.location.search).get('tileset') === '1';

  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;

  // Tech tree panel. Research is dispatched as an engine action so it's tracked
  // per player and persists with the game state (and save/replay).
  const [techOpen, setTechOpen] = useState(false);
  const [showIncome, setShowIncome] = useState(false);
  const [showPlasma, setShowPlasma] = useState(false);

  // Online 1v1: a clear "Your Turn" banner the moment the turn passes to us.
  const [showYourTurn, setShowYourTurn] = useState(false);
  useEffect(() => {
    if (mySeat !== null && gameState?.currentPlayer === mySeat && gameState?.phase === 'playing') {
      setShowYourTurn(true);
      const t = setTimeout(() => setShowYourTurn(false), 2200);
      return () => clearTimeout(t);
    }
    setShowYourTurn(false);
  }, [gameState?.currentPlayer, mySeat, gameState?.phase]);
  const handleResearch = useCallback((id: string) => {
    executeAction({ type: 'research', techId: id });
  }, [executeAction]);

  // Bot play
  const doBotTurn = useCallback(() => {
    const state = useGameStore.getState();
    if (!state.gameState || state.gameState.phase !== 'playing') return;
    const currentPlayer = state.gameState.currentPlayer;
    const botSetting = state.botSettings[currentPlayer];
    if (botSetting === 'human') return;

    const actions = state.legalActions;
    if (actions.length === 0) return;

    let action: Action;
    if (botSetting === 'odysseus' && state.visibleState) {
      action = new OdysseusBot().chooseAction(state.visibleState, state.registry, actions);
    } else if (botSetting === 'achilles' && state.visibleState) {
      // Placeholder — Patrick's slot; runs the greedy evaluator until his AI lands.
      action = new GreedyBot().chooseAction(state.visibleState, state.registry, actions);
    } else if (botSetting === 'random') {
      action = actions[Math.floor(Math.random() * actions.length)];
    } else {
      // Greedy: simple heuristic — prefer attacks > moves > endTurn
      const attacks = actions.filter(a => a.type === 'attack');
      const recruits = actions.filter(a => a.type === 'recruit');
      const moves = actions.filter(a => a.type === 'move');
      if (attacks.length > 0) {
        action = attacks[0];
      } else if (recruits.length > 0) {
        action = recruits[0];
      } else if (moves.length > 0) {
        action = moves[Math.floor(Math.random() * moves.length)];
      } else {
        action = { type: 'endTurn' };
      }
    }

    state.executeAction(action);
  }, []);

  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    const currentBot = botSettings[gameState.currentPlayer];
    if (currentBot === 'human') return;

    const timer = setTimeout(doBotTurn, autoPlay ? 100 : 500);
    return () => clearTimeout(timer);
  }, [gameState?.currentPlayer, gameState?.turn, gameState?.actionLog.length, botSettings, autoPlay, doBotTurn]);

  if (!gameState || !visibleState) return null;

  const currentPlayer = gameState.currentPlayer;
  const player = gameState.players[currentPlayer];
  const faction = registry.factions[player.factionId];

  // The LOCAL viewer's seat: online we always view/act as our own seat, never the
  // opponent's — so we show OUR resources & tech and can only act on OUR turn.
  const viewer = mySeat ?? currentPlayer;
  const isMyTurn = mySeat === null || currentPlayer === mySeat;
  const viewerPlayer = gameState.players[viewer];
  const viewerFaction = registry.factions[viewerPlayer.factionId];

  const handleSave = () => {
    const json = saveGame();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tactica-save-turn${gameState.turn}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyReplay = () => {
    const json = saveGame();
    navigator.clipboard.writeText(json);
  };

  const handleEndTurn = () => {
    executeAction({ type: 'endTurn' });
  };

  const handleStep = () => {
    doBotTurn();
  };

  // Per-city income breakdown (shown on hover over the ore / plasma totals). A single
  // structured pass from the engine feeds both the ore and plasma tooltips; blocked
  // REBs (enemy sitting on them) are reported but excluded from the totals.
  const economy = playerEconomy(gameState, viewer, registry);
  const hasPlasma = economy.some(c => c.plasma.sources.length > 0);

  // A selected HOSTILE unit swaps the standard sheet for the GEN 8 red intel
  // card (see gen8hud.css `.g8-enemy-sel`).
  const enemySelected = gen8 && selectedUnitId != null &&
    visibleState.units.find(u => u.id === selectedUnitId)?.owner !== currentPlayer;

  return (
    <div className={`game-screen${gen8 ? ' gen8-skin' : ''}${enemySelected ? ' g8-enemy-sel' : ''}`}>
      {/* Combat Log — left side */}
      <CombatLog />

      <div className="game-main">
        {/* Top Bar */}
        <div className="top-bar">
          <img className="top-bar-logo" src="/rigbound-logo.png" alt="" aria-hidden />
          <div className="turn-info">
            <span>Turn {gameState.turn}{config.turnLimit > 0 ? `/${config.turnLimit}` : ''}</span>
            <span className={`player-indicator p${currentPlayer}`}>
              {faction?.name || `Player ${currentPlayer + 1}`}
              {botSettings[currentPlayer] !== 'human' && ` (${botSettings[currentPlayer]})`}
            </span>
            {mySeat != null && (
              <span className="player-indicator" style={{ background: currentPlayer === mySeat ? 'var(--accent)' : '#555' }}>
                {currentPlayer === mySeat ? 'Your turn' : 'Opponent’s turn — waiting'}
                {mpStatus?.room ? ` · ${mpStatus.room}` : ''}
              </span>
            )}
            <span
              style={{ color: 'var(--warning)', position: 'relative', cursor: 'help' }}
              onMouseEnter={() => setShowIncome(true)}
              onMouseLeave={() => setShowIncome(false)}
            >
              {viewerPlayer.ore}◈
              {showIncome && (
                <div className="eco-tooltip">
                  <ResourceBreakdown resource="ore" cities={economy} />
                </div>
              )}
            </span>
            <span
              style={{ color: 'var(--p1-color, #5aa9e6)', position: 'relative', cursor: hasPlasma ? 'help' : 'default' }}
              onMouseEnter={() => setShowPlasma(true)}
              onMouseLeave={() => setShowPlasma(false)}
            >
              {viewerPlayer.plasma}<PlasmaIcon />
              {showPlasma && hasPlasma && (
                <div className="eco-tooltip">
                  <ResourceBreakdown resource="plasma" cities={economy} />
                </div>
              )}
            </span>
          </div>
          <div className="top-bar-actions">
            {botSettings[currentPlayer] !== 'human' && (
              <>
                <button className="ghost" onClick={handleStep}>Step</button>
                <button className={autoPlay ? 'danger' : 'ghost'} onClick={() => setAutoPlay(!autoPlay)}>
                  {autoPlay ? 'Pause' : 'Auto'}
                </button>
              </>
            )}
            {botSettings[currentPlayer] === 'human' && isMyTurn && (
              <button className="primary" onClick={handleEndTurn}>End Turn</button>
            )}
            <button className="ghost" onClick={() => undo()}>Undo</button>
            <button className="ghost" onClick={handleSave}>Save</button>
            <button className="ghost" onClick={handleCopyReplay}>Copy Replay</button>
            <button className="ghost tech-btn" onClick={() => setTechOpen(true)} title="Research">
              <img src="/ui/tech-button.png" alt="" />
              Tech
            </button>
            <button className="ghost" onClick={() => setInspectorOpen(!inspectorOpen)}>
              {inspectorOpen ? 'Hide' : 'Inspect'}
            </button>
            <button className="ghost" onClick={() => setEditorOpen(!editorOpen)}>
              {editorOpen ? 'Close Editor' : 'Editor'}
            </button>
            <button className="ghost" onClick={() => setScreen('setup')}>Menu</button>
          </div>
        </div>

        {/* Map (GEN 8 wraps it so the ported HUD overlays the map area only) */}
        {gen8 ? (
          <div style={{ position: 'relative', flex: 1, display: 'flex', overflow: 'hidden' }}>
            <MapView />
            <Gen8Hud onEndTurn={handleEndTurn} />
          </div>
        ) : (
          <MapView />
        )}

        {/* City level-up choice (pops when an owned city has enough supply) */}
        <LevelUpModal />

        {/* Game Over */}
        {gameState.phase === 'finished' && (
          <div className="game-over-banner">
            <h2>
              {gameState.winner !== null
                ? `${registry.factions[gameState.players[gameState.winner].factionId]?.name || `Player ${gameState.winner + 1}`} Wins!`
                : 'Draw!'}
            </h2>
            <p>
              {gameState.winConditionMet === 'eliminateAllUnits' && 'All enemy units eliminated'}
              {gameState.winConditionMet === 'captureAllCities' && 'All cities captured'}
              {gameState.winConditionMet === 'captureCapital' && 'Enemy capital captured'}
              {gameState.winConditionMet === 'highestScoreAtLimit' && `Highest score at turn ${config.turnLimit}`}
            </p>
            <button className="primary" onClick={() => setScreen('setup')}>New Game</button>
          </div>
        )}

        {/* Online 1v1: transient "Your Turn" banner */}
        {showYourTurn && (
          <div className="your-turn-banner" onClick={() => setShowYourTurn(false)}>
            Your Turn
          </div>
        )}

        {/* Interstitial */}
        {showInterstitial && (
          <div className="interstitial" onClick={dismissInterstitial}>
            <h2 className={`p${currentPlayer}`} style={{ color: currentPlayer === 0 ? 'var(--p0-color)' : 'var(--p1-color)' }}>
              {faction?.name || `Player ${currentPlayer + 1}`}'s Turn
            </h2>
            <p>Pass the device — click anywhere to continue</p>
          </div>
        )}
      </div>

      {/* Unit Sheet — right side (before Inspector/Editor) */}
      <UnitSheet />

      {/* Side panels */}
      {inspectorOpen && <Inspector />}
      <CoachPanel />{/* self-gates on coachEnabled (Train vs AI) */}
      {editorOpen && <EditorPanel />}

      {/* Tech tree overlay — shows the current player's research (from game state) */}
      {techOpen && (
        <TechTreeView
          factionName={viewerFaction?.name || `Player ${viewer + 1}`}
          factionId={viewerPlayer.factionId}
          researched={new Set(viewerPlayer.researchedTechs)}
          onResearch={handleResearch}
          onClose={() => setTechOpen(false)}
        />
      )}
    </div>
  );
}
