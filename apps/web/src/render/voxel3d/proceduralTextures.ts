import * as THREE from 'three';

/**
 * Startup-generated procedural textures. All replaceable later by hand-authored
 * maps via VoxelArenaProps.floorTextures — the material setup only ever sees a
 * THREE.Texture, never cares where it came from.
 */

/** Deterministic pseudo-random lattice (mulberry32) so reloads look identical. */
function makeLattice(cells: number, seed: number): Float32Array {
  const a = new Float32Array(cells * cells);
  let s = seed >>> 0;
  for (let i = 0; i < a.length; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    a[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return a;
}

/** Tileable bilinear value noise sampled from a lattice. u,v in [0,1). */
function sampleNoise(lattice: Float32Array, cells: number, u: number, v: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x) % cells;
  const y0 = Math.floor(y) % cells;
  const x1 = (x0 + 1) % cells;
  const y1 = (y0 + 1) % cells;
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = lattice[y0 * cells + x0];
  const n10 = lattice[y0 * cells + x1];
  const n01 = lattice[y1 * cells + x0];
  const n11 = lattice[y1 * cells + x1];
  const a = n00 + (n10 - n00) * sx;
  const b = n01 + (n11 - n01) * sx;
  return a + (b - a) * sy;
}

/**
 * Grime/roughness map for the arena floor: mostly worn concrete (rough), with
 * value-noise blobs — ~10% of the area near-zero roughness "puddles" that read
 * as sharp mirror pools, plus patches of extra-high roughness.
 * three.js reads roughness from the GREEN channel; we write greyscale anyway.
 */
export function makeFloorRoughnessTexture(size = 512, seed = 1337): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const coarse = makeLattice(8, seed);
  const fine = makeLattice(32, seed ^ 0x9e3779b9);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = 0.65 * sampleNoise(coarse, 8, u, v) + 0.35 * sampleNoise(fine, 32, u, v);
      let rough: number;
      if (n < 0.34) {
        // Puddle: near-zero roughness with a soft rim (≈10% of area).
        const rim = Math.min(1, Math.max(0, (0.34 - n) / 0.05));
        rough = 0.03 + (1 - rim) * 0.5;
      } else {
        // Worn surface: mid-to-high roughness patches.
        rough = 0.55 + 0.45 * Math.min(1, (n - 0.34) / 0.5);
      }
      const b = Math.round(rough * 255);
      const i = (y * size + x) * 4;
      img.data[i] = b;
      img.data[i + 1] = b;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

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
 * Arena floor as worn metal plates, one plate per tile: dark seams between
 * plates, bevel highlights, per-plate tint variation, scratches and stains.
 * Baked into the reflector's albedo + roughness maps so the "chunky tile slab"
 * look coexists with planar reflections (seams rough, plate centres smoother,
 * ~10% puddle blobs near-mirror). UVs map 1:1 onto the arena plane.
 */
export function makeFloorPlateTextures(
  widthTiles: number,
  heightTiles: number,
  seed = 99,
): { albedo: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const PX = 64;
  const W = widthTiles * PX;
  const H = heightTiles * PX;
  const rnd = mulberry(seed);

  const alb = document.createElement('canvas');
  alb.width = W; alb.height = H;
  const a = alb.getContext('2d')!;
  const rgh = document.createElement('canvas');
  rgh.width = W; rgh.height = H;
  const r = rgh.getContext('2d')!;

  // Seam base fills the whole sheet; plates are drawn inset on top.
  a.fillStyle = '#0a0c13';
  a.fillRect(0, 0, W, H);
  r.fillStyle = 'rgb(235,235,235)'; // seams: high roughness
  r.fillRect(0, 0, W, H);

  // Deep blue-violet plates (reference grade), not neutral grey.
  const PLATES = ['#262c50', '#2b3158', '#232849', '#313763', '#202440', '#2e2b58'];
  const SEAM = 2;
  for (let ty = 0; ty < heightTiles; ty++) {
    for (let tx = 0; tx < widthTiles; tx++) {
      const x0 = tx * PX + SEAM, y0 = ty * PX + SEAM, sz = PX - SEAM * 2;
      a.fillStyle = PLATES[Math.floor(rnd() * PLATES.length)];
      a.fillRect(x0, y0, sz, sz);
      // Bevel: light catch on top/left, shade on bottom/right.
      a.fillStyle = 'rgba(255,255,255,0.07)';
      a.fillRect(x0, y0, sz, 2);
      a.fillRect(x0, y0, 2, sz);
      a.fillStyle = 'rgba(0,0,0,0.35)';
      a.fillRect(x0, y0 + sz - 2, sz, 2);
      a.fillRect(x0 + sz - 2, y0, 2, sz);
      // Wear: speckles.
      for (let i = 0; i < 26; i++) {
        a.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.05)';
        a.fillRect(x0 + rnd() * sz, y0 + rnd() * sz, 1 + rnd() * 2, 1 + rnd() * 2);
      }
      // Occasional stain / scorch blob (kept subtle — heavy ones read as holes).
      if (rnd() < 0.15) {
        const gx = x0 + rnd() * sz, gy = y0 + rnd() * sz, gr = 6 + rnd() * 12;
        const g = a.createRadialGradient(gx, gy, 1, gx, gy, gr);
        g.addColorStop(0, 'rgba(5,6,10,0.28)');
        g.addColorStop(1, 'rgba(5,6,10,0)');
        a.fillStyle = g;
        a.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
      }
      // Colourful staining like the reference: teal/magenta/rust splatter.
      if (rnd() < 0.22) {
        const gx = x0 + rnd() * sz, gy = y0 + rnd() * sz, gr = 6 + rnd() * 16;
        const pick = rnd();
        const tint = pick < 0.4 ? '51,240,255' : pick < 0.7 ? '255,45,149' : '196,110,60';
        const g = a.createRadialGradient(gx, gy, 1, gx, gy, gr);
        g.addColorStop(0, `rgba(${tint},0.22)`);
        g.addColorStop(1, `rgba(${tint},0)`);
        a.fillStyle = g;
        a.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
        // a few splatter droplets around the blob
        for (let k = 0; k < 5; k++) {
          a.fillStyle = `rgba(${tint},${0.12 + rnd() * 0.12})`;
          a.fillRect(gx + (rnd() - 0.5) * gr * 2.4, gy + (rnd() - 0.5) * gr * 2.4, 1 + rnd() * 3, 1 + rnd() * 3);
        }
      }
      // Roughness: plate body mid-rough with jitter.
      const base = 150 + Math.floor(rnd() * 50);
      r.fillStyle = `rgb(${base},${base},${base})`;
      r.fillRect(x0, y0, sz, sz);
    }
  }
  // Puddles: soft near-zero-roughness blobs over ~10% of the floor.
  const blobCount = Math.round(widthTiles * heightTiles * 0.28);
  for (let i = 0; i < blobCount; i++) {
    const gx = rnd() * W, gy = rnd() * H, gr = PX * (0.3 + rnd() * 0.6);
    const g = r.createRadialGradient(gx, gy, 1, gx, gy, gr);
    g.addColorStop(0, 'rgba(12,12,12,0.95)');
    g.addColorStop(0.7, 'rgba(12,12,12,0.75)');
    g.addColorStop(1, 'rgba(12,12,12,0)');
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
