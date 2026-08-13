import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { TileVisibility } from '@tactica/engine';
import type { CameraInteraction } from '../CameraRig.js';
import type { MapData } from '../types.js';

/**
 * Ashwater's clean tactical tileset. Terrain is intentionally restrained so
 * GLB units, highlights and combat forecasts own the visual hierarchy.
 *
 * The board uses chunky individual slabs, quiet two-tone surfaces, animated
 * mineral water and compact faceted mountain clusters. No generated billboard
 * art and no procedural crack/squiggle lines.
 */

type SurfaceKind = 'salt' | 'clay' | 'scrub' | 'mountain';

interface TileInstance {
  matrix: THREE.Matrix4;
  seed: number;
}

interface LiquidInstance extends TileInstance {
  shore: [number, number, number, number];
}

interface PropInstance {
  position: [number, number, number];
  scale: [number, number, number];
  rotation: number;
}

const SURFACE_COLORS: Record<SurfaceKind, { top: string; light: string; fleck: string }> = {
  salt:     { top: '#b97b4d', light: '#dca56f', fleck: '#89593d' },
  clay:     { top: '#985b3e', light: '#bd7952', fleck: '#72432f' },
  scrub:    { top: '#766348', light: '#98805a', fleck: '#4f4735' },
  mountain: { top: '#81513c', light: '#a76d4d', fleck: '#5a382d' },
};

const LIQUID = new Set(['water', 'river', 'lava']);

