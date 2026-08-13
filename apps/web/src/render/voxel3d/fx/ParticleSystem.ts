import * as THREE from 'three';
import { noiseGLSL, commonGLSL } from './glsl.js';

/**
 * Pooled, GPU-simulated particle system for ability VFX.
 *
 * Ported (adapted) from the MIT-licensed LinearAbiltyCastingThreeJS sandbox
 * (github.com/achrefelouafi/LinearAbiltyCastingThreeJS). Every particle's
 * motion (velocity, gravity, drag, turbulence, swirl), size curve, colour
 * gradient and alpha fade are evaluated in the vertex/fragment shader from
 * per-instance spawn attributes. The CPU only ever WRITES spawn data — nothing
 * is simulated per frame on the main thread and no memory is allocated after
 * construction. Particles live in a ring buffer, so spamming casts recycles
 * the oldest slots instead of growing.
 *
 * Differences from the reference: no depth-prepass soft-fade (this renderer
 * has no packed-depth pass) and no render layers. Colours brighter than 1.0
 * bloom automatically through PostFX's luminance-thresholded Bloom.
 */

/** Fragment silhouettes. Everything is procedural — no sprite textures. */
export const ParticleShape = Object.freeze({
  SOFT: 0, // round, feathered — embers, motes, flashes
  SMOKE: 1, // fbm-eroded puff
  STREAK: 2, // velocity-aligned spark
  CHIP: 3, // angular debris fragment
  RING: 4, // thin expanding ring — shockwaves
});

const FLOATS: Record<string, number> = {
  start: 3,
  velocity: 3,
  color: 3,
  spawn: 1,
  life: 1,
  size: 1,
  seed: 1,
  spin: 1,
};

const _tmpVec = new THREE.Vector3();

export interface ParticleSystemOptions {
  name: string;
  capacity?: number;
  shape?: number;
  additive?: boolean;
  curl?: boolean;
  stretch?: boolean;
}

export interface EmitParams {
  position: THREE.Vector3;
  radius?: number;
  direction?: THREE.Vector3 | null;
  speed?: number;
  speedVariance?: number;
  spread?: number;
  size?: number;
  sizeVariance?: number;
  life?: number;
  lifeVariance?: number;
  spin?: number;
  tint?: THREE.Color | null;
  /** Current clock.elapsedTime — must match the uTime this system is ticked with. */
  time: number;
}

export class ParticleSystem {
  readonly name: string;
  readonly capacity: number;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly material: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  private cursor = 0;
  private data: Record<string, Float32Array> = {};
  private attributes: Record<string, THREE.InstancedBufferAttribute> = {};
  private ranges: [number, number][] = [];
  private dirty = false;

  constructor({
    name,
    capacity = 2000,
    shape = ParticleShape.SOFT,
    additive = true,
    curl = false,
    stretch = false,
  }: ParticleSystemOptions) {
    this.name = name;
    this.capacity = capacity;

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
    );
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

    for (const [key, itemSize] of Object.entries(FLOATS)) {
      const array = new Float32Array(capacity * itemSize);
      const attribute = new THREE.InstancedBufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
      this.data[key] = array;
      this.attributes[key] = attribute;
      geometry.setAttribute(`a${key[0].toUpperCase()}${key.slice(1)}`, attribute);
    }
    // Everything starts dead (spawn far in the past, zero life).
    this.data.spawn.fill(-1e4);
    geometry.instanceCount = capacity;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.geometry = geometry;

    const defines: Record<string, number | string> = { SHAPE: shape };
    if (curl) defines.USE_CURL = '';
    if (stretch) defines.USE_STRETCH = '';

    this.material = new THREE.ShaderMaterial({
      defines,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uGravity: { value: new THREE.Vector3(0, -4.5, 0) },
        uDrag: { value: 0.9 },
        uTurbulence: { value: 0.4 },
        uTurbFrequency: { value: 1.2 },
        uTurbSpeed: { value: 0.35 },
        uEndSize: { value: 0.4 },
        uSizeIn: { value: 0.08 },
        uFadeIn: { value: 0.08 },
        uFadeOut: { value: 0.55 },
        uOpacity: { value: 1 },
        uGlow: { value: 1 },
        uStretch: { value: 0.15 },
        uColor0: { value: new THREE.Color(1, 1, 1) },
        uColor1: { value: new THREE.Color(1, 0.7, 0.3) },
        uColor2: { value: new THREE.Color(0.6, 0.15, 0.05) },
        uColor3: { value: new THREE.Color(0.08, 0.06, 0.06) },
      },
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = additive ? 12 : 10;
    this.mesh.name = `Particles:${name}`;
  }

