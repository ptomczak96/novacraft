import type { GameState, Unit, DataRegistry, Coord } from './types.js';

// Damage dealt by a COLLIDE — a pushed unit driven into a solid obstacle (another unit, a
// building, a mountain, or the map edge). Terminology: the forced move is a "push"; the
// impact against an obstacle is a "collide" (NOT a "bump" — bump is the movement-reveal
// mechanic for cloaked enemies / hidden impassable terrain). See docs/conditions.md.
export const COLLIDE_DAMAGE = 2;

/** Unit sign of (b - a) per axis → the push direction away from a source at `from`. */
export function pushDir(from: Coord, unit: Coord): { dx: number; dy: number } {
  return { dx: Math.sign(unit.x - from.x), dy: Math.sign(unit.y - from.y) };
}

/**
 * Push a LIGHT unit one tile in (dx,dy). Heavy/class-less units are immune (no-op).
 * Outcomes (mutates state; caller sweeps the dead):
 *  - empty passable tile → the unit slides there;
 *  - COLLIDE — driven into a mountain / another unit / a building / the map edge: it takes
 *    COLLIDE_DAMAGE and STAYS; if it collided with a LIGHT unit, that unit also takes
 *    COLLIDE_DAMAGE (a heavy takes 0);
 *  - impassable void terrain (water/lava/…): the unit falls in and DIES.
 * See docs (Titan "Percussive Shells" / Vindrace "Ram").
 */
export function resolvePush(state: GameState, victim: Unit, dx: number, dy: number, registry: DataRegistry): void {
  if (dx === 0 && dy === 0) return;
  const vt = registry.unitTypes[victim.typeId];
  if (vt?.unitClass !== 'light') return; // only light units are affected

  const dest = { x: victim.position.x + dx, y: victim.position.y + dy };
  const inBounds = dest.y >= 0 && dest.y < state.map.height && dest.x >= 0 && dest.x < state.map.width;
  if (!inBounds) { victim.hp -= COLLIDE_DAMAGE; return; } // collided with the map edge (a wall)

  const tile = state.map.tiles[dest.y][dest.x];
  const terrain = registry.terrainTypes[tile.terrain];

  // Impassable void terrain (water, lava, future chasm/acid) → fall in and die.
  if (terrain && !terrain.passable) { victim.hp = 0; return; }

  const occupant = state.units.find(u => u.id !== victim.id && u.position.x === dest.x && u.position.y === dest.y);
  const building = state.buildings.some(b => b.position.x === dest.x && b.position.y === dest.y);
  const isMountain = terrain?.id === 'mountain';

  if (occupant || building || isMountain) {
    // Collide: the pushed unit takes damage and stays; a LIGHT unit it collided with also
    // takes damage (a heavy obstacle-unit takes none).
    victim.hp -= COLLIDE_DAMAGE;
    if (occupant && registry.unitTypes[occupant.typeId]?.unitClass === 'light') occupant.hp -= COLLIDE_DAMAGE;
    return;
  }

  victim.position = dest; // clear tile → the unit slides across
}
