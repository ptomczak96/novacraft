import React, { useEffect, useCallback, useRef } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { MapView } from './MapView.js';
import { EditorPanel } from './EditorPanel.js';
import { Inspector } from './Inspector.js';
import { UnitSheet } from './UnitSheet.js';
import { CombatLog } from './CombatLog.js';
import type { Action } from '@tactica/engine';
import { getLegalActions } from '@tactica/engine';

export function GameScreen() {
  const {
    gameState, visibleState, config, registry, legalActions,
    selectedUnitId, showInterstitial, dismissInterstitial,
    executeAction, undo, saveGame, setScreen,
    editorOpen, setEditorOpen, inspectorOpen, setInspectorOpen,
    botSettings, autoPlay, setAutoPlay,
  } = useGameStore();

  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;

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
    if (botSetting === 'random') {
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

  return (
    <div className="game-screen">
      {/* Combat Log — left side */}
      <CombatLog />

      <div className="game-main">
        {/* Top Bar */}
        <div className="top-bar">
          <div className="turn-info">
            <span>Turn {gameState.turn}/{config.turnLimit}</span>
            <span className={`player-indicator p${currentPlayer}`}>
              {faction?.name || `Player ${currentPlayer + 1}`}
              {botSettings[currentPlayer] !== 'human' && ` (${botSettings[currentPlayer]})`}
            </span>
            <span style={{ color: 'var(--warning)' }}>
              {player.shard}◈
            </span>
            <span style={{ color: 'var(--p1-color, #5aa9e6)' }}>
              {player.plasma}✦
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
            {botSettings[currentPlayer] === 'human' && (
              <button className="primary" onClick={handleEndTurn}>End Turn</button>
            )}
            <button className="ghost" onClick={undo}>Undo</button>
            <button className="ghost" onClick={handleSave}>Save</button>
            <button className="ghost" onClick={handleCopyReplay}>Copy Replay</button>
            <button className="ghost" onClick={() => setInspectorOpen(!inspectorOpen)}>
              {inspectorOpen ? 'Hide' : 'Inspect'}
            </button>
            <button className="ghost" onClick={() => setEditorOpen(!editorOpen)}>
              {editorOpen ? 'Close Editor' : 'Editor'}
            </button>
            <button className="ghost" onClick={() => setScreen('setup')}>Menu</button>
          </div>
        </div>

        {/* Map */}
        <MapView />

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
              {gameState.winConditionMet === 'highestScoreAtLimit' && `Highest score at turn ${config.turnLimit}`}
            </p>
            <button className="primary" onClick={() => setScreen('setup')}>New Game</button>
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
      {editorOpen && <EditorPanel />}
    </div>
  );
}
