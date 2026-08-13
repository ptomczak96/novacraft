import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import type { TileVisibility } from '@tactica/engine';
import type { MapData } from '../types.js';

/**
 * GEN 8 — 3D Tileset atmosphere pass, all render-side:
 *  - DustMotes: warm sunlit dust drifting over the board (additive points).
 *  - WaterShimmer: animated caustic ripples projected over water tiles.
 * Both are cheap (one draw call each) and deterministic per map seed-ish
 * (positions hash from the map dimensions, drift is pure time functions).
 */

const MOTE_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  varying float vFade;
  void main() {
    // Slow orbital drift + a lazy vertical sine, phase-shifted per mote.
    vec3 p = position;
    p.x += sin(uTime * 0.11 + aSeed * 17.0) * 0.6;
    p.z += cos(uTime * 0.09 + aSeed * 23.0) * 0.6;
    p.y += sin(uTime * 0.23 + aSeed * 31.0) * 0.25;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Twinkle keeps motes alive even when the camera is still.
    vFade = 0.5 + 0.5 * sin(uTime * (0.6 + aSeed) + aSeed * 41.0);
    gl_PointSize = (2.2 + aSeed * 2.6) * (140.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const MOTE_FRAG = /* glsl */ `
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d) * 0.32 * vFade;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vec3(1.0, 0.87, 0.62) * a, a);
  }
`;

function DustMotes({ width, height, quality }: {
  width: number;
  height: number;
  quality: 'high' | 'low';
}) {
  const matRef = React.useRef<THREE.ShaderMaterial>(null);
  const count = Math.min(quality === 'high' ? 320 : 140, width * height * 2);

  const { positions, seeds } = React.useMemo(() => {
    // Deterministic scatter (mulberry-ish hash) — stable across re-renders.
    let s = width * 73856093 + height * 19349663;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = rnd() * width;
      positions[i * 3 + 1] = 0.15 + rnd() * 2.4;
      positions[i * 3 + 2] = rnd() * height;
      seeds[i] = rnd();
    }
    return { positions, seeds };
  }, [width, height, count]);

  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={MOTE_VERT}
        fragmentShader={MOTE_FRAG}
        uniforms={{ uTime: { value: 0 } }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

const WATER_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

// Two counter-scrolling interference bands ≈ cheap caustics.
const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 6.2831;
    float a = sin(p.x * 1.4 + uTime * 0.9) * sin(p.y * 1.1 - uTime * 0.7);
    float b = sin((p.x + p.y) * 0.9 - uTime * 0.5) * sin((p.x - p.y) * 1.3 + uTime * 0.8);
    float c = pow(max(0.0, a * b), 1.6);
    // Fade at the quad edge so ripples never touch the tile rim.
    float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x)
               * smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
    float alpha = c * 0.5 * edge;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vec3(0.55, 0.9, 1.0) * alpha, alpha);
  }
`;

const WATERY = new Set(['water', 'river', 'lava']);

function WaterShimmer({ map, visibility }: {
  map: MapData;
  visibility?: TileVisibility[][];
}) {
  const meshRef = React.useRef<THREE.InstancedMesh>(null);
  const matRef = React.useRef<THREE.ShaderMaterial>(null);

  const tiles = React.useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (visibility && visibility[y]?.[x] === 'hidden') continue;
        if (WATERY.has(map.tiles[y][x].terrain)) out.push([x, y]);
      }
    }
    return out;
  }, [map, visibility]);

  React.useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    // Water tiles sit ~20% of a slab below ground (see ModelTiles
    // TILE_Y_OFFSET); ripples float just above that sunken surface.
    tiles.forEach(([x, y], i) => {
      m.copy(rot).setPosition(x + 0.5, -0.075, y + 0.5);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = tiles.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [tiles]);

  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.elapsedTime;
  });

  if (tiles.length === 0) return null;
  return (
    <instancedMesh
      key={tiles.length}
      ref={meshRef}
      args={[undefined, undefined, tiles.length]}
      frustumCulled={false}
    >
      <planeGeometry args={[0.96, 0.96]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={WATER_VERT}
        fragmentShader={WATER_FRAG}
        uniforms={{ uTime: { value: 0 } }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

/** Persistent overlay for bile-infected tiles (Seercaust's Spray Bile):
 *  a pulsing violet wash so the status reads on the board, like the 2D
 *  renderer's bile overlay. */
function BileOverlay({ map, visibility }: {
  map: MapData;
  visibility?: TileVisibility[][];
}) {
  const meshRef = React.useRef<THREE.InstancedMesh>(null);
  const matRef = React.useRef<THREE.MeshBasicMaterial>(null);

  const tiles = React.useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (visibility && visibility[y]?.[x] === 'hidden') continue;
        if (map.tiles[y][x].bile) out.push([x, y]);
      }
    }
    return out;
  }, [map, visibility]);

  React.useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    tiles.forEach(([x, y], i) => {
      m.copy(rot).setPosition(x + 0.5, 0.018, y + 0.5);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = tiles.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [tiles]);

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.opacity = 0.22 + Math.sin(clock.elapsedTime * 2.2) * 0.07;
    }
  });

  if (tiles.length === 0) return null;
  return (
    <instancedMesh
      key={tiles.length}
      ref={meshRef}
      args={[undefined, undefined, tiles.length]}
      frustumCulled={false}
    >
      <planeGeometry args={[0.92, 0.92]} />
      <meshBasicMaterial
        ref={matRef}
        color="#b26bff"
        transparent
        opacity={0.26}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

export function TilesetFX({ map, visibility, quality = 'high' }: {
  map: MapData;
  visibility?: TileVisibility[][];
  quality?: 'high' | 'low';
}) {
  return (
    <>
      <DustMotes width={map.width} height={map.height} quality={quality} />
      <WaterShimmer map={map} visibility={visibility} />
      <BileOverlay map={map} visibility={visibility} />
    </>
  );
}
