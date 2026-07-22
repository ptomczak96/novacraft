import React, { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { EvoButton } from './evo/EvoControls.js';
import { hostRoom, joinRoom, startMatch, leaveRoom, makeRoomCode } from '../net/multiplayer.js';

/**
 * Online 1v1 lobby (PartyKit relay). Host creates a room code; the guest joins with it.
 * Once both are connected the host presses Start, which broadcasts the {seed, factions,
 * config} handshake so both clients replay the SAME deterministic game.
 */
export function MultiplayerLobby({ factions, seed, onClose }: {
  factions: [string, string];
  seed: number;
  onClose: () => void;
}) {
  const { config, mpStatus } = useGameStore();
  const [mode, setMode] = useState<'idle' | 'host' | 'join'>('idle');
  const [room, setRoom] = useState('');
  const [joinInput, setJoinInput] = useState('');

  const peers = mpStatus?.peers ?? 0;
  const seat = mpStatus?.seat;
  const error = mpStatus?.error;

  const cancel = () => { leaveRoom(); onClose(); };

  const doHost = () => { const c = makeRoomCode(); setRoom(c); setMode('host'); hostRoom(c); };
  const doJoin = () => {
    const c = joinInput.trim().toUpperCase();
    if (c.length < 4) return;
    setRoom(c); setMode('join'); joinRoom(c);
  };

  return (
    <div className="levelup-overlay">
      <div className="levelup-modal" style={{ minWidth: 420 }}>
        <div className="levelup-title">Online 1v1</div>

        {mode === 'idle' && (
          <>
            <p className="levelup-sub">Play on separate computers over the internet. One player hosts and shares the room code; the other joins with it.</p>
            <div className="setup-actions" style={{ marginTop: 16, justifyContent: 'center' }}>
              <EvoButton primary onClick={doHost}>Host game</EvoButton>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 14 }}>
              <input
                placeholder="Room code"
                value={joinInput}
                onChange={e => setJoinInput(e.target.value.toUpperCase())}
                maxLength={6}
                style={{ textTransform: 'uppercase', width: 120, textAlign: 'center', letterSpacing: '0.15em' }}
              />
              <EvoButton onClick={doJoin}>Join game</EvoButton>
            </div>
          </>
        )}

        {mode === 'host' && (
          <>
            <p className="levelup-sub">Share this code with your opponent:</p>
            <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '0.25em', margin: '10px 0', color: 'var(--accent)' }}>{room}</div>
            <p className="levelup-sub">
              {peers >= 2 ? 'Opponent connected — ready to start.' : 'Waiting for opponent to join…'} ({peers}/2)
            </p>
            <div className="setup-actions" style={{ marginTop: 16, justifyContent: 'center' }}>
              <EvoButton primary onClick={() => startMatch(factions, seed, config)}>
                {peers >= 2 ? 'Start match' : 'Waiting…'}
              </EvoButton>
              <EvoButton onClick={cancel}>Cancel</EvoButton>
            </div>
          </>
        )}

        {mode === 'join' && (
          <>
            <p className="levelup-sub">Joined room <b>{room}</b>{seat != null ? ` as Player ${seat + 1}` : ''}.</p>
            <p className="levelup-sub">{peers >= 2 ? 'Waiting for the host to start the match…' : 'Connecting…'} ({peers}/2)</p>
            <div className="setup-actions" style={{ marginTop: 16, justifyContent: 'center' }}>
              <EvoButton onClick={cancel}>Cancel</EvoButton>
            </div>
          </>
        )}

        {error && <p className="levelup-sub" style={{ color: '#ff7a6a', marginTop: 10 }}>{error}</p>}
      </div>
    </div>
  );
}
