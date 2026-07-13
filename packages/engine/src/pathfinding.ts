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
  buildings: { position: Coord }[] = [], // for burrowed units: can't move under buildings
  bumps?: Map<string, string>, // OUT: for blind/burrowed units, impassable-tile key → land-tile key
): Map<string, number> {
  let maxMove = unitType.movement + movementBonus;
  const ignoresTerrain = unitType.traits.includes('ignoresTerrainCost');
  // "Burrowed" (Wyrm): moves UNDER enemy units (co-occupying their tile, to Erupt),
  // but can't move under buildings, resource tiles, or mountains. See docs/conditions.md.
  const isBurrowed = unitType.conditions?.includes('burrowed') ?? false;
  const buildingKeys = new Set(buildings.map(b => `${b.position.x},${b.position.y}`));

  // "Frazzled": while standing inside an enemy's area of influence, this unit's movement
  // is capped at 1. A unit's AOI is the 3×3 around it (Chebyshev radius 1) by default —
  // range doesn't widen it. See docs/conditions.md.
  if (unitType.conditions?.includes('frazzled')) {
    const inEnemyAOI = units.some(u => {
      if (u.owner === unit.owner) return false;
      const d = Math.max(Math.abs(u.position.x - unit.position.x), Math.abs(u.position.y - unit.position.y));
      return d <= 1;
    });
    if (inEnemyAOI) maxMove = Math.min(maxMove, 1);
  }

  const reachable = new Map<string, number>(); // "x,y" -> cost
  // By DEFAULT no unit may move onto mountains; only units with a mountain-access
  // passive can (mountain_movement / mountain_defense / mountain_shooter / mountain_sight).
  // See docs/conditions.md.
  const conds = unitType.conditions ?? [];
  const canClimbMountains = conds.includes('mountain_movement') || conds.includes('mountain_defense') || conds.includes('mountain_shooter') || conds.includes('mountain_shooter_2') || conds.includes('mountain_sight');
  const isFlying = unitType.traits.includes('flying');
  const isAquatic = unitType.traits.includes('aquatic');

  // BFS / Dijkstra-lite with priority queue (simple sorted array for small grids)
  const queue: PathNode[] = [{ x: unit.position.x, y: unit.position.y, cost: 0 }];
  const visited = new Map<string, number>();
  visited.set(`${unit.position.x},${unit.position.y}`, 0);

  // Occupied positions (by other units) — can't move through enemy units. A burrowed
  // ENEMY unit is invisible and does NOT block movers (they may unknowingly move onto/
  // under it). Friendly units — including burrowed — always block (no friendly co-tile).
  const occupiedByEnemy = new Set<string>();
  const occupiedByFriendly = new Set<string>();
  for (const u of units) {
    if (u.id === unit.id) continue;
    const key = `${u.position.x},${u.position.y}`;
    if (u.owner === unit.owner) {
      occupiedByFriendly.add(key);
    } else if (!registry.unitTypes[u.typeId]?.conditions?.includes('burrowed')) {
      occupiedByEnemy.add(key);
    }
  }

  // Blind (scuttling) and burrowed (Wyrm) units get "bump" targets: hidden impassable
  // tiles show as selectable, and moving onto one bumps (reveal + waste move). This
  // penalises blind movement into clouds. See docs/conditions.md.
  const blindBump = conds.includes('blind') || isBurrowed;

  while (queue.length > 0) {
    // Sort by cost (cheap priority queue)
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    const currentKey = `${current.x},${current.y}`;
    if (current.cost > (visited.get(currentKey) ?? Infinity)) continue;

    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) continue;

      const tile = map.tiles[ny][nx];
      const terrain = registry.terrainTypes[tile.terrain];
      if (!terrain) continue;

      const nKey = `${nx},${ny}`;
      const stepCost = current.cost + 1;
      if (stepCost > maxMove) continue;

      const isMountain = terrain.id === 'mountain';
      const terrainPass = isFlying ? true
        : isMountain ? canClimbMountains
        : terrain.id === 'water' ? isAquatic
        : terrain.passable;
      const enemyHere = occupiedByEnemy.has(nKey);
      const friendlyHere = occupiedByFriendly.has(nKey);

      // OCCUPIABLE — can the unit STOP here? Burrowed co-occupies enemies but not
      // buildings/resource/city tiles.
      let occ = terrainPass && !friendlyHere && !(enemyHere && !isBurrowed);
      if (isBurrowed && (tile.isResourceTile || tile.isCity || buildingKeys.has(nKey))) occ = false;

      // TERRAIN BUMP — an impassable-to-occupy tile (by terrain/building/resource/city,
      // NOT by a unit) becomes a selectable bump target for blind/burrowed units; moving
      // onto it lands on `current` and reveals it as fog.
      if (blindBump && bumps && !occ && !enemyHere && !friendlyHere && !bumps.has(nKey)) {
        bumps.set(nKey, currentKey);
      }

      // ENEMY BUMP — a blind (non-burrowed) unit may target a hidden enemy's tile to
      // reveal it, but never paths through it.
      if (enemyHere && !isBurrowed) {
        if (bumpEnemies && !reachable.has(nKey)) reachable.set(nKey, stepCost);
        continue;
      }

      // Record an occupiable stop (min cost).
      if (occ) {
        const prevR = reachable.get(nKey);
        if (prevR === undefined || prevR > stepCost) reachable.set(nKey, stepCost);
      }

      // Expand THROUGH traversable tiles. Burrowed passes under anything (impassables,
      // enemies); others only through terrain they could occupy (+ friendly pass-through).
      const trav = isBurrowed || terrainPass;
      if (trav) {
        const prevV = visited.get(nKey);
        if (prevV === undefined || prevV > stepCost) {
          visited.set(nKey, stepCost);
          queue.push({ x: nx, y: ny, cost: stepCost });
        }
      }
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
