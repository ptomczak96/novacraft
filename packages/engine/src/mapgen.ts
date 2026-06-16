import type { GameMap, Tile, Coord, DataRegistry } from './types.js';
import type { PRNGState } from './prng.js';
import { nextInt, nextRandom } from './prng.js';

export function generateMap(
  width: number,
  height: number,
  playerCount: number,
  registry: DataRegistry,
  prng: PRNGState,
): [GameMap, Coord[], PRNGState] {
  const tiles: Tile[][] = [];
  let currentPrng = prng;

  // Fill with terrain
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      let terrainId: string;
      const [roll, next] = nextRandom(currentPrng);
      currentPrng = next;

      if (roll < 0.55) terrainId = 'plains';
      else if (roll < 0.72) terrainId = 'forest';
      else if (roll < 0.82) terrainId = 'mountain';
      else if (roll < 0.90) terrainId = 'plains'; // was 'water' — disabled for cleaner maps
      else if (roll < 0.95) terrainId = 'plains'; // was 'river' — disabled for cleaner maps
      else terrainId = 'resource';

      tiles[y][x] = {
        terrain: terrainId,
        owner: null,
        isCity: false,
        isResourceTile: terrainId === 'resource',
      };
    }
  }

  // Place starting cities — ensure they're on passable terrain
  const cityPositions: Coord[] = [];

  if (playerCount === 2) {
    // Player 0 top-left corner, player 1 bottom-right corner (1 tile in for 3x3 perimeter)
    const p0: Coord = { x: 1, y: 1 };
    const p1: Coord = { x: width - 2, y: height - 2 };
    cityPositions.push(p0, p1);
  } else {
    // Distribute evenly around the map
    for (let i = 0; i < playerCount; i++) {
      const angle = (2 * Math.PI * i) / playerCount;
      const cx = Math.floor(width / 2 + (width * 0.3) * Math.cos(angle));
      const cy = Math.floor(height / 2 + (height * 0.3) * Math.sin(angle));
      cityPositions.push({ x: Math.max(1, Math.min(width - 2, cx)), y: Math.max(1, Math.min(height - 2, cy)) });
    }
  }

  // Place cities and clear surrounding area
  for (let i = 0; i < cityPositions.length; i++) {
    const pos = cityPositions[i];
    tiles[pos.y][pos.x] = {
      terrain: 'plains',
      owner: i,
      isCity: true,
      isResourceTile: false,
    };
    // Clear full 3x3 perimeter around base — all owned by the player
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          if (dx === 0 && dy === 0) continue; // already set as city above
          tiles[ny][nx] = {
            terrain: 'plains',
            owner: i,
            isCity: false,
            isResourceTile: false,
            isPerimeter: true,
          };
        }
      }
    }
  }

  return [{ width, height, tiles }, cityPositions, currentPrng];
}

export function loadMapFromJSON(data: { width: number; height: number; tiles: Tile[][] }): GameMap {
  return { width: data.width, height: data.height, tiles: data.tiles };
}
