import React, { useRef, useEffect, useMemo } from 'react';

// ── Parallax starfield backdrop ──
// A single full-viewport canvas painted behind the map: a black base plus three
// sparse white-pixel star layers. Each layer moves at a fraction of the map's pan
// (near layers move more than far ones → depth) AND drifts slowly on its own, so
// the sheets slide against one another. A subset of stars twinkle (slow alpha
// fade). The same field is used for every biome / map-generation type.
//
// The field is TILED from a fixed cell so any amount of pan/drift keeps showing
// stars without running out. Star positions are deterministic (seeded PRNG) so
// the sky is stable across resizes and re-mounts.

interface Star {
  x: number;      // position within the layer's tile cell (px)
  y: number;
  size: number;   // 1 or 2 px square
  alpha: number;  // base brightness [0..1]
  twAmp: number;  // twinkle amplitude (0 = static)
  twSpeed: number;// twinkle angular speed (rad/s)
  twPhase: number;
}

interface Layer {
  cell: number;       // tile size for wrap-repeat (px)
  stars: Star[];
  parallax: number;   // fraction of pan applied to this layer
  driftX: number;     // ambient drift velocity (px/s)
  driftY: number;
}

/** Small deterministic PRNG so the field is identical every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLayer(
  seed: number,
  count: number,
  cell: number,
  parallax: number,
  driftX: number,
  driftY: number,
  alphaMax: number,
  allowBig: boolean,
): Layer {
  const rnd = mulberry32(seed);
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    // ~30% of stars twinkle; the rest are steady points of light.
    const twinkles = rnd() < 0.3;
    stars.push({
      x: rnd() * cell,
      y: rnd() * cell,
      size: allowBig && rnd() < 0.18 ? 2 : 1,
      alpha: alphaMax * (0.5 + 0.5 * rnd()),
      twAmp: twinkles ? 0.5 + rnd() * 0.3 : 0,
      twSpeed: 0.4 + rnd() * 1.1,
      twPhase: rnd() * Math.PI * 2,
    });
  }
  return { cell, stars, parallax, driftX, driftY };
}

/** Draw one wrap-tiled star layer, offset by pan·parallax + drift·t. */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  w: number,
  h: number,
  panX: number,
  panY: number,
  t: number,
) {
  const cell = layer.cell;
  const offX = panX * layer.parallax + layer.driftX * t;
  const offY = panY * layer.parallax + layer.driftY * t;
  // Normalise the offset into [0, cell) then start one cell back so the repeat
  // covers the whole viewport with no gaps at the edges.
  const ox = ((offX % cell) + cell) % cell;
  const oy = ((offY % cell) + cell) % cell;
  const startX = ox - cell;
  const startY = oy - cell;

  for (let baseX = startX; baseX < w; baseX += cell) {
    for (let baseY = startY; baseY < h; baseY += cell) {
      for (const s of layer.stars) {
        const tw = s.twAmp > 0
          ? 1 - s.twAmp + s.twAmp * (0.5 + 0.5 * Math.sin(t * s.twSpeed + s.twPhase))
          : 1;
        ctx.globalAlpha = s.alpha * tw;
        ctx.fillRect(Math.round(baseX + s.x), Math.round(baseY + s.y), s.size, s.size);
      }
    }
  }
}

interface StarfieldProps {
  /** Current map pan offset (px). Layers trail it at their parallax fraction. */
  pan: { x: number; y: number };
}

export function Starfield({ pan }: StarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Read pan from a ref inside the animation loop so pan changes don't restart it.
  const panRef = useRef(pan);
  useEffect(() => { panRef.current = pan; }, [pan]);

  // Three layers, far → near: nearer layers have a larger parallax fraction,
  // brighter/denser-feeling stars, and faster, differently-angled drift.
  const layers = useMemo<Layer[]>(() => [
    makeLayer(0x9e3779b1, 20, 360, 0.15, 3, 1.2, 0.5, false),   // far
    makeLayer(0x85ebca77, 16, 320, 0.30, 6, -2.0, 0.7, false),  // mid
    makeLayer(0xc2b2ae3d, 12, 300, 0.45, 10, 3.0, 0.95, true),  // near
  ], []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const start = performance.now();
    let w = 1, h = 1, dpr = 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const loop = () => {
      const t = (performance.now() - start) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      for (const layer of layers) {
        drawLayer(ctx, layer, w, h, panRef.current.x, panRef.current.y, t);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [layers]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        background: '#000',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
