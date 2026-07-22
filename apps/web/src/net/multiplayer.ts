import PartySocket from 'partysocket';
import type { Action, GameConfig } from '@tactica/engine';
import { useGameStore } from '../store/gameStore.js';

// PartyKit host: the deployed relay in prod, the local `partykit dev` server otherwise.
const HOST = (import.meta.env.VITE_PARTYKIT_HOST as string | undefined) || 'localhost:1999';

let socket: PartySocket | null = null;
let mySeat: number | null = null;

const store = () => useGameStore.getState();
const send = (obj: unknown) => socket?.send(JSON.stringify(obj));
const sendAction = (a: Action) => send({ type: 'action', action: a });

function patchStatus(patch: Partial<NonNullable<ReturnType<typeof store>['mpStatus']>>, room: string) {
  const cur = store().mpStatus ?? { room, seat: null, peers: 0, error: null };
  store().setMpStatus({ ...cur, ...patch });
}

/** Open a socket to `room` and wire messages to the store. `isHost` only affects which seat
 *  we expect; the server assigns seats by arrival order (0 then 1). */
function connect(room: string, onStart: (p: { seed: number; factions: [string, string]; config: GameConfig }) => void) {
  leaveRoom();
  mySeat = null;
  socket = new PartySocket({ host: HOST, room });
  store().setMpStatus({ room, seat: null, peers: 0, error: null });

  socket.addEventListener('message', (e) => {
    let msg: any;
    try { msg = JSON.parse(e.data as string); } catch { return; }
    if (msg.type === 'seat') { mySeat = msg.seat; patchStatus({ seat: msg.seat }, room); }
    else if (msg.type === 'presence') patchStatus({ peers: msg.count }, room);
    else if (msg.type === 'full') patchStatus({ error: 'That room is full.' }, room);
    else if (msg.type === 'action') store().receiveRemoteAction(msg.action as Action);
    else if (msg.type === 'start') {
      onStart({ seed: msg.seed, factions: msg.factions, config: msg.config });
    }
  });
  socket.addEventListener('error', () => patchStatus({ error: 'Connection error.' }, room));
}

/** Host a room: connect and wait for a guest (seat 0). */
export function hostRoom(room: string) {
  // The host ignores inbound `start` (it initiates it via startMatch instead).
  connect(room, () => { /* host initiates */ });
}

/** Join a room by code (seat 1). Starts the game when the host sends the handshake. */
export function joinRoom(room: string) {
  connect(room, ({ seed, factions, config }) => {
    store().startNetworkGame({ seat: mySeat ?? 1, factions, seed, config, send: sendAction });
  });
}

/** Host only: broadcast the agreed {seed, factions, config} and start locally. */
export function startMatch(factions: [string, string], seed: number, config: GameConfig) {
  send({ type: 'start', seed, factions, config });
  store().startNetworkGame({ seat: mySeat ?? 0, factions, seed, config, send: sendAction });
}

export function leaveRoom() {
  socket?.close();
  socket = null;
  mySeat = null;
  store().leaveMultiplayer();
}

/** A short human-friendly room code. */
export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
