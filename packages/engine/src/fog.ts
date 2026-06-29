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

  // Each owned unit reveals a square. Most reveal 'visible'; "Squinting eyes" units
  // reveal (part of) their range only as fog ('explored' — terrain seen, units not).
  for (const unit of units) {
    if (unit.owner !== playerId) continue;
    const unitType = registry.unitTypes[unit.typeId];
    if (!unitType) continue;
    const conds = unitType.conditions ?? [];
    const ox = unit.position.x, oy = unit.position.y;
    if (conds.includes('squinting_eyes_2')) {
      // L2: inner 3×3 fully visible, the surrounding 5×5 ring only as fog.
      revealSquareLevel(map, visibility, ox, oy, 2, registry, 'explored', false);
      revealSquareLevel(map, visibility, ox, oy, 1, registry, 'visible', false);
    } else if (conds.includes('squinting_eyes_1')) {
      // L1: 3×3 seen only as fog (terrain, no units).
      revealSquareLevel(map, visibility, ox, oy, 1, registry, 'explored', false);
    } else {
      // Normal sight. "Low Horizons" makes mountains block this unit's line of sight.
      const mountainsBlock = conds.includes('low_horizons');
      let radius = Math.floor(unitType.visibility);
      // "Mountain sight": visibility becomes 2 while standing on a mountain.
      if (conds.includes('mountain_sight') && map.tiles[oy]?.[ox]?.terrain === 'mountain') radius = 2;
      revealSquareLevel(map, visibility, ox, oy, radius, registry, 'visible', mountainsBlock);
    }
  }

  return visibility;
}

// Visibility precedence so a tile lit 'visible' by one source isn't downgraded to
// fog by another (and fog isn't downgraded to hidden).
const VIS_RANK: Record<TileVisibility, number> = { hidden: 0, explored: 1, visible: 2 };

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
      if (vis[y][x] === 'hidden') continue; // record both visible and squint-fog tiles
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

const NEIGHBORS8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/**
 * "Reveal map" (L2→3 reward): discover up to `count` undiscovered (cloud) tiles in a
 * connected blob growing from the player's seen frontier TOWARD the nearest enemy city
 * (so the cluster's far edge points at the enemy — a rough "hill" toward them). Revealed
 * tiles enter fog memory (terrain + buildings + cities, but not live units), so they show
 * as fog afterward. Deterministic.
 */
export function revealTowardEnemy(
  state: GameState,
  playerId: PlayerId,
  fromPos: { x: number; y: number },
  count: number,
  registry: DataRegistry,
): void {
  const mem = state.memory?.[playerId];
  if (!mem || count <= 0) return;
  const { width, height } = state.map;
  const vis = computeVisibility(state.map, state.units, state.cities, playerId, registry);

  // Nearest enemy city centre to aim at.
  let target: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const c of state.cities) {
    if (c.owner === null || c.owner === playerId) continue;
    const d = Math.max(Math.abs(c.position.x - fromPos.x), Math.abs(c.position.y - fromPos.y));
    if (d < bestD) { bestD = d; target = { x: c.position.x, y: c.position.y }; }
  }
  if (!target) return; // no enemy city to reveal toward

  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const isCloud = (x: number, y: number) => inB(x, y) && vis[y][x] === 'hidden' && !mem.tiles[y][x];
  const key = (x: number, y: number) => `${x},${y}`;

  const queued = new Set<string>();
  const frontier: { x: number; y: number }[] = [];
  const add = (x: number, y: number) => {
    if (isCloud(x, y) && !queued.has(key(x, y))) { queued.add(key(x, y)); frontier.push({ x, y }); }
  };
  // Seed the frontier from cloud tiles bordering the player's seen (visible/remembered) area.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isCloud(x, y)) continue; // a seen tile
      for (const [dx, dy] of NEIGHBORS8) add(x + dx, y + dy);
    }
  }

  let revealed = 0;
  while (revealed < count && frontier.length > 0) {
    // Pick the frontier cloud tile nearest the enemy (deterministic tiebreak).
    let bi = 0, bs = Infinity;
    for (let i = 0; i < frontier.length; i++) {
      const f = frontier[i];
      const d = Math.max(Math.abs(f.x - target.x), Math.abs(f.y - target.y));
      const score = d * (width * height) + f.y * width + f.x;
      if (score < bs) { bs = score; bi = i; }
    }
    const f = frontier.splice(bi, 1)[0];
    queued.delete(key(f.x, f.y));
    if (!isCloud(f.x, f.y)) continue;

    mem.tiles[f.y][f.x] = cloneJSON(state.map.tiles[f.y][f.x]);
    const b = state.buildings.find(bb => bb.position.x === f.x && bb.position.y === f.y);
    if (b) { mem.buildings = mem.buildings.filter(bb => !(bb.position.x === f.x && bb.position.y === f.y)); mem.buildings.push(cloneJSON(b)); }
    const c = state.cities.find(cc => cc.position.x === f.x && cc.position.y === f.y);
    if (c) { mem.cities = mem.cities.filter(cc => !(cc.position.x === f.x && cc.position.y === f.y)); mem.cities.push(cloneJSON(c)); }
    revealed++;
    for (const [dx, dy] of NEIGHBORS8) add(f.x + dx, f.y + dy);
  }
}

/**
 * Reveal a Chebyshev-radius square around (ox,oy) to `level` ('visible' or fog
 * 'explored'), each tile gated by line of sight. Only ever raises a tile's level,
 * never lowers it (so visible beats fog beats hidden).
 */
function revealSquareLevel(
  map: GameMap,
  visibility: TileVisibility[][],
  ox: number,
  oy: number,
  range: number,
  registry: DataRegistry,
  level: TileVisibility,
  mountainsBlock = false,
): void {
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const tx = ox + dx;
      const ty = oy + dy;
      if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) continue;
      if (hasLineOfSight(map, ox, oy, tx, ty, registry, mountainsBlock)) {
        if (VIS_RANK[level] > VIS_RANK[visibility[ty][tx]]) visibility[ty][tx] = level;
      }
    }
  }
}

/**
 * Line of sight (bresenham). Vision is a clean square by default — nothing blocks it —
 * EXCEPT when `mountainsBlock` (the Low Horizons condition), where a mountain between the
 * unit and the target hides everything beyond it. The target tile itself is never the
 * blocker (you see the mountain, just not past it). `registry` is unused now but kept
 * for signature stability / future terrain-based rules.
 */
function hasLineOfSight(
  map: GameMap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  _registry: DataRegistry,
  mountainsBlock = false,
): boolean {
  if (x0 === x1 && y0 === y1) return true;
  if (!mountainsBlock) return true; // no blockers → full square

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
    if (map.tiles[cy][cx].terrain === 'mountain') return false; // Low Horizons: mountains block
  }
}
