import type { Coord, GameMap, Unit, DataRegistry } from './types.js';

interface PathNode {
  x: number;
  y: number;
  cost: number;
}

/** Returns all reachable tiles within movement range, with their costs. */
export function getReachableTiles(
  unit: Unit,
  unitType: { movement: number; traits: string[]; conditions?: string[] },
  map: GameMap,
  units: Unit[],
  registry: DataRegistry,
  movementBonus: number = 0,
  bumpEnemies: boolean = false, // blind units may target enemy tiles (to "bump"/reveal)
): Map<string, number> {
  const maxMove = unitType.movement + movementBonus;
  const reachable = new Map<string, number>(); // "x,y" -> cost
  const ignoresTerrain = unitType.traits.includes('ignoresTerrainCost');
  // By DEFAULT no unit may move onto mountains; only units with a mountain-access
  // condition can (mountain_defense / mountain_shooter / mountain_sight). See docs/conditions.md.
  const conds = unitType.conditions ?? [];
  const canClimbMountains = conds.includes('mountain_defense') || conds.includes('mountain_shooter') || conds.includes('mountain_sight');
  const isFlying = unitType.traits.includes('flying');
  const isAquatic = unitType.traits.includes('aquatic');

  // BFS / Dijkstra-lite with priority queue (simple sorted array for small grids)
  const queue: PathNode[] = [{ x: unit.position.x, y: unit.position.y, cost: 0 }];
  const visited = new Map<string, number>();
  visited.set(`${unit.position.x},${unit.position.y}`, 0);

  // Occupied positions (by other units) — can't move through enemy units
  const occupiedByEnemy = new Set<string>();
  const occupiedByFriendly = new Set<string>();
  for (const u of units) {
    if (u.id === unit.id) continue;
    const key = `${u.position.x},${u.position.y}`;
    if (u.owner === unit.owner) {
      occupiedByFriendly.add(key);
    } else {
      occupiedByEnemy.add(key);
    }
  }

  while (queue.length > 0) {
    // Sort by cost (cheap priority queue)
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    const currentKey = `${current.x},${current.y}`;

    if (current.cost > (visited.get(currentKey) ?? Infinity)) continue;

    // Can stop here if not occupied by friendly unit (and not the start)
    if (current.cost > 0 && !occupiedByFriendly.has(currentKey) && !occupiedByEnemy.has(currentKey)) {
      reachable.set(currentKey, current.cost);
    }

    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) continue;

      const tile = map.tiles[ny][nx];
      const terrain = registry.terrainTypes[tile.terrain];
      if (!terrain) continue;

      // Mountains are impassable unless the unit has a mountain-access condition.
      if (terrain.id === 'mountain' && !canClimbMountains) continue;

      // Check passability
      if (!isFlying) {
        if (!terrain.passable && !isAquatic) continue;
        if (terrain.id === 'water' && !isAquatic) continue;
        if (!terrain.passable && terrain.id !== 'water') continue;
      }

      // Can't move through enemy units. Blind units may *target* an adjacent enemy
      // tile as a "bump" destination (handled specially on apply) but never path
      // through it, so it's added to reachable without being expanded.
      const nKey = `${nx},${ny}`;
      if (occupiedByEnemy.has(nKey)) {
        if (bumpEnemies) {
          const bumpCost = current.cost + 1;
          if (bumpCost <= maxMove && !reachable.has(nKey)) reachable.set(nKey, bumpCost);
        }
        continue;
      }

      const moveCost = 1; // All passable terrain costs 1 (terrain penalties ignored)
      const newCost = current.cost + moveCost;

      if (newCost > maxMove) continue;

      const prevCost = visited.get(nKey);
      if (prevCost !== undefined && prevCost <= newCost) continue;

      visited.set(nKey, newCost);
      queue.push({ x: nx, y: ny, cost: newCost });
    }
  }

  return reachable;
}

/** Manhattan distance */
export function distance(a: Coord, b: Coord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Chebyshev distance — diagonals count as 1, used for attack range checks. */
export function inRange(a: Coord, b: Coord, range: number): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= range;
}
