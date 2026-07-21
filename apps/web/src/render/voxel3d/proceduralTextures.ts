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
 * Arena floor albedo + roughness, generated once at startup (canvas sized by
 * quality tier, capped at 2048² high / 1024² low). The albedo is deliberately
 * mid-value — a near-black albedo multiplies the planar reflection to nothing.
 *
 * Albedo: per-tile ±8% value jitter, 2–3 octave value-noise grime (−20%,
 * biased toward edges/corners), subtle 1–2px panel seams + bevel, 6–10
 * desaturated colour splats, rust streaks near the perimeter.
 * Roughness: base 0.75 with ±0.05 tile jitter; 8–14 clustered near-mirror
 * puddles (0.05–0.15); grime areas pushed to 0.9 (grime kills reflection).
 * UVs map 1:1 onto the arena plane.
 */
export function makeFloorPlateTextures(
  widthTiles: number,
  heightTiles: number,
  seed = 99,
  theme: 'city' | 'desert' = 'city',
  quality: 'high' | 'low' = 'high',
): { albedo: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const maxTex = quality === 'high' ? 2048 : 1024;
  const PX = Math.max(24, Math.min(quality === 'high' ? 192 : 64,
    Math.floor(maxTex / Math.max(widthTiles, heightTiles))));
  const W = widthTiles * PX;
  const H = heightTiles * PX;
  const rnd = mulberry(seed);

  // ── Value-noise lattice for the grime field (2 octaves + bias) ──
  const latticeAt = (cells: number, off: number) => {
    const r = mulberry(seed ^ off);
    const grid = new Float32Array((cells + 1) * (cells + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    return (u: number, v: number) => {
      const x = u * cells, y = v * cells;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const idx = (yy: number, xx: number) => grid[yy * (cells + 1) + xx];
      const a = idx(y0, x0) + (idx(y0, x0 + 1) - idx(y0, x0)) * sx;
      const b = idx(y0 + 1, x0) + (idx(y0 + 1, x0 + 1) - idx(y0 + 1, x0)) * sx;
      return a + (b - a) * sy;
    };
  };
  const noiseA = latticeAt(5, 0x1111);
  const noiseB = latticeAt(11, 0x2222);
  const noiseC = latticeAt(23, 0x3333);
  /** Grime field 0..1, biased toward arena edges and corners. */
  const grimeAt = (u: number, v: number) => {
    const n = 0.5 * noiseA(u, v) + 0.32 * noiseB(u, v) + 0.18 * noiseC(u, v);
    const edge = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2; // 0 centre → 1 edge
    const biased = n * (0.55 + 0.45 * edge * edge);
    return Math.min(1, Math.max(0, (biased - 0.38) / 0.34)); // threshold + normalise
  };

  // ── Base palettes ──
  const base = theme === 'desert' ? [0x4a, 0x3c, 0x2b] : [0x20, 0x24, 0x2f];
  const SPLATS = theme === 'desert'
    ? ['#6b4a2f', '#7a3b52', '#2f5a5e']
    : ['#7a3b52', '#2f5a5e', '#6b4a2f'];

  // Per-tile value jitter (±8%) + small hue-ish channel wobble, deterministic
  // from tile coords.
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

  // ── Albedo: base + jitter + grime in one ImageData pass ──
  const alb = document.createElement('canvas');
  alb.width = W; alb.height = H;
  const a = alb.getContext('2d')!;
  const img = a.createImageData(W, H);
  const grimeMask = new Float32Array(W * H); // reused by the roughness pass
  for (let y = 0; y < H; y++) {
    const ty = Math.min(heightTiles - 1, Math.floor(y / PX));
    for (let x = 0; x < W; x++) {
      const tx = Math.min(widthTiles - 1, Math.floor(x / PX));
      const g = grimeAt(x / W, y / H);
      grimeMask[y * W + x] = g;
      // Fine per-pixel grain (±3% + sparse darker pores) so the surface holds
      // organic detail at close zoom without any repeating pattern.
      let h = (x * 1664525 + y * 1013904223) ^ (seed * 2654435761);
      h = ((h >>> 13) ^ h) * 0x5bd1e995;
      const n01 = ((h >>> 8) & 0xffff) / 0xffff;
      let grain = 0.97 + n01 * 0.06;
      if (n01 < 0.015) grain -= 0.1; // pore
      const mul = tileJitter[ty][tx] * (1 - 0.2 * g) * grain;
      const i = (y * W + x) * 4;
      img.data[i] = base[0] * mul;
      img.data[i + 1] = base[1] * mul;
      img.data[i + 2] = base[2] * mul;
      img.data[i + 3] = 255;
    }
  }
  a.putImageData(img, 0, 0);

  // Panel seams (1–2px, subtle — the shader grid overlay stays the crisp one)
  // plus a faint bevel light-catch on each tile's top/left.
  a.fillStyle = 'rgba(0,0,0,0.42)';
  for (let tx = 0; tx <= widthTiles; tx++) a.fillRect(tx * PX - 1, 0, 2, H);
  for (let ty = 0; ty <= heightTiles; ty++) a.fillRect(0, ty * PX - 1, W, 2);
  a.fillStyle = 'rgba(255,255,255,0.05)';
  for (let ty = 0; ty < heightTiles; ty++) {
    for (let tx = 0; tx < widthTiles; tx++) {
      a.fillRect(tx * PX + 1, ty * PX + 1, PX - 2, 2);
      a.fillRect(tx * PX + 1, ty * PX + 1, 2, PX - 2);
    }
  }

  // Sparse colour splat decals: 6–10 soft blobs, 0.3–1.5 tiles, 10–18% alpha.
  const splatCount = 6 + Math.floor(rnd() * 5);
  for (let i = 0; i < splatCount; i++) {
    const gx = rnd() * W, gy = rnd() * H;
    const gr = PX * (0.3 + rnd() * 1.2) / 2 * 2; // 0.3–1.5 tiles diameter
    const col = SPLATS[Math.floor(rnd() * SPLATS.length)];
    const alpha = 0.1 + rnd() * 0.08;
    const g = a.createRadialGradient(gx, gy, 1, gx, gy, gr);
    g.addColorStop(0, col + Math.round(alpha * 255).toString(16).padStart(2, '0'));
    g.addColorStop(1, col + '00');
    a.fillStyle = g;
    a.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
  }

  // Rust/stain streaks near the perimeter blocks.
  for (let i = 0; i < widthTiles + heightTiles; i++) {
    const along = rnd();
    const streakL = PX * (0.2 + rnd() * 0.5);
    const alpha = 0.08 + rnd() * 0.1;
    a.fillStyle = `rgba(122,74,47,${alpha})`;
    const edge = Math.floor(rnd() * 4);
    const t = along * (edge < 2 ? W : H);
    const d = rnd() * PX * 0.9;
    if (edge === 0) a.fillRect(t, d, 2 + rnd() * 3, streakL);
    else if (edge === 1) a.fillRect(t, H - d - streakL, 2 + rnd() * 3, streakL);
    else if (edge === 2) a.fillRect(d, t, streakL, 2 + rnd() * 3);
    else a.fillRect(W - d - streakL, t, streakL, 2 + rnd() * 3);
  }

  // ── Roughness ──
  const rgh = document.createElement('canvas');
  rgh.width = W; rgh.height = H;
  const r = rgh.getContext('2d')!;
  const rimg = r.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const ty = Math.min(heightTiles - 1, Math.floor(y / PX));
    for (let x = 0; x < W; x++) {
      const tx = Math.min(widthTiles - 1, Math.floor(x / PX));
      // Base 0.75 ± per-tile jitter; grime pushes toward 0.9.
      const g = grimeMask[y * W + x];
      const rough = (0.75 + tileRough[ty][tx]) * (1 - g) + 0.9 * g;
      const b = Math.round(rough * 255);
      const i = (y * W + x) * 4;
      rimg.data[i] = b; rimg.data[i + 1] = b; rimg.data[i + 2] = b;
      rimg.data[i + 3] = 255;
    }
  }
  r.putImageData(rimg, 0, 0);

  // Puddles: 8–14 irregular near-mirror blobs, clustered non-uniformly so
  // some tiles stay bone dry. Drawn AFTER grime so a puddle wins locally.
  const clusters = Array.from({ length: 3 }, () => [rnd() * W, rnd() * H]);
  const puddleCount = 8 + Math.floor(rnd() * 7);
  for (let i = 0; i < puddleCount; i++) {
    const c = clusters[Math.floor(rnd() * clusters.length)];
    const gx = c[0] + (rnd() - 0.5) * W * 0.35;
    const gy = c[1] + (rnd() - 0.5) * H * 0.35;
    const gr = PX * (0.35 + rnd() * 0.75);
    const rough = 0.05 + rnd() * 0.1;
    const v = Math.round(rough * 255);
    const g = r.createRadialGradient(gx, gy, gr * 0.15, gx, gy, gr);
    g.addColorStop(0, `rgba(${v},${v},${v},1)`);
    g.addColorStop(0.65, `rgba(${v},${v},${v},0.85)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    r.fillStyle = g;
    r.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
  }

  const albedo = new THREE.CanvasTexture(alb);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 4;
  const roughness = new THREE.CanvasTexture(rgh);
  return { albedo, roughness };
}

export type SignPalette = 'pink' | 'cyan' | 'orange' | 'purple';

const SIGN_COLORS: Record<SignPalette, string> = {
  pink: '#ff2d95',
  cyan: '#33f0ff',
  orange: '#ffb163',
  purple: '#c07bff',
};

/**
 * Vertical neon sign: bright frame + rows of blocky glyph-like strokes
 * (reads as CJK signage at game distance without shipping a font).
 */
export function makeNeonSignTexture(seed: number, palette: SignPalette): THREE.CanvasTexture {
  const W = 96, H = 256;
  const rnd = mulberry(seed);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const col = SIGN_COLORS[palette];
  ctx.fillStyle = '#0b0714';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = col;
  ctx.lineWidth = 5;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  // Glyph rows.
  const rows = 4 + Math.floor(rnd() * 2);
  const cell = (H - 40) / rows;
  for (let i = 0; i < rows; i++) {
    const cy = 24 + i * cell + cell / 2;
    const strokes = 3 + Math.floor(rnd() * 4);
    ctx.strokeStyle = col;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (let s = 0; s < strokes; s++) {
      const x1 = 22 + rnd() * (W - 44), y1 = cy - cell * 0.28 + rnd() * cell * 0.56;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      if (rnd() < 0.5) ctx.lineTo(x1 + 10 + rnd() * (W - 44 - x1 + 10), y1);
      else ctx.lineTo(x1, Math.min(cy + cell * 0.3, y1 + 8 + rnd() * cell * 0.4));
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * "City window" emissive texture for the background towers: random lit/unlit
 * window rects in warm and cool tones on near-black towers.
 */
export function makeCityWindowTexture(width = 256, height = 512, seed = 4242): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#07060d';
  ctx.fillRect(0, 0, width, height);
  const rnd = (() => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const warm = ['#ffb163', '#ffd9a0', '#ff8f4d'];
  const cool = ['#5fd7ff', '#8fb4ff', '#c07bff', '#ff5fae', '#b98cff'];
  // Per-tower window cell size — varied facades like the reference.
  const cw = 4 + Math.floor(rnd() * 5);
  const ch = 6 + Math.floor(rnd() * 6);
  const balconyEvery = 3 + Math.floor(rnd() * 3);
  let row = 0;
  for (let y = 4; y < height - ch; y += ch + 5, row++) {
    // Balcony band: darker horizontal ledge line under some rows.
    if (row % balconyEvery === balconyEvery - 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, y + ch + 1, width, 3);
    }
    for (let x = 4; x < width - cw; x += cw + 6) {
      const r = rnd();
      if (r < 0.5) continue; // unlit
      const pool = r < 0.65 ? warm : cool;
      ctx.fillStyle = pool[Math.floor(rnd() * pool.length)];
      ctx.globalAlpha = 0.5 + rnd() * 0.5;
      ctx.fillRect(x, y, cw, ch * (rnd() < 0.12 ? 2 : 1));
    }
  }
  ctx.globalAlpha = 1;
  // 1–2 bright ad billboards with a coloured border, like the reference facades.
  const ads = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < ads; i++) {
    const bw = 30 + rnd() * 40, bh = 18 + rnd() * 26;
    const bx = 8 + rnd() * (width - bw - 16), by = 20 + rnd() * (height - bh - 40);
    const col = cool[Math.floor(rnd() * cool.length)];
    ctx.fillStyle = '#0d0a18';
    ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.65;
    ctx.fillRect(bx + 4, by + 4, bw - 8, bh - 8);
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
