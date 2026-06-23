import type { GameMap, Tile, Coord, DataRegistry, MapGenOptions } from './types.js';
import type { PRNGState } from './prng.js';
import { nextRandom } from './prng.js';

// ════════════════════════════════════════════════════════════════════════
//  Biome-coherent map generation
//
//  Terrain is derived from two smooth noise fields — ELEVATION and
//  TEMPERATURE (plus a MOISTURE field for forests). Because the fields vary
//  gradually, biomes naturally cluster and opposite extremes can never touch:
//  snow only forms where temperature is low, lava only where it is high, so a
//  smooth temperature gradient always leaves temperate land between them.
//
//  The board is flat (Polytopia-style): a "mountain" is just a passable tile
//  with a defence bonus, never a raised platform. Height in the art is cosmetic.
// ════════════════════════════════════════════════════════════════════════

// ── Resolved options (after defaults) ──
import type { Biome, ResourceKind } from './types.js';

interface ResolvedOptions {
  biome: Biome;
  resourceDensity: number;
  ruinCount: number;
}

function resolveOptions(opts?: MapGenOptions): ResolvedOptions {
  return {
    biome:           opts?.biome           ?? 'grassland',
    resourceDensity: opts?.resourceDensity ?? 0.08,
    ruinCount:       opts?.ruinCount       ?? 3,
  };
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * Smooth value-noise field in roughly [0,1], normalized to fill the range.
 * `cell` is the coarse-grid spacing in tiles — larger = smoother, blobbier.
 */
function makeField(
  width: number,
  height: number,
  cell: number,
  prng: PRNGState,
): [number[][], PRNGState] {
  const gw = Math.ceil(width / cell) + 2;
  const gh = Math.ceil(height / cell) + 2;

  // Random value at each coarse grid corner.
  const grid: number[][] = [];
  let p = prng;
  for (let j = 0; j < gh; j++) {
    grid[j] = [];
    for (let i = 0; i < gw; i++) {
      const [v, np] = nextRandom(p);
      p = np;
      grid[j][i] = v;
    }
  }

  // Bilinear interpolation with smoothstep easing.
  const field: number[][] = [];
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < height; y++) {
    field[y] = [];
    const gy = y / cell;
    const j0 = Math.floor(gy);
    const fy = smoothstep(gy - j0);
    for (let x = 0; x < width; x++) {
      const gx = x / cell;
      const i0 = Math.floor(gx);
      const fx = smoothstep(gx - i0);
      const v00 = grid[j0][i0];
      const v10 = grid[j0][i0 + 1];
      const v01 = grid[j0 + 1][i0];
      const v11 = grid[j0 + 1][i0 + 1];
      const top = v00 + (v10 - v00) * fx;
      const bot = v01 + (v11 - v01) * fx;
      const v = top + (bot - top) * fy;
      field[y][x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  // Normalize to [0,1] so thresholds behave predictably.
  const range = max - min || 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      field[y][x] = (field[y][x] - min) / range;
    }
  }

  return [field, p];
}

// Water/lava generation is disabled for now. Flip to true to bring back the
// full elevation/temperature biome classifier below (waterLavaTerrain).
const ENABLE_WATER_LAVA = false;

/** Active classifier: two simple biomes, no water/lava. */
function biomeTerrain(biome: Biome, e: number, m: number): string {
  if (biome === 'stone') {
    // Mostly stone (mountain); rare grassy clearings where moisture is high.
    return m > 0.82 ? 'plains' : 'mountain';
  }
  // Grassland: grass with forest patches, plus the odd rocky outcrop on peaks.
  if (e > 0.88) return 'mountain';
  return m > 0.62 ? 'forest' : 'plains';
}

/**
 * Disabled-but-kept classifier using smooth elevation + temperature fields.
 * Produces water (low) and lava (hot peaks); a smooth temperature field keeps
 * snow and lava from ever being adjacent. Re-enable via ENABLE_WATER_LAVA.
 */
function waterLavaTerrain(e: number, t: number, seaLevel: number, mountainLevel: number): string {
  if (e < seaLevel) return 'water';
  if (e > mountainLevel) return t > 0.72 ? 'lava' : 'mountain';
  if (t < 0.30) return 'snow';
  if (t > 0.70) return 'sand';
  return 'plains';
}

export function generateMap(
  width: number,
  height: number,
  playerCount: number,
  _registry: DataRegistry,
  prng: PRNGState,
  options?: MapGenOptions,
): [GameMap, Coord[], PRNGState] {
  const o = resolveOptions(options);
  let p = prng;

  // ── Noise fields ──
  // Smooth value-noise fields drive terrain so biomes cluster naturally.
  let elevation: number[][];
  let temperature: number[][];
  let moisture: number[][];
  [elevation, p] = makeField(width, height, 4, p);
  [temperature, p] = makeField(width, height, 6, p);
  [moisture, p] = makeField(width, height, 3, p);

  // ── Base terrain ──
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      const terrain = ENABLE_WATER_LAVA
        ? waterLavaTerrain(elevation[y][x], temperature[y][x], 0.34, 0.76)
        : biomeTerrain(o.biome, elevation[y][x], moisture[y][x]);
      tiles[y][x] = {
        terrain,
        owner: null,
        isCity: false,
        isResourceTile: false,
      };
    }
  }

  // Resources are placed per-base (inside each starting perimeter) further down,
  // not scattered across the map.

  // ── Ruins (foundable new-city sites) ──
  // Scatter on plain-ish land, away from edges; without these the economy's
  // found-city action has nowhere to go.
  let ruinsPlaced = 0;
  let attempts = 0;
  while (ruinsPlaced < o.ruinCount && attempts < o.ruinCount * 40) {
    attempts++;
    const [rx, p1] = nextRandom(p); p = p1;
    const [ry, p2] = nextRandom(p); p = p2;
    const x = 1 + Math.floor(rx * (width - 2));
    const y = 1 + Math.floor(ry * (height - 2));
    const tile = tiles[y][x];
    if (tile.isResourceTile || tile.isRuin) continue;
    if (tile.terrain !== 'plains' && tile.terrain !== 'mountain') continue;
    tile.isRuin = true;
    ruinsPlaced++;
  }

  // ── Starting cities ──
  const cityPositions: Coord[] = [];
  if (playerCount === 2) {
    cityPositions.push({ x: 1, y: 1 }, { x: width - 2, y: height - 2 });
  } else {
    for (let i = 0; i < playerCount; i++) {
      const angle = (2 * Math.PI * i) / playerCount;
      const cx = Math.floor(width / 2 + width * 0.3 * Math.cos(angle));
      const cy = Math.floor(height / 2 + height * 0.3 * Math.sin(angle));
      cityPositions.push({
        x: Math.max(1, Math.min(width - 2, cx)),
        y: Math.max(1, Math.min(height - 2, cy)),
      });
    }
  }

  // Carve each base: a clean 3×3 of owned plains, with the surrounding ring
  // flagged as perimeter and the centre as the capital. Then drop 2 ore + 1
  // plasma onto random perimeter tiles (never the city tile).
  for (let i = 0; i < cityPositions.length; i++) {
    const pos = cityPositions[i];
    const perimeter: Coord[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const isCenter = dx === 0 && dy === 0;
        tiles[ny][nx] = {
          terrain: 'plains',
          owner: i,
          isCity: isCenter,
          isResourceTile: false,
          ...(isCenter ? {} : { isPerimeter: true }),
        };
        if (!isCenter) perimeter.push({ x: nx, y: ny });
      }
    }

    // Shuffle the perimeter (Fisher–Yates via the map PRNG) and take the first 3.
    for (let k = perimeter.length - 1; k > 0; k--) {
      const [r, np] = nextRandom(p);
      p = np;
      const j = Math.floor(r * (k + 1));
      [perimeter[k], perimeter[j]] = [perimeter[j], perimeter[k]];
    }
    const kinds: ResourceKind[] = ['ore', 'ore', 'plasma'];
    for (let k = 0; k < kinds.length && k < perimeter.length; k++) {
      const t = tiles[perimeter[k].y][perimeter[k].x];
      t.isResourceTile = true;
      t.resourceKind = kinds[k];
    }
  }

  return [{ width, height, tiles }, cityPositions, p];
}

export function loadMapFromJSON(data: { width: number; height: number; tiles: Tile[][] }): GameMap {
  return { width: data.width, height: data.height, tiles: data.tiles };
}