function hash01(x: number, y: number, salt = 0): number {
  let value = Math.imul(x + 17 + salt, 374761393) ^ Math.imul(y + 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function surfaceKind(terrain: string): SurfaceKind {
  if (terrain === 'mountain') return 'mountain';
  if (terrain === 'forest') return 'scrub';
  if (terrain === 'plains' || terrain === 'snow') return 'clay';
  return 'salt';
}

function isVisible(visibility: TileVisibility[][] | undefined, x: number, y: number): boolean {
  return !visibility || visibility[y]?.[x] !== 'hidden';
}

function isLand(map: MapData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  return LIQUID.has(map.tiles[y][x].terrain) ? 0 : 1;
}

function buildTiles(
  map: MapData,
  visibility: TileVisibility[][] | undefined,
  occupied: Set<string> | undefined,
) {
  const surfaces: Record<SurfaceKind, TileInstance[]> = {
    salt: [], clay: [], scrub: [], mountain: [],
  };
  const water: LiquidInstance[] = [];
  const lava: LiquidInstance[] = [];
  const basin: TileInstance[] = [];
  const mountainBase: PropInstance[] = [];
  const mountainPeak: PropInstance[] = [];
  const mountainTip: PropInstance[] = [];
  const scrubStem: PropInstance[] = [];
  const scrubCrown: PropInstance[] = [];
  const scatter: PropInstance[] = [];

  const flatRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const flatScale = new THREE.Vector3(0.965, 0.965, 1);
  const slabScale = new THREE.Vector3(0.982, 0.30, 0.982);

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isVisible(visibility, x, y)) continue;
      const terrain = map.tiles[y][x].terrain;
      const seed = hash01(x, y);
      const cx = x + 0.5;
      const cz = y + 0.5;

      if (LIQUID.has(terrain)) {
        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(cx, -0.075, cz),
          flatRotation,
          flatScale,
        );
        const liquid: LiquidInstance = {
          matrix,
          seed,
          shore: [
            isLand(map, x, y - 1),
            isLand(map, x + 1, y),
            isLand(map, x, y + 1),
            isLand(map, x - 1, y),
          ],
        };
        (terrain === 'lava' ? lava : water).push(liquid);
        basin.push({
          matrix: new THREE.Matrix4().compose(
            new THREE.Vector3(cx, -0.23, cz),
            new THREE.Quaternion(),
            new THREE.Vector3(0.982, 0.30, 0.982),
          ),
          seed,
        });
        continue;
      }

      const kind = surfaceKind(terrain);
      surfaces[kind].push({
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(cx, 0.008, cz),
          flatRotation,
          flatScale,
        ),
        seed,
      });
      basin.push({
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(cx, -0.15, cz),
          new THREE.Quaternion(),
          slabScale,
        ),
        seed,
      });

      const occupiedTile = occupied?.has(`${x},${y}`) ?? false;
      if (terrain === 'mountain' && !occupiedTile) {
        const rot = seed * Math.PI * 2;
        // A broad foot and three uneven sharp peaks read as a mountain range,
        // while staying inside the tile and below the units' visual dominance.
        mountainBase.push({ position: [cx - 0.02, 0.11, cz], scale: [1, 1, 1], rotation: rot });
        mountainPeak.push({ position: [cx - 0.08, 0.42, cz - 0.06], scale: [1, 1, 1], rotation: rot });
        mountainTip.push({ position: [cx - 0.08, 0.69, cz - 0.06], scale: [1, 1, 1], rotation: rot });
        mountainPeak.push({ position: [cx + 0.21, 0.27, cz + 0.13], scale: [0.58, 0.57, 0.58], rotation: rot + 1.7 });
        mountainPeak.push({ position: [cx - 0.24, 0.23, cz + 0.16], scale: [0.46, 0.46, 0.46], rotation: rot - 1.1 });
      } else if (terrain === 'forest' && !occupiedTile) {
        const count = seed > 0.5 ? 3 : 2;
        for (let i = 0; i < count; i++) {
          const a = seed * 11 + i * 2.34;
          const px = cx - 0.12 + Math.cos(a) * (0.11 + i * 0.025);
          const pz = cz - 0.10 + Math.sin(a) * (0.11 + i * 0.025);
          const h = 0.16 + hash01(x, y, i + 7) * 0.14;
          scrubStem.push({ position: [px, h * 0.5, pz], scale: [0.055, h, 0.055], rotation: a });
          scrubCrown.push({ position: [px, h + 0.035, pz], scale: [0.10, 0.13, 0.10], rotation: a });
        }
      } else if (terrain === 'sand' && seed > 0.78 && !map.tiles[y][x].isCity) {
        const a = seed * Math.PI * 2;
        scatter.push({
          position: [cx + Math.cos(a) * 0.22, 0.035, cz + Math.sin(a) * 0.20],
          scale: [0.075 + seed * 0.04, 0.05, 0.065],
          rotation: a,
        });
      }
    }
  }

  return {
    surfaces, water, lava, basin,
    mountainBase, mountainPeak, mountainTip,
    scrubStem, scrubCrown, scatter,
  };
}

function InstancedBoxes({ instances, color }: { instances: TileInstance[]; color: string }) {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    instances.forEach((instance, i) => mesh.setMatrixAt(i, instance.matrix));
    mesh.instanceMatrix.needsUpdate = true;
  }, [instances]);
  if (instances.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, instances.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.94} metalness={0.01} flatShading />
    </instancedMesh>
  );
}

