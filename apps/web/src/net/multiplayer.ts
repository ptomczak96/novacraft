import { Peer, type DataConnection } from 'peerjs';
import type { Action, GameConfig } from '@tactica/engine';
import { useGameStore } from '../store/gameStore.js';

// Peer-to-peer 1v1 over WebRTC (PeerJS free public broker) — no server, no deploy, no keys.
// The room code IS the host's peer id (namespaced to avoid global collisions); the guest
// connects to it. Host = seat 0, guest = seat 1. The engine is deterministic, so we only
// relay actions + the initial {seed, factions, config} handshake.
const PREFIX = 'rigbound-';

let peer: Peer | null = null;
let conn: DataConnection | null = null;
let mySeat: number | null = null;

const store = () => useGameStore.getState();
const sendAction = (a: Action) => conn?.send({ type: 'action', action: a });

function patch(p: Partial<NonNullable<ReturnType<typeof store>['mpStatus']>>, room: string) {
  const cur = store().mpStatus ?? { room, seat: null, peers: 0, error: null };
  store().setMpStatus({ ...cur, ...p });
}

function friendly(err: { type?: string; message?: string }): string {
  switch (err.type) {
    case 'unavailable-id': return 'That room code is already in use — go back and Host again for a fresh code.';
    case 'peer-unavailable': return 'No host found for that code. Check the code, and make sure the host clicked "Host game" first.';
    case 'browser-incompatible': return 'This browser can’t do peer-to-peer — try Chrome.';
    case 'network': case 'server-error': case 'socket-error': return 'Network problem reaching the matchmaking broker — retry in a moment.';
    default: return err.message || 'Connection error.';
  }
}

// Wire a data connection: relay inbound actions, and (guest side) start on the handshake.
function wire(c: DataConnection, room: string, onStart: (p: { seed: number; factions: [string, string]; config: GameConfig }) => void) {
  conn = c;
  c.on('open', () => patch({ peers: 2 }, room));
  c.on('data', (raw: unknown) => {
    const msg = raw as { type?: string; action?: Action; seed?: number; factions?: [string, string]; config?: GameConfig };
    if (msg.type === 'action' && msg.action) store().receiveRemoteAction(msg.action);
    else if (msg.type === 'start' && msg.config) onStart({ seed: msg.seed!, factions: msg.factions!, config: msg.config });
  });
  c.on('close', () => patch({ error: 'Opponent disconnected.' }, room));
  c.on('error', (e) => patch({ error: friendly(e as { type?: string; message?: string }) }, room));
}

/** Host a room (seat 0): become the peer whose id == the room code, and wait for the guest. */
export function hostRoom(room: string) {
  leaveRoom();
  mySeat = 0;
  store().setMpStatus({ room, seat: 0, peers: 1, error: null });
  peer = new Peer(PREFIX + room);
  peer.on('open', () => patch({ seat: 0, peers: 1 }, room));
  peer.on('connection', (c) => wire(c, room, () => { /* host initiates the start */ }));
  peer.on('error', (e) => patch({ error: friendly(e) }, room));
}

/** Join a room by code (seat 1): connect to the host's peer and start on their handshake. */
export function joinRoom(room: string) {
  leaveRoom();
  mySeat = 1;
  store().setMpStatus({ room, seat: 1, peers: 1, error: null });
  peer = new Peer();
  peer.on('open', () => {
    const c = peer!.connect(PREFIX + room, { reliable: true }); // reliable+ordered = lockstep-safe
    wire(c, room, ({ seed, factions, config }) =>
      store().startNetworkGame({ seat: 1, factions, seed, config, send: sendAction }));
  });
  peer.on('error', (e) => patch({ error: friendly(e) }, room));
}

/** Host only: broadcast the agreed {seed, factions, config} and start locally. */
export function startMatch(factions: [string, string], seed: number, config: GameConfig) {
  conn?.send({ type: 'start', seed, factions, config });
  store().startNetworkGame({ seat: mySeat ?? 0, factions, seed, config, send: sendAction });
}

export function leaveRoom() {
  conn?.close(); conn = null;
  peer?.destroy(); peer = null;
  mySeat = null;
  store().leaveMultiplayer();
}

/** A short, unambiguous room code. */
export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
