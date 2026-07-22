import React from 'react';
import { useGameStore } from '../store/gameStore.js';

/**
 * Game-event sound effects (SCI-FI UI SFX pack, trimmed + vendored in
 * public/audio/sfx). Subscribes to the store and diffs state — the engine's
 * actionLog drives action sounds (works for bot actions too), the combat
 * event drives kill sounds, and phase drives the end-of-game ring.
 * SFX are always on — the mute toggle only silences the soundtrack.
 */
const SFX = {
  select: ['/audio/sfx/select.wav', 0.3],
  move: ['/audio/sfx/move.wav', 0.32],
  attack: ['/audio/sfx/attack.wav', 0.5],
  death: ['/audio/sfx/death.wav', 0.5],
  endTurn: ['/audio/sfx/end-turn.wav', 0.3],
  capture: ['/audio/sfx/capture.wav', 0.55],
  victory: ['/audio/sfx/victory.wav', 0.55],
  recruit: ['/audio/sfx/recruit.wav', 0.4],
  research: ['/audio/sfx/research.wav', 0.4],
} as const;

type SfxName = keyof typeof SFX;

const cache = new Map<string, HTMLAudioElement>();

function play(name: SfxName, delayMs = 0): void {
  const [src, volume] = SFX[name];
  const fire = () => {
    let base = cache.get(src);
    if (!base) {
      base = new Audio(src);
      base.preload = 'auto';
      cache.set(src, base);
    }
    const node = base.cloneNode(true) as HTMLAudioElement;
    node.volume = volume;
    void node.play().catch(() => { /* pre-gesture autoplay block */ });
  };
  if (delayMs > 0) setTimeout(fire, delayMs);
  else fire();
}

/** Action type → sound. Unlisted actions are silent. */
const ACTION_SOUND: Record<string, SfxName> = {
  move: 'move',
  attack: 'attack',
  slash: 'attack',
  endTurn: 'endTurn',
  recruit: 'recruit',
  research: 'research',
  captureCity: 'capture',
  foundCity: 'recruit',
  build: 'recruit',
};

export function GameSfx() {
  React.useEffect(() => {
    const unsub = useGameStore.subscribe((state, prev) => {
      // New engine actions (log only ever grows within a game; it shrinks on
      // undo/new game, which stays silent).
      const log = state.gameState?.actionLog;
      const prevLog = prev.gameState?.actionLog;
      if (log && prevLog && log.length > prevLog.length && log.length - prevLog.length <= 3) {
        for (const action of log.slice(prevLog.length)) {
          const name = ACTION_SOUND[action.type];
          if (name) play(name);
        }
      }

      // Kills ride the combat event, slightly after the impact.
      const ev = state.lastCombatEvent;
      if (ev && ev.seq !== prev.lastCombatEvent?.seq && (ev.defenderKilled || ev.attackerKilled)) {
        play('death', 260);
      }

      // Unit selection blip.
      if (
        state.selectedUnitId !== null &&
        state.selectedUnitId !== prev.selectedUnitId
      ) {
        play('select');
      }

      // Game over.
      if (state.gameState?.phase === 'finished' && prev.gameState?.phase === 'playing') {
        play('victory', 400);
      }
    });
    return unsub;
  }, []);
  return null;
}