const SURFACE_VERTEX = /* glsl */ `
  attribute float aSeed;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const SURFACE_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uLight;
  uniform vec3 uFleck;
  varying vec2 vUv;
  varying float vSeed;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed * 71.3) * 43758.5453);
  }

  void main() {
    // Clean, quiet material: broad tonal blocks and a few tiny mineral flecks.
    // There are deliberately no sine cracks or wandering line patterns.
    vec2 q = floor(vUv * 24.0) / 24.0;
    float broad = hash(floor(q * 4.0));
    float speck = step(0.965, hash(floor(q * 20.0)));
    float edge = smoothstep(0.0, 0.045,
      min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
    vec3 base = mix(uTop, uLight, 0.10 + broad * 0.08);
    base = mix(base * 0.68, base, edge);
    vec3 color = mix(base, uFleck, speck * 0.38);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function SurfaceLayer({ instances, kind }: { instances: TileInstance[]; kind: SurfaceKind }) {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  const seeds = React.useMemo(() => new Float32Array(instances.map(i => i.seed)), [instances]);
  const colors = SURFACE_COLORS[kind];
  const uniforms = React.useMemo(() => ({
    uTop: { value: new THREE.Color(colors.top) },
    uLight: { value: new THREE.Color(colors.light) },
    uFleck: { value: new THREE.Color(colors.fleck) },
  }), [colors]);

  React.useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    instances.forEach((instance, i) => mesh.setMatrixAt(i, instance.matrix));
    mesh.instanceMatrix.needsUpdate = true;
  }, [instances]);
  if (instances.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, instances.length]} receiveShadow>
      <planeGeometry args={[1, 1]}>
        <instancedBufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </planeGeometry>
      <shaderMaterial vertexShader={SURFACE_VERTEX} fragmentShader={SURFACE_FRAGMENT} uniforms={uniforms} />
    </instancedMesh>
  );
}

const LIQUID_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute vec4 aShore;
  varying vec2 vUv;
  varying float vSeed;
  varying vec4 vShore;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vShore = aShore;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const LIQUID_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uBright;
  varying vec2 vUv;
  varying float vSeed;
  varying vec4 vShore;

  void main() {
    vec2 q = floor(vUv * 48.0) / 48.0;
    float waveA = sin((q.x * 1.4 + q.y * 0.38) * 22.0 + uTime * 1.8 + vSeed * 8.0);
    float waveB = sin((q.y - q.x * 0.55) * 18.0 - uTime * 1.25 + vSeed * 11.0);
    float lines = smoothstep(0.82, 0.98, waveA * waveB);

    float north = vShore.x * (1.0 - smoothstep(0.02, 0.15, vUv.y));
    float east  = vShore.y * smoothstep(0.85, 0.98, vUv.x);
    float south = vShore.z * smoothstep(0.85, 0.98, vUv.y);
    float west  = vShore.w * (1.0 - smoothstep(0.02, 0.15, vUv.x));
    float shore = clamp(north + east + south + west, 0.0, 1.0);
    float foamBreak = step(0.22, sin((vUv.x - vUv.y) * 62.0 + vSeed * 27.0 + uTime * 2.0));
    float foam = shore * (0.34 + 0.66 * foamBreak);

    vec3 color = mix(uDeep, uMid, 0.46 + lines * 0.28);
    color = mix(color, uBright * 1.35, clamp(lines * 0.26 + foam * 0.72, 0.0, 1.0));
    gl_FragColor = vec4(color, 0.98);
  }
`;

function LiquidLayer({ instances, lava = false }: { instances: LiquidInstance[]; lava?: boolean }) {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  const materialRef = React.useRef<THREE.ShaderMaterial>(null);
  const seeds = React.useMemo(() => new Float32Array(instances.map(i => i.seed)), [instances]);
  const shores = React.useMemo(() => new Float32Array(instances.flatMap(i => i.shore)), [instances]);
  const uniforms = React.useMemo(() => ({
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(lava ? '#4a1007' : '#0a3542') },
    uMid: { value: new THREE.Color(lava ? '#d9430d' : '#14859a') },
    uBright: { value: new THREE.Color(lava ? '#ffd45d' : '#91f0e8') },
  }), [lava]);

  React.useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    instances.forEach((instance, i) => mesh.setMatrixAt(i, instance.matrix));
    mesh.instanceMatrix.needsUpdate = true;
  }, [instances]);
  useFrame(({ clock }) => {
    if (materialRef.current) materialRef.current.uniforms.uTime.value = clock.elapsedTime;
  });
  if (instances.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, instances.length]} frustumCulled={false}>
      <planeGeometry args={[1, 1]}>
        <instancedBufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
        <instancedBufferAttribute attach="attributes-aShore" args={[shores, 4]} />
      </planeGeometry>
      <shaderMaterial
        ref={materialRef}
        vertexShader={LIQUID_VERTEX}
        fragmentShader={LIQUID_FRAGMENT}
        uniforms={uniforms}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

