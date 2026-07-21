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

/**
 * "City window" emissive texture for the background billboards: random lit/unlit
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
  const cool = ['#5fd7ff', '#8fb4ff', '#c07bff', '#ff5fae'];
  const cw = 6;
  const ch = 9;
  for (let y = 4; y < height - ch; y += ch + 5) {
    for (let x = 4; x < width - cw; x += cw + 6) {
      const r = rnd();
      if (r < 0.55) continue; // unlit
      const pool = r < 0.8 ? warm : cool;
      ctx.fillStyle = pool[Math.floor(rnd() * pool.length)];
      ctx.globalAlpha = 0.5 + rnd() * 0.5;
      ctx.fillRect(x, y, cw, ch * (rnd() < 0.12 ? 2 : 1));
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
