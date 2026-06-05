import type { GameMap, Unit, PlayerId, TileVisibility, DataRegistry } from './types.js';

/**
 * Compute visibility for a player using simple radius-with-blockers.
 * Each unit reveals tiles within its sight range, blocked by sight-blocking terrain.
 */
export function computeVisibility(
  map: GameMap,
  units: Unit[],
  playerId: PlayerId,
  registry: DataRegistry,
  previousVisibility?: TileVisibility[][],
): TileVisibility[][] {
  const visibility: TileVisibility[][] = [];

  // Initialize from previous state (explored stays explored) or all hidden
  for (let y = 0; y < map.height; y++) {
    visibility[y] = [];
    for (let x = 0; x < map.width; x++) {
      if (previousVisibility && previousVisibility[y][x] !== 'hidden') {
        visibility[y][x] = 'explored';
      } else {
        visibility[y][x] = 'hidden';
      }
    }
  }

  // City tiles owned by player grant visibility on their tile
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y][x];
      if (tile.isCity && tile.owner === playerId) {
        visibility[y][x] = 'visible';
        // Cities see adjacent tiles
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
            visibility[ny][nx] = 'visible';
          }
        }
      }
    }
  }

  // Each owned unit reveals tiles
  const playerUnits = units.filter(u => u.owner === playerId);
  for (const unit of playerUnits) {
    const unitType = registry.unitTypes[unit.typeId];
    if (!unitType) continue;
    const sightRange = unitType.sightRange;
    revealFromPoint(map, visibility, unit.position.x, unit.position.y, sightRange, registry);
  }

  return visibility;
}

function revealFromPoint(
  map: GameMap,
  visibility: TileVisibility[][],
  ox: number,
  oy: number,
  range: number,
  registry: DataRegistry,
): void {
  // Simple approach: check all tiles within Manhattan distance <= range
  // Use line-of-sight check with bresenham-like blocking
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const tx = ox + dx;
      const ty = oy + dy;
      if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) continue;
      if (Math.abs(dx) + Math.abs(dy) > range) continue;

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

  // Step through the line
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;

  while (true) {
    // Move to next cell
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }

    // Reached target
    if (cx === x1 && cy === y1) return true;

    // Check if this intermediate cell blocks sight
    if (cx < 0 || cx >= map.width || cy < 0 || cy >= map.height) return false;
    const tile = map.tiles[cy][cx];
    const terrain = registry.terrainTypes[tile.terrain];
    if (terrain && terrain.blocksSight) return false;
  }
}