type PropKind = 'mountainBase' | 'mountainPeak' | 'mountainTip' | 'stem' | 'crown' | 'rock';

function PropLayer({ instances, kind, color }: {
  instances: PropInstance[];
  kind: PropKind;
  color: string;
}) {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    instances.forEach((instance, i) => {
      quaternion.setFromAxisAngle(up, instance.rotation);
      matrix.compose(
        new THREE.Vector3(...instance.position),
        quaternion,
        new THREE.Vector3(...instance.scale),
      );
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [instances]);
  if (instances.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, instances.length]} castShadow receiveShadow>
      {kind === 'mountainBase' && <cylinderGeometry args={[0.32, 0.40, 0.20, 7]} />}
      {kind === 'mountainPeak' && <coneGeometry args={[0.31, 0.72, 6]} />}
      {kind === 'mountainTip' && <cylinderGeometry args={[0.025, 0.14, 0.20, 6]} />}
      {kind === 'stem' && <cylinderGeometry args={[0.5, 0.7, 1, 5]} />}
      {kind === 'crown' && <octahedronGeometry args={[1, 0]} />}
      {kind === 'rock' && <dodecahedronGeometry args={[1, 0]} />}
      <meshStandardMaterial color={color} roughness={0.9} metalness={0.01} flatShading />
    </instancedMesh>
  );
}

export function BreachTiles({ map, visibility, onTileClick, onTileHover, interaction, occupied }: {
  map: MapData;
  visibility?: TileVisibility[][];
  onTileClick?: (x: number, y: number) => void;
  onTileHover?: (x: number | null, y?: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
  occupied?: Set<string>;
}) {
  const built = React.useMemo(() => buildTiles(map, visibility, occupied), [map, visibility, occupied]);

  const handleClick = React.useCallback((event: ThreeEvent<MouseEvent>) => {
    if (!onTileClick || interaction?.current.suppressClick) return;
    event.stopPropagation();
    onTileClick(
      Math.min(map.width - 1, Math.max(0, Math.floor(event.point.x))),
      Math.min(map.height - 1, Math.max(0, Math.floor(event.point.z))),
    );
  }, [interaction, map.height, map.width, onTileClick]);

  return (
    <>
      <InstancedBoxes instances={built.basin} color="#382820" />
      {(Object.keys(built.surfaces) as SurfaceKind[]).map(kind => (
        <SurfaceLayer key={kind} instances={built.surfaces[kind]} kind={kind} />
      ))}
      <LiquidLayer instances={built.water} />
      <LiquidLayer instances={built.lava} lava />

      <PropLayer instances={built.mountainBase} kind="mountainBase" color="#5a382e" />
      <PropLayer instances={built.mountainPeak} kind="mountainPeak" color="#724633" />
      <PropLayer instances={built.mountainTip} kind="mountainTip" color="#aa7452" />
      <PropLayer instances={built.scrubStem} kind="stem" color="#3e4936" />
      <PropLayer instances={built.scrubCrown} kind="crown" color="#7f8754" />
      <PropLayer instances={built.scatter} kind="rock" color="#72513d" />

      <mesh
        rotation-x={-Math.PI / 2}
        position={[map.width / 2, 0.035, map.height / 2]}
        visible={false}
        onClick={handleClick}
        onPointerMove={event => onTileHover?.(
          Math.min(map.width - 1, Math.max(0, Math.floor(event.point.x))),
          Math.min(map.height - 1, Math.max(0, Math.floor(event.point.z))),
        )}
        onPointerLeave={() => onTileHover?.(null)}
      >
        <planeGeometry args={[map.width, map.height]} />
      </mesh>
    </>
  );
}
