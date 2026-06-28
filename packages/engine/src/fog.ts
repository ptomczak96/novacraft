import type {
  GameMap, GameState, Unit, CityState, PlayerId, PlayerMemory, TileVisibility, DataRegistry,
} from './types.js';

const cloneJSON = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** An empty fog memory sized to the map (one per player). */
export function makePlayerMemory(width: number, height: number): PlayerMemory {
  return {
    tiles: Array.from({ length: height }, () => Array.from({ length: width }, () => null)),
    buildings: [],
    cities: [],
  };
}

/**
 * Tiles a player can see RIGHT NOW ('visible'); everything else is 'hidden'.
 * Persistent "discovered" memory (fog vs cloud) is layered on separately via the
 * stored PlayerMemory — see getVisibleState. Sources of current sight:
 *   - each owned unit reveals a square of Chebyshev radius = its `visibility`
 *     (0 = own tile only, 1 = 3×3, 2 = 5×5, …), blocked by sight-blocking terrain;
 *   - each owned city reveals a square: a CAPITAL out to `capitalSightRadius`
 *     (5×5 by default), a normal city its `territoryRadius`; plus claimed extra tiles.
 */
export function computeVisibility(
  map: GameMap,
  units: Unit[],
  cities: CityState[],
  playerId: PlayerId,
  registry: DataRegistry,
): TileVisibility[][] {
  const visibility: TileVisibility[][] = [];
  for (let y = 0; y < map.height; y++) {
    visibility[y] = [];
    for (let x = 0; x < map.width; x++) visibility[y][x] = 'hidden';
  }

  const inBounds = (x: number, y: number) => x >= 0 && x < map.width && y >= 0 && y < map.height;
  const square = (cx: number, cy: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (inBounds(cx + dx, cy + dy)) visibility[cy + dy][cx + dx] = 'visible';
      }
    }
  };

  // Owned cities reveal a square around them (capitals see further) + extra territory.
  const { territoryRadius, capitalSightRadius } = registry.economy.city;
  for (const c of cities) {
    if (c.owner !== playerId) continue;
    square(c.position.x, c.position.y, c.isCapital ? capitalSightRadius : territoryRadius);
    for (const t of c.extraTerritory ?? []) {
      if (inBounds(t.x, t.y)) visibility[t.y][t.x] = 'visible';
    }
  }

  // Each owned unit reveals a square of its visibility radius (line-of-sight gated).
  for (const unit of units) {
    if (unit.owner !== playerId) continue;
    const unitType = registry.unitTypes[unit.typeId];
    if (!unitType) continue;
    revealSquare(map, visibility, unit.position.x, unit.position.y, unitType.visibility, registry);
  }

  return visibility;
}

/**
 * Snapshot everything currently visible to `playerId` into their fog memory
 * (mutates state). Tiles, buildings and cities in sight are recorded as their
 * current state; out-of-sight memory is left untouched (frozen last-seen).
 */
export function recordSight(state: GameState, playerId: PlayerId, registry: DataRegistry): void {
  const vis = computeVisibility(state.map, state.units, state.cities, playerId, registry);
  const mem = state.memory?.[playerId];
  if (!mem) return;
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (vis[y][x] !== 'visible') continue;
      mem.tiles[y][x] = cloneJSON(state.map.tiles[y][x]);

      const b = state.buildings.find(bb => bb.position.x === x && bb.position.y === y);
      mem.buildings = mem.buildings.filter(bb => !(bb.position.x === x && bb.position.y === y));
      if (b) mem.buildings.push(cloneJSON(b));

      const c = state.cities.find(cc => cc.position.x === x && cc.position.y === y);
      mem.cities = mem.cities.filter(cc => !(cc.position.x === x && cc.position.y === y));
      if (c) mem.cities.push(cloneJSON(c));
    }
  }
}

/** Reveal a Chebyshev-radius square around (ox,oy), each tile gated by line of sight. */
function revealSquare(
  map: GameMap,
  visibility: TileVisibility[][],
  ox: number,
  oy: number,
  range: number,
  registry: DataRegistry,
): void {
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const tx = ox + dx;
      const ty = oy + dy;
      if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) continue;
      if (hasLineOfSight(map, ox, oy, tx, ty, registry)) {
        visibility[ty][tx] = 'visible';
      }
    }
  }
}

/** Simple line of sight using bresenham. Blocked by sight-blocking terrain (not the endpoints). */
function hasLineOfSight(
  map: GameMap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  registry: DataRegistry,
): boolean {
  if (x0 === x1 && y0 === y1) return true;

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;

  while (true) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }

    if (cx === x1 && cy === y1) return true;

    if (cx < 0 || cx >= map.width || cy < 0 || cy >= map.height) return false;
    const tile = map.tiles[cy][cx];
    const terrain = registry.terrainTypes[tile.terrain];
    if (terrain && terrain.blocksSight) return false;
  }
}
