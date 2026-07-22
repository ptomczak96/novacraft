import type * as Party from 'partykit/server';

// Rigbound 1v1 relay. The engine is deterministic, so the server never touches game logic —
// it just (1) assigns each of the first two clients a fixed SEAT (0 = host, 1 = guest),
// (2) latches the host's START handshake ({seed, factions, config}) so the guest replays the
// SAME game, and (3) forwards every ACTION message to the other client. Fog is honour-system
// (both clients hold full state) — fine for trusted playtests.
export default class GameRoom implements Party.Server {
  constructor(readonly room: Party.Room) {}

  // The host's start handshake, kept so a guest joining after the host still gets it.
  private start: string | null = null;
  // conn.id -> seat (0/1). Third+ connections are rejected.
  private seats = new Map<string, number>();

  onConnect(conn: Party.Connection) {
    const taken = new Set(this.seats.values());
    const seat = !taken.has(0) ? 0 : !taken.has(1) ? 1 : -1;
    if (seat === -1) {
      conn.send(JSON.stringify({ type: 'full' }));
      conn.close();
      return;
    }
    this.seats.set(conn.id, seat);
    conn.send(JSON.stringify({ type: 'seat', seat }));
    // If the host already started, replay the handshake to this (guest) connection.
    if (this.start) conn.send(this.start);
    this.broadcastPresence();
  }

  onClose(conn: Party.Connection) {
    this.seats.delete(conn.id);
    // If everyone left, forget the game so the room can be reused.
    if (this.seats.size === 0) this.start = null;
    this.broadcastPresence();
  }

  onMessage(message: string, sender: Party.Connection) {
    let msg: { type?: string };
    try { msg = JSON.parse(message); } catch { return; }
    if (msg.type === 'start') this.start = message; // latch the handshake
    // Relay everything (start / action) to the OTHER client(s).
    for (const c of this.room.getConnections()) {
      if (c.id !== sender.id) c.send(message);
    }
  }

  // Tell both clients how many seats are filled (so the lobby knows when to enable "Start").
  private broadcastPresence() {
    const payload = JSON.stringify({ type: 'presence', count: this.seats.size });
    for (const c of this.room.getConnections()) c.send(payload);
  }
}
