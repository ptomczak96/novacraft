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
  registry: DataRegistry,
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

  // (Ruins are placed after the cities below, so they can be spaced relative
  // to the capitals' territories.)

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

  // ── Ruins (foundable new-city sites) + their resources ──
  // Spacing: every city/ruin owns a 3x3 territory and territories NEVER overlap,
  // so the minimum centre-to-centre distance is 3 (territories just touching).
  // New ruins target a centre distance of 3/4/5 from the nearest existing centre,
  // weighted 25/50/25, and fill the map at that spacing. Each ruin's territory
  // then gets ore (0-4 tiles, weights 10/20/50/25/5) and plasma vents (0/1/2,
  // weights 35/50/15). Fully deterministic via the map PRNG.
  {
    const cheb = (a: Coord, b: Coord) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    const centres: Coord[] = cityPositions.map(c => ({ ...c }));
    const minDistTo = (pos: Coord) => centres.reduce((m, c) => Math.min(m, cheb(pos, c)), Infinity);
    const passable = (x: number, y: number): boolean => {
      const terr = registry.terrainTypes[tiles[y][x].terrain];
      return !!terr && terr.passable && !tiles[y][x].isCity;
    };
    const weighted = (values: number[], weights: number[]): number => {
      const total = weights.reduce((a, b) => a + b, 0);
      const [r, np] = nextRandom(p); p = np;
      let t = r * total;
      for (let i = 0; i < values.length; i++) { t -= weights[i]; if (t < 0) return values[i]; }
      return values[values.length - 1];
    };
    const pickFrom = <T>(arr: T[]): T => {
      const [r, np] = nextRandom(p); p = np;
      return arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
    };

    const ruins: Coord[] = [];
    let safety = width * height * 4;
    while (safety-- > 0) {
      const valid: Coord[] = [];
      for (let y = 1; y <= height - 2; y++) {
        for (let x = 1; x <= width - 2; x++) {
          const t = tiles[y][x];
          if (t.isResourceTile || t.isRuin || !passable(x, y)) continue;
          if (minDistTo({ x, y }) < 3) continue; // would overlap a territory
          valid.push({ x, y });
        }
      }
      if (valid.length === 0) break; // map full at this spacing
      const target = weighted([3, 4, 5], [25, 50, 25]);
      const atTarget = valid.filter(c => minDistTo(c) === target);
      const chosen = pickFrom(atTarget.length > 0 ? atTarget : valid);
      tiles[chosen.y][chosen.x].isRuin = true;
      centres.push(chosen);
      ruins.push(chosen);
    }

    // Resources in each ruin's 3x3 territory (its surrounding 8 tiles).
    for (const ruin of ruins) {
      const surround: Coord[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = ruin.x + dx, ny = ruin.y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const t = tiles[ny][nx];
          if (t.isResourceTile || t.isRuin || t.isCity || !passable(nx, ny)) continue;
          surround.push({ x: nx, y: ny });
        }
      }
      for (let k = surround.length - 1; k > 0; k--) {
        const [r, np] = nextRandom(p); p = np;
        const j = Math.floor(r * (k + 1));
        [surround[k], surround[j]] = [surround[j], surround[k]];
      }
      const oreCount = Math.min(weighted([0, 1, 2, 3, 4], [10, 20, 50, 25, 5]), surround.length);
      const plasmaCount = Math.min(weighted([0, 1, 2], [35, 50, 15]), surround.length - oreCount);
      let idx = 0;
      for (let k = 0; k < oreCount; k++, idx++) {
        const t = tiles[surround[idx].y][surround[idx].x];
        t.isResourceTile = true; t.resourceKind = 'ore';
      }
      for (let k = 0; k < plasmaCount; k++, idx++) {
        const t = tiles[surround[idx].y][surround[idx].x];
        t.isResourceTile = true; t.resourceKind = 'plasma';
      }
    }

    // Scattered resources OUTSIDE all city/ruin territories — a light sprinkling
    // (~66% of a city's 3x3 density, i.e. 3 resources / 8 tiles) so there's
    // something to grab when city borders expand later. ~2:1 ore:plasma like cities.
    const sprinkleP = 0.66 * (3 / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = tiles[y][x];
        if (t.isResourceTile || t.isRuin || t.isCity || !passable(x, y)) continue;
        if (minDistTo({ x, y }) <= 1) continue; // inside a territory → skip
        const [rr, pa] = nextRandom(p); p = pa;
        if (rr >= sprinkleP) continue;
        const [rk, pb] = nextRandom(p); p = pb;
        t.isResourceTile = true;
        t.resourceKind = rk < 1 / 3 ? 'plasma' : 'ore';
      }
    }
  }

  return [{ width, height, tiles }, cityPositions, p];
}

export function loadMapFromJSON(data: { width: number; height: number; tiles: Tile[][] }): GameMap {
  return { width: data.width, height: data.height, tiles: data.tiles };
}
