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
  aoiTiles?: Set<string>, // enemy Area-of-Influence tiles ("x,y") — entering one STOPS movement
  hiddenEnemyTiles?: Set<string>, // cloaked enemy tiles hidden from the mover → BUMP targets (any unit)
  knownTiles?: Set<string>, // tiles the player has already seen — a blind unit won't walk into a KNOWN lethal tile
): Map<string, number> {
  let maxMove = unitType.movement + movementBonus;
  const ignoresTerrain = unitType.traits.includes('ignoresTerrainCost');
  // "Burrowed" (Wyrm): moves UNDER enemy units (co-occupying their tile, to Erupt),
  // but can't move under buildings, resource tiles, or mountains. See docs/conditions.md.
  const isBurrowed = unitType.conditions?.includes('burrowed') ?? false;
  const buildingKeys = new Set(buildings.map(b => `${b.position.x},${b.position.y}`));

  // "Stumble": while standing inside an enemy's area of influence, this unit's movement
  // is capped at 1. A unit's AOI is the 3×3 around it (Chebyshev radius 1) by default —
  // range doesn't widen it. See docs/conditions.md.
  if (unitType.conditions?.includes('stumble')) {
    const inEnemyAOI = units.some(u => {
      if (u.owner === unit.owner) return false;
      const d = Math.max(Math.abs(u.position.x - unit.position.x), Math.abs(u.position.y - unit.position.y));
      return d <= 1;
    });
    if (inEnemyAOI) maxMove = Math.min(maxMove, 1);
  }

  // "Slowed" (Medic's Slow): a flat movement cap of 1 while the status is active.
  if (unit.statuses?.includes('slowed')) maxMove = Math.min(maxMove, 1);

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

  // Blind (scuttling) units and burrowed (Wyrm) units treat impassable tiles specially.
  // Blind: a HIDDEN non-lethal impassable (mountain) is a BUMP (reveal + no move); a HIDDEN
  // lethal void tile (water/lava/acid/chasm) is a walk-in-and-DIE move; a KNOWN impassable
  // is simply blocked. Burrowed: any impassable is a bump target (it can't surface there).
  // See docs/conditions.md ("Bump", "blind", "burrowed").
  const isBlindUnit = conds.includes('blind');

  while (queue.length > 0) {
    // Sort by cost (cheap priority queue)
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    const currentKey = `${current.x},${current.y}`;
    if (current.cost > (visited.get(currentKey) ?? Infinity)) continue;

    // Zone of Control: entering an enemy Area-of-Influence tile immediately stops the
    // unit — the tile stays a legal STOP (already recorded in `reachable`) but the search
    // never expands FROM it. The unit's own starting tile is exempt (it may move out of an
    // AOI freely). See docs/conditions.md "Area of Influence".
    const isStart = current.x === unit.position.x && current.y === unit.position.y;
    if (aoiTiles && !isStart && aoiTiles.has(currentKey)) continue;

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
      // A burrowed Wyrm can't surface-stop on a city, ruin, resource tile, or building.
      if (isBurrowed && (tile.isResourceTile || tile.isCity || tile.isRuin || buildingKeys.has(nKey))) occ = false;

      // TERRAIN — an un-standable tile (impassable terrain, not blocked by a unit). The
      // land tile `current` must itself be a valid STOP (start, or an occupiable reachable
      // tile) — never a pass-under tile (a burrowed Wyrm traverses impassables but can't
      // land on them).
      const currentOccupiable = current.cost === 0 || reachable.has(currentKey);
      if (!occ && !enemyHere && !friendlyHere) {
        const isVoid = !terrain.passable; // water/lava/acid/chasm — lethal to walk into
        if (isBurrowed) {
          // Burrowed: any impassable destination is a bump target (it can't surface there).
          if (bumps && currentOccupiable && !bumps.has(nKey)) bumps.set(nKey, currentKey);
        } else if (isBlindUnit) {
          if (isVoid) {
            // Blind + lethal void: a HIDDEN one is a real (fatal) destination it can walk
            // onto; a KNOWN one is blocked (the player sees the danger and won't step in).
            if (!(knownTiles?.has(nKey) ?? false)) {
              const prevR = reachable.get(nKey);
              if (prevR === undefined || prevR > stepCost) reachable.set(nKey, stepCost);
            }
          } else if (bumps && currentOccupiable && !bumps.has(nKey)) {
            // Blind + non-lethal impassable (mountain): BUMP (reveal + no move).
            bumps.set(nKey, currentKey);
          }
        }
      }

      // ENEMY BUMP — moving onto a tile with an enemy it can't see reveals it (any unit can
      // bump a CLOAKED enemy via `hiddenEnemyTiles`; a blind unit bumps any hidden enemy via
      // `bumpEnemies`). Never paths THROUGH the enemy tile.
      if (enemyHere && !isBurrowed) {
        const bumpable = bumpEnemies || (hiddenEnemyTiles?.has(nKey) ?? false);
        if (bumpable && !reachable.has(nKey)) reachable.set(nKey, stepCost);
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