  get uniforms() {
    return this.material.uniforms;
  }

  /**
   * Spawn `count` particles. `params` is read, never retained — callers reuse
   * one scratch object per emitter to keep the frame allocation-free.
   */
  emit(count: number, p: EmitParams) {
    if (count <= 0) return;
    count = Math.min(count, this.capacity);

    const {
      position,
      radius = 0,
      direction = null,
      speed = 1,
      speedVariance = 0.35,
      spread = 0.5,
      size = 0.2,
      sizeVariance = 0.4,
      life = 1,
      lifeVariance = 0.3,
      spin = 0,
      tint = null,
      time,
    } = p;

    const d = this.data;

    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      this.markDirty(i);

      const i3 = i * 3;

      // Uniform-ish point in a ball around the emission point.
      let ox = 0, oy = 0, oz = 0;
      if (radius > 0) {
        const r = radius * Math.cbrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const s = Math.sin(phi);
        ox = r * s * Math.cos(theta);
        oy = r * Math.cos(phi);
        oz = r * s * Math.sin(theta);
      }
      d.start[i3 + 0] = position.x + ox;
      d.start[i3 + 1] = position.y + oy;
      d.start[i3 + 2] = position.z + oz;

      if (direction) _tmpVec.copy(direction);
      else _tmpVec.set(0, 1, 0);
      if (spread > 0) {
        _tmpVec.x += (Math.random() - 0.5) * 2 * spread;
        _tmpVec.y += (Math.random() - 0.5) * 2 * spread;
        _tmpVec.z += (Math.random() - 0.5) * 2 * spread;
      }
      _tmpVec.normalize().multiplyScalar(speed * (1 + (Math.random() - 0.5) * 2 * speedVariance));
      d.velocity[i3 + 0] = _tmpVec.x;
      d.velocity[i3 + 1] = _tmpVec.y;
      d.velocity[i3 + 2] = _tmpVec.z;

      d.spawn[i] = time;
      d.life[i] = Math.max(0.05, life * (1 + (Math.random() - 0.5) * 2 * lifeVariance));
      d.size[i] = Math.max(0.001, size * (1 + (Math.random() - 0.5) * 2 * sizeVariance));
      d.seed[i] = Math.random();
      d.spin[i] = (Math.random() - 0.5) * 2 * spin;

      if (tint) {
        d.color[i3 + 0] = tint.r;
        d.color[i3 + 1] = tint.g;
        d.color[i3 + 2] = tint.b;
      } else {
        d.color[i3 + 0] = 1;
        d.color[i3 + 1] = 1;
        d.color[i3 + 2] = 1;
      }
    }
  }

  private markDirty(index: number) {
    this.dirty = true;
    // Emissions are contiguous, so merging into the last range is almost
    // always a single comparison.
    const last = this.ranges[this.ranges.length - 1];
    if (last && index === last[0] + last[1]) last[1]++;
    else this.ranges.push([index, 1]);
  }

  /** Upload only the slots that changed this frame. Call once per frame. */
  flush() {
    if (!this.dirty) return;
    for (const [key, itemSize] of Object.entries(FLOATS)) {
      const attribute = this.attributes[key];
      attribute.needsUpdate = true;
      attribute.clearUpdateRanges();
      for (const [start, count] of this.ranges) {
        attribute.addUpdateRange(start * itemSize, count * itemSize);
      }
    }
    this.ranges.length = 0;
    this.dirty = false;
  }

  /** 4-stop lifetime gradient (core → mid → edge → tail). */
  setGradient(c0: THREE.ColorRepresentation, c1: THREE.ColorRepresentation, c2: THREE.ColorRepresentation, c3: THREE.ColorRepresentation) {
    const u = this.uniforms;
    (u.uColor0.value as THREE.Color).set(c0);
    (u.uColor1.value as THREE.Color).set(c1);
    (u.uColor2.value as THREE.Color).set(c2);
    (u.uColor3.value as THREE.Color).set(c3);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Fractional-rate emitter. Emitting `rate * dt` per frame truncates to zero at
 * high frame rates and bursts at low ones; accumulating the remainder makes
 * emission frame-rate independent.
 */
export class RateEmitter {
  private accumulator = 0;

  /** @returns whole particles to spawn this frame */
  tick(dt: number, rate: number): number {
    this.accumulator += rate * dt;
    const count = Math.floor(this.accumulator);
    this.accumulator -= count;
    // Never let a stall dump hundreds of particles in a single frame.
    return Math.min(count, 120);
  }

  reset() {
    this.accumulator = 0;
  }
}

/* ---------------------------------------------------------------------- */
/* Shaders                                                                 */
/* ---------------------------------------------------------------------- */

const PARTICLE_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform vec3  uGravity;
  uniform float uDrag;
  uniform float uTurbulence;
  uniform float uTurbFrequency;
  uniform float uTurbSpeed;
  uniform float uEndSize;
  uniform float uSizeIn;
  uniform float uStretch;

  attribute vec3  aStart;
  attribute vec3  aVelocity;
  attribute vec3  aColor;
  attribute float aSpawn;
  attribute float aLife;
  attribute float aSize;
  attribute float aSeed;
  attribute float aSpin;

  varying vec2  vUv;
  varying float vT;
  varying float vSeed;
  varying vec3  vTint;

  ${noiseGLSL}

  void main() {
    vUv = uv;
    vSeed = aSeed;
    vTint = aColor;

    float age = uTime - aSpawn;
    float t = age / max(aLife, 1e-4);
    vT = t;

    // Dead particles are pushed outside the clip volume; the GPU discards the
    // whole triangle before rasterisation.
    if (age < 0.0 || t > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    // Analytic exponential drag — exact, and independent of frame rate.
    float k = max(uDrag, 1e-3);
    float travel = (1.0 - exp(-k * age)) / k;
    vec3 pos = aStart + aVelocity * travel + 0.5 * uGravity * age * age;

    #ifdef USE_CURL
      pos += curlNoise(aStart * uTurbFrequency + vec3(0.0, uTime * uTurbSpeed, 0.0) + aSeed * 4.0)
             * uTurbulence * age;
    #else
      vec3 wobble = vec3(
        sin(age * 3.1 + aSeed * 41.0),
        cos(age * 2.3 + aSeed * 17.0),
        sin(age * 2.7 + aSeed * 73.0)
      );
      pos += wobble * uTurbulence * age * 0.55;
    #endif

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

    // Size over lifetime.
    float grow = smoothstep(0.0, max(uSizeIn, 1e-3), t);
    float size = aSize * mix(1.0, uEndSize, t) * grow;

    vec2 corner = position.xy * size;

    #ifdef USE_STRETCH
      vec3 velView = (modelViewMatrix * vec4(aVelocity, 0.0)).xyz;
      vec2 dir = normalize(velView.xy + vec2(1e-5));
      vec2 perp = vec2(-dir.y, dir.x);
      float stretch = 1.0 + uStretch * length(aVelocity);
      corner = dir * (position.y * size * stretch) + perp * (position.x * size);
    #else
      float rot = aSpin * age + aSeed * 6.2831;
      corner = rot2(rot) * corner;
    #endif

    mvPosition.xy += corner;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uGlow;
  uniform float uFadeIn;
  uniform float uFadeOut;
  uniform vec3  uColor0;
  uniform vec3  uColor1;
  uniform vec3  uColor2;
  uniform vec3  uColor3;

  varying vec2  vUv;
  varying float vT;
  varying float vSeed;
  varying vec3  vTint;

  ${noiseGLSL}
  ${commonGLSL}

  float shapeMask(vec2 uv) {
    vec2 c = (uv - 0.5) * 2.0;
    float d = length(c);

    #if SHAPE == 0                       // SOFT
      return smoothstep(1.0, 0.0, d);

    #elif SHAPE == 1                     // SMOKE
      float n = fbm3(vec3(c * 1.6, vSeed * 21.0 + uTime * 0.25));
      return smoothstep(1.0, 0.05, d + n * 0.42) * 0.9;

    #elif SHAPE == 2                     // STREAK
      float core = smoothstep(1.0, 0.0, abs(c.x) * 3.4);
      float len = smoothstep(1.0, 0.0, abs(c.y));
      return core * len;

    #elif SHAPE == 3                     // CHIP
      float ang = atan(c.y, c.x);
      float r = 0.62 + 0.24 * sin(ang * 5.0 + vSeed * 30.0) + 0.1 * sin(ang * 9.0 - vSeed * 11.0);
      return smoothstep(r, r - 0.14, d);

    #else                                // RING
      return smoothstep(0.14, 0.0, abs(d - 0.82));
    #endif
  }

  void main() {
    if (vT < 0.0 || vT > 1.0) discard;

    float mask = shapeMask(vUv);
    if (mask <= 0.004) discard;

    float fade = smoothstep(0.0, max(uFadeIn, 1e-3), vT) *
                 (1.0 - smoothstep(clamp(uFadeOut, 0.0, 0.999), 1.0, vT));

    float alpha = mask * fade * uOpacity;
    if (alpha < 0.004) discard;

    vec3 color = gradient4(uColor0, uColor1, uColor2, uColor3, vT) * vTint;
    color *= uGlow;

    gl_FragColor = vec4(color, alpha);
  }
`;
