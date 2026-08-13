import { previewCombat, pushDir } from '@tactica/engine';
import type { Coord, DataRegistry, GameState, Unit } from '@tactica/engine';

/**
 * Into-the-Breach-style outcome telegraphing (render-side, READ-ONLY).
 * Push prediction mirrors the engine's resolvePush exactly (packages/engine/
 * src/push.ts): light units slide one tile; driven into a unit / building /
 * mountain / map edge they COLLIDE for 2 (a light obstacle also takes 2);
 * pushed into impassable void terrain they die; heavies don't move.
 */

export const PREVIEW_COLLIDE_DAMAGE = 2;

export interface PushPreview {
  unitId: number;
  from: Coord;
  dir: { dx: number; dy: number };
  outcome: 'slide' | 'collide' | 'void' | 'immune';
  /** Landing tile (slide) or the obstacle tile collided with (collide/void). */
  dest: Coord;
  /** Damage the pushed unit takes (collide) — void is lethal, slide is 0. */
  damage: number;
  /** A LIGHT unit collided with also takes damage. */
  obstacle?: { unitId: number; damage: number };
}

export function predictPush(
  state: GameState, registry: DataRegistry, victim: Unit, dx: number, dy: number,
): PushPreview {
  const base: Omit<PushPreview, 'outcome' | 'dest' | 'damage'> = {
    unitId: victim.id, from: { ...victim.position }, dir: { dx, dy },
  };
  const dest = { x: victim.position.x + dx, y: victim.position.y + dy };
  if (dx === 0 && dy === 0) return { ...base, outcome: 'immune', dest, damage: 0 };
  if (registry.unitTypes[victim.typeId]?.unitClass !== 'light') {
    return { ...base, outcome: 'immune', dest, damage: 0 };
  }
  const inBounds = dest.y >= 0 && dest.y < state.map.height && dest.x >= 0 && dest.x < state.map.width;
  if (!inBounds) {
    return { ...base, outcome: 'collide', dest: { ...victim.position }, damage: PREVIEW_COLLIDE_DAMAGE };
  }
  const tile = state.map.tiles[dest.y][dest.x];
  const terrain = registry.terrainTypes[tile.terrain];
  if (terrain && !terrain.passable) {
    return { ...base, outcome: 'void', dest, damage: Infinity };
  }
  const occupant = state.units.find(u => u.id !== victim.id && u.position.x === dest.x && u.position.y === dest.y);
  const building = state.buildings.some(b => b.position.x === dest.x && b.position.y === dest.y);
  const isMountain = terrain?.id === 'mountain';
  if (occupant || building || isMountain) {
    return {
      ...base, outcome: 'collide', dest, damage: PREVIEW_COLLIDE_DAMAGE,
      obstacle: occupant && registry.unitTypes[occupant.typeId]?.unitClass === 'light'
        ? { unitId: occupant.id, damage: PREVIEW_COLLIDE_DAMAGE }
        : undefined,
    };
  }
  return { ...base, outcome: 'slide', dest, damage: 0 };
}

const NEIGHBORS8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

/** Percussive Shells preview: combat damage to a LIGHT unit on the impact
 *  tile, plus every neighbouring unit shoved outward from the blast. */
export function previewPercussive(
  state: GameState, registry: DataRegistry, titan: Unit, impact: Coord,
): { centerDamage: number | null; centerUnitId: number | null; pushes: PushPreview[] } {
  const titanType = registry.unitTypes[titan.typeId];
  let centerDamage: number | null = null;
  let centerUnitId: number | null = null;
  const center = state.units.find(u => u.position.x === impact.x && u.position.y === impact.y);
  if (center && titanType && registry.unitTypes[center.typeId]?.unitClass === 'light') {
    const result = previewCombat(
      titan, titanType, center, registry.unitTypes[center.typeId]!,
      state.map, registry, state.config.combatConfig,
    );
    centerDamage = result.attackerDamage;
    centerUnitId = center.id;
  }
  const pushes: PushPreview[] = [];
  for (const [dx, dy] of NEIGHBORS8) {
    const u = state.units.find(un => un.position.x === impact.x + dx && un.position.y === impact.y + dy);
    if (u) pushes.push(predictPush(state, registry, u, dx, dy));
  }
  return { centerDamage, centerUnitId, pushes };
}

/** Ram preview: the adjacent enemy shoved one tile away from the Vindrace. */
export function previewRam(
  state: GameState, registry: DataRegistry, vindrace: Unit, target: Coord,
): PushPreview | null {
  const victim = state.units.find(
    u => u.owner !== vindrace.owner && u.position.x === target.x && u.position.y === target.y,
  );
  if (!victim) return null;
  const d = pushDir(vindrace.position, victim.position);
  return predictPush(state, registry, victim, d.dx, d.dy);
}
