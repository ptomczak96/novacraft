import * as THREE from 'three';

/**
 * Startup-generated procedural textures. All replaceable later by hand-authored
 * maps via VoxelArenaProps.floorTextures — the material setup only ever sees a
 * THREE.Texture, never cares where it came from.
 */

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Arena floor albedo + roughness — clean SC1-style platform plates: per-tile
 * value jitter, subtle grain and panel seams, a few dim roughness pools for
 * the reflection to bite into. `holes[y][x]` tiles are written fully
 * transparent (alpha 0) so the platform shows space through them (paired with
 * alphaTest on the material). A per-tile hole mask texture is returned for
 * the grid shader. UVs map 1:1 onto the arena plane.
 */
export function makeFloorPlateTextures(
  widthTiles: number,
  heightTiles: number,
  seed = 99,
  theme: 'city' | 'desert' = 'city',
  quality: 'high' | 'low' = 'high',
  holes?: boolean[][],
): { albedo: THREE.CanvasTexture; roughness: THREE.CanvasTexture; holeMask: THREE.DataTexture } {
  const maxTex = quality === 'high' ? 2048 : 1024;
  const PX = Math.max(24, Math.min(quality === 'high' ? 192 : 64,
    Math.floor(maxTex / Math.max(widthTiles, heightTiles))));
  const W = widthTiles * PX;
  const H = heightTiles * PX;

  const base = theme === 'desert' ? [0x4a, 0x3c, 0x2b] : [0x20, 0x24, 0x2f];

  // Per-tile value jitter (±8%) + roughness jitter, deterministic per tile.
  const tileJitter: number[][] = [];
  const tileRough: number[][] = [];
  for (let ty = 0; ty < heightTiles; ty++) {
    tileJitter[ty] = [];
    tileRough[ty] = [];
    for (let tx = 0; tx < widthTiles; tx++) {
      const r = mulberry(seed ^ (tx * 73856093) ^ (ty * 19349663));
      tileJitter[ty][tx] = 0.92 + r() * 0.16;
      tileRough[ty][tx] = -0.05 + r() * 0.1;
    }
  }

  const alb = document.createElement('canvas');
  alb.width = W; alb.height = H;
  const a = alb.getContext('2d')!;
  const img = a.createImageData(W, H);
  const rgh = document.createElement('canvas');
  rgh.width = W; rgh.height = H;
  const r = rgh.getContext('2d')!;
  const rimg = r.createImageData(W, H);

  for (let y = 0; y < H; y++) {
    const ty = Math.min(heightTiles - 1, Math.floor(y / PX));
    for (let x = 0; x < W; x++) {
      const tx = Math.min(widthTiles - 1, Math.floor(x / PX));
      const i = (y * W + x) * 4;
      if (holes?.[ty]?.[tx]) {
        img.data[i + 3] = 0; // hole: fully transparent
        continue;
      }
      // Fine per-pixel grain (±3% + sparse pores) so close zoom holds detail.
      let h = (x * 1664525 + y * 1013904223) ^ (seed * 2654435761);
      h = ((h >>> 13) ^ h) * 0x5bd1e995;
      const n01 = ((h >>> 8) & 0xffff) / 0xffff;
      let grain = 0.97 + n01 * 0.06;
      if (n01 < 0.015) grain -= 0.1;
      // Panel seam: darker 2px gutter on tile boundaries.
      const lx = x - tx * PX, ly = y - ty * PX;
      const seam = lx < 2 || ly < 2 || lx >= PX - 2 || ly >= PX - 2 ? 0.55 : 1;
      const mul = tileJitter[ty][tx] * grain * seam;
      img.data[i] = base[0] * mul;
      img.data[i + 1] = base[1] * mul;
      img.data[i + 2] = base[2] * mul;
      img.data[i + 3] = 255;

      const rough = (0.72 + tileRough[ty][tx]) * (seam < 1 ? 1.15 : 1);
      const b = Math.min(255, Math.round(rough * 255));
      rimg.data[i] = b; rimg.data[i + 1] = b; rimg.data[i + 2] = b;
      rimg.data[i + 3] = 255;
    }
  }
  a.putImageData(img, 0, 0);
  r.putImageData(rimg, 0, 0);

  // A few dim near-mirror pools so the floor reflection still reads.
  const rnd = mulberry(seed ^ 0xabcd);
  for (let i = 0; i < 6; i++) {
    const gx = rnd() * W, gy = rnd() * H, gr = PX * (0.35 + rnd() * 0.6);
    const tx = Math.floor(gx / PX), ty = Math.floor(gy / PX);
    if (holes?.[ty]?.[tx]) continue;
    const g = r.createRadialGradient(gx, gy, gr * 0.15, gx, gy, gr);
    g.addColorStop(0, 'rgba(28,28,28,0.9)');
    g.addColorStop(1, 'rgba(28,28,28,0)');
    r.fillStyle = g;
    r.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
  }

  const albedo = new THREE.CanvasTexture(alb);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 4;
  const roughness = new THREE.CanvasTexture(rgh);

  // 1px-per-tile hole mask for the grid shader (nearest sampling).
  const maskData = new Uint8Array(widthTiles * heightTiles * 4);
  for (let ty = 0; ty < heightTiles; ty++) {
    for (let tx = 0; tx < widthTiles; tx++) {
      const v = holes?.[ty]?.[tx] ? 0 : 255;
      const i = (ty * widthTiles + tx) * 4;
      maskData[i] = v; maskData[i + 1] = v; maskData[i + 2] = v; maskData[i + 3] = 255;
    }
  }
  const holeMask = new THREE.DataTexture(maskData, widthTiles, heightTiles);
  holeMask.magFilter = THREE.NearestFilter;
  holeMask.minFilter = THREE.NearestFilter;
  holeMask.needsUpdate = true;

  return { albedo, roughness, holeMask };
}
