import type { GameMap, GameState, Unit, CityState, PlayerId, TileVisibility, DataRegistry } from './types.js';

/** An all-`false` explored grid sized to the map (one per player). */
export function makeExploredGrid(width: number, height: number): boolean[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => false));
}

/**
 * Tiles a player can see RIGHT NOW ('visible'); everything else is 'hidden'.
 * Persistent "discovered" memory (fog vs cloud) is layered on separately from the
 * stored `explored` grid — see getVisibleState. Sources of current sight:
 *   - each owned unit reveals a square of Chebyshev radius = its `visibility`
 *     (0 = own tile only, 1 = 3×3, 2 = 5×5, …), blocked by sight-blocking terrain;
 *   - each owned city reveals its whole territory (base 3×3 + claimed extra tiles).
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

  // Owned city territories are always currently visible.
  const r = registry.economy.city.territoryRadius;
  for (const c of cities) {
    if (c.owner !== playerId) continue;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (inBounds(c.position.x + dx, c.position.y + dy)) visibility[c.position.y + dy][c.position.x + dx] = 'visible';
      }
    }
    for (const t of c.extraTerritory ?? []) {
      if (inBounds(t.x, t.y)) visibility[t.y][t.x] = 'visible';
    }
  }

  // Each owned unit reveals a square of its visibility radius.
  for (const unit of units) {
    if (unit.owner !== playerId) continue;
    const unitType = registry.unitTypes[unit.typeId];
    if (!unitType) continue;
    revealSquare(map, visibility, unit.position.x, unit.position.y, unitType.visibility, registry);
  }

  return visibility;
}

/** OR the player's current sight into their persistent explored grid (mutates state). */
export function updateExplored(state: GameState, playerId: PlayerId, registry: DataRegistry): void {
  const vis = computeVisibility(state.map, state.units, state.cities, playerId, registry);
  const grid = state.explored?.[playerId];
  if (!grid) return;
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (vis[y][x] === 'visible') grid[y][x] = true;
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
  // Origin always visible to itself
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
