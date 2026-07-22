import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { MapView } from './MapView.js';
import { EditorPanel } from './EditorPanel.js';
import { Inspector } from './Inspector.js';
import { UnitSheet } from './UnitSheet.js';
import { CombatLog } from './CombatLog.js';
import { TechTreeView } from './TechTreeView.js';
import { LevelUpModal } from './LevelUpModal.js';
import type { Action } from '@tactica/engine';
import { getLegalActions, getVisibleState, playerEconomy } from '@tactica/engine';
import { GreedyBot, RandomBot } from '@tactica/bots';
import type { Bot } from '@tactica/bots';
import { ResourceBreakdown } from './EconomyBreakdown.js';
import { CoachPanel } from './CoachPanel.js';
import { describeAction } from '../data/coach.js';
import type { CoachMeta } from '../data/coach.js';

// Persistent bot instances (per player slot) so each bot keeps its PRNG state across turns.
const BOT_CACHE: Record<string, Bot> = {};
function getBot(player: number, setting: string): Bot {
  const key = `${player}:${setting}`;
  if (!BOT_CACHE[key]) {
    BOT_CACHE[key] = setting === 'random' ? new RandomBot(1000 + player) : new GreedyBot(undefined, 5000 + player);
  }
  return BOT_CACHE[key];
}

export function GameScreen() {
  const {
    gameState, visibleState, config, registry, legalActions,
    selectedUnitId, showInterstitial, dismissInterstitial,
    executeAction, undo, saveGame, setScreen,
    editorOpen, setEditorOpen, inspectorOpen, setInspectorOpen,
    botSettings, autoPlay, setAutoPlay,
    coachEnabled, setCoachEnabled,
  } = useGameStore();

  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;

  // Tech tree panel. Research is dispatched as an engine action so it's tracked
  // per player and persists with the game state (and save/replay).
  const [techOpen, setTechOpen] = useState(false);
  const [showIncome, setShowIncome] = useState(false);
  const [showPlasma, setShowPlasma] = useState(false);
  // Coaching: when on, a bot plays its moves but HALTS before ending its turn, so you can
  // inspect the board from the bot's point of view and comment before advancing.
  const [botTurnHalted, setBotTurnHalted] = useState(false);
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

    // Use the real bot classes (packages/bots), fed the ENGINE's real legal actions so the
    // bot can found/capture/build — not the old inline stub that picked random moves.
    const bot = getBot(currentPlayer, botSetting);
    const visible = getVisibleState(state.gameState, currentPlayer, state.registry);
    const action: Action = bot.chooseAction(visible, state.registry, actions);

    // Coaching: don't auto-end the bot's turn — halt so the human can review + comment.
    if (state.coachEnabled && action.type === 'endTurn') { setBotTurnHalted(true); return; }

    // Coaching: capture the bot's scored candidates (its "why did you do this?").
    let coachMeta: CoachMeta | undefined;
    if (state.coachEnabled) {
      if (bot.scoreAction) {
        const scored = actions
          .map(a => ({ a, score: bot.scoreAction!(a, visible, state.registry) }))
          .sort((x, y) => y.score - x.score);
        const top = scored.slice(0, 8);
        if (!top.some(s => s.a === action)) {
          top.push({ a: action, score: scored.find(s => s.a === action)?.score ?? 0 });
        }
        coachMeta = {
          actor: 'ai',
          candidates: top.map(({ a, score }) => ({
            desc: describeAction(a, state.gameState!, state.unitLabels, state.registry),
            score: Math.round(score * 10) / 10,
            chosen: a === action,
          })),
        };
      } else {
        coachMeta = { actor: 'ai' };
      }
    }

    state.executeAction(action, coachMeta);
  }, []);

  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    const currentBot = botSettings[gameState.currentPlayer];
    if (currentBot === 'human') return;
    if (botTurnHalted) return; // waiting for the human to click "End Bot Turn"

    const timer = setTimeout(doBotTurn, autoPlay ? 100 : 500);
    return () => clearTimeout(timer);
  }, [gameState?.currentPlayer, gameState?.turn, gameState?.actionLog.length, botSettings, autoPlay, doBotTurn, botTurnHalted]);

  // Clear the halt whenever the turn advances (a new player is up).
  useEffect(() => { setBotTurnHalted(false); }, [gameState?.currentPlayer, gameState?.turn]);

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
    a.download = `rigbound-save-turn${gameState.turn}.json`;
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

  // Coaching: the human submits the bot's end-of-turn after reviewing its moves.
  const handleEndBotTurn = () => {
    setBotTurnHalted(false);
    useGameStore.getState().executeAction({ type: 'endTurn' }, { actor: 'ai' });
  };

  // Per-city income breakdown (shown on hover over the ore / plasma totals). A single
  // structured pass from the engine feeds both the ore and plasma tooltips; blocked
  // REBs (enemy sitting on them) are reported but excluded from the totals.
  const economy = playerEconomy(gameState, currentPlayer, registry);
  const hasPlasma = economy.some(c => c.plasma.sources.length > 0);

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
            <span
              style={{ color: 'var(--warning)', position: 'relative', cursor: 'help' }}
              onMouseEnter={() => setShowIncome(true)}
              onMouseLeave={() => setShowIncome(false)}
            >
              {player.ore}◈
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
              {player.plasma}✦
              {showPlasma && hasPlasma && (
                <div className="eco-tooltip">
                  <ResourceBreakdown resource="plasma" cities={economy} />
                </div>
              )}
            </span>
          </div>
          <div className="top-bar-actions">
            {botSettings[currentPlayer] !== 'human' && botTurnHalted && (
              <button className="primary" onClick={handleEndBotTurn}>
                End {faction?.name ?? 'Bot'}'s Turn ▶
              </button>
            )}
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
            <button className={coachEnabled ? 'danger' : 'ghost'} onClick={() => setCoachEnabled(!coachEnabled)}>
              {coachEnabled ? 'Coach ✓' : 'Coach'}
            </button>
            <button className="ghost" onClick={() => setScreen('setup')}>Menu</button>
          </div>
        </div>

        {/* Map */}
        <MapView />

        {/* Coaching sidebar (self-hides when disabled) */}
        <CoachPanel />

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

      {/* Tech tree overlay — shows the current player's research (from game state) */}
      {techOpen && (
        <TechTreeView
          factionName={faction?.name || `Player ${currentPlayer + 1}`}
          factionId={faction?.id ?? 'vanguard'}
          researched={new Set(player.researchedTechs)}
          onResearch={handleResearch}
          onClose={() => setTechOpen(false)}
        />
      )}
    </div>
  );
}
