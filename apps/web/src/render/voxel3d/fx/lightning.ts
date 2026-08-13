import * as THREE from 'three';
import { noiseGLSL } from './glsl.js';

/**
 * Procedural lightning bolt: an instanced camera-facing ribbon whose every
 * vertex is placed by the vertex shader.
 *
 * Ported (adapted) from the MIT-licensed LinearAbiltyCastingThreeJS sandbox
 * (github.com/achrefelouafi/LinearAbiltyCastingThreeJS). A vertex arrives as
 * `(t, side)` — how far along the bolt and which edge of the ribbon — and
 * leaves as a world position. Three things stack to make the shape:
 *
 *   1. the axis — a straight line origin → target, bowed by sag
 *   2. the fan — a per-filament offset perpendicular to the axis, opening from
 *      spreadNear at the hand to spread at the target, rolling with twist
 *   3. the kinks — octaves of LINEARLY interpolated value noise. Linear on
 *      purpose: smoothstep would round the corners off, and the corners are
 *      the entire reason it reads as lightning rather than a wobbly tube.
 *
 * Drawn in two passes over the same filaments — a wide soft halo underneath
 * and the hot core on top — so the glow stays attached to every kink instead
 * of relying on bloom alone. Defaults are tuned for Rigbound's 1-unit tiles
 * (casts of 1–3 world units) rather than the reference's metres.
 */

export const BoltPass = Object.freeze({ CORE: 0, GLOW: 1 });

const NODES = 56;
export const MAX_STRANDS = 12;

export function createBoltRibbonGeometry(nodes = NODES, strands = MAX_STRANDS) {
  const steps = Math.max(2, Math.round(nodes));
  const count = Math.max(1, Math.round(strands));

  const positions = new Float32Array(steps * 2 * 3);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const o = i * 6;
    positions[o + 0] = t;
    positions[o + 1] = -1;
    positions[o + 3] = t;
    positions[o + 4] = 1;
  }

  const indices = new Uint16Array((steps - 1) * 6);
  for (let i = 0; i < steps - 1; i++) {
    const a = i * 2;
    const o = i * 6;
    indices[o + 0] = a;
    indices[o + 1] = a + 1;
    indices[o + 2] = a + 2;
    indices[o + 3] = a + 1;
    indices[o + 4] = a + 3;
    indices[o + 5] = a + 2;
  }

  const strandIndex = new Float32Array(count);
  for (let i = 0; i < count; i++) strandIndex[i] = i;

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aStrand', new THREE.InstancedBufferAttribute(strandIndex, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.instanceCount = count;
  // Built in world space in the vertex shader, so the geometry's own bounds
  // are meaningless — the mesh sets frustumCulled = false instead.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return geometry;
}

const BOLT_VERTEX = /* glsl */ `
  #define PI  3.141592653589793
  #define TAU 6.283185307179586

  uniform float uTime;
  uniform vec3  uOrigin;
  uniform vec3  uTarget;
  uniform vec3  uSide;
  uniform float uSag;
  uniform float uSeed;
  uniform float uRestrike;

  uniform float uStrands;
  uniform float uSpread;
  uniform float uSpreadNear;
  uniform float uTwist;
  uniform float uTwistSpeed;

  uniform float uJitter;
  uniform float uJitterScale;
  uniform float uJitterFalloff;
  uniform float uCrawl;
  uniform float uPinch;

  uniform float uWidth;
  uniform float uWidthTip;
  uniform float uCoreWidth;
  uniform float uWidthScale;
  uniform float uStrandFlash;
  uniform float uFlickerSpeed;
  uniform float uFade;

  attribute float aStrand;

  varying float vT;
  varying float vSide;
  varying float vStrand;
  varying float vFlash;

  ${noiseGLSL}

  /** Value noise with a LINEAR ramp — piecewise-linear output, sharp corners. */
  float vnoise(float x, float seed) {
    float i = floor(x);
    float f = x - i;
    return mix(hash11(i + seed), hash11(i + 1.0 + seed), f) * 2.0 - 1.0;
  }

  /** Offset of one filament from the axis, in the perpendicular plane.
   *  span keeps uJitterScale in kinks per world unit however far it reaches. */
  vec2 kink(float t, float seed, float span) {
    vec2 o = vec2(0.0);
    float amp = 1.0;
    float freq = max(uJitterScale, 0.01) * span;
    float scroll = uTime * uCrawl;

    for (int i = 0; i < 4; i++) {
      o.x += amp * vnoise(t * freq + scroll, seed + 13.0 * float(i));
      o.y += amp * vnoise(t * freq + scroll * 1.17, seed + 71.3 + 13.0 * float(i));
      amp *= uJitterFalloff;
      freq *= 2.0;
      scroll *= 1.63;
    }
    return o;
  }

  vec3 boltPoint(float t, float seed, float radial, vec3 n1, vec3 n2, float span) {
    vec3 axis = mix(uOrigin, uTarget, t);
    axis.y += uSag * sin(t * PI);

    // Pinned at both ends — a bolt that lands somewhere other than where it
    // was aimed reads as a bug.
    float pinch = max(uPinch, 1e-3);
    float ends = smoothstep(0.0, pinch, t) * smoothstep(0.0, pinch, 1.0 - t);

    vec2 offset = kink(t, seed, span) * uJitter * ends;

    float angle = seed * TAU + (t * uTwist + uTime * uTwistSpeed) * TAU;
    float reach = mix(uSpreadNear, uSpread, clamp(t, 0.0, 1.0));
    offset += vec2(cos(angle), sin(angle)) * reach * radial * ends;

    return axis + n1 * offset.x + n2 * offset.y;
  }

  void main() {
    float t = position.x;
    float side = position.y;
    vT = t;
    vSide = side;

    vec3 delta = uTarget - uOrigin;
    float span = max(length(delta), 0.01);
    vec3 dir = delta / span;
    // Gram-Schmidt: the axis tilts, so uSide is only approximately perpendicular.
    vec3 n1 = uSide - dir * dot(uSide, dir);
    n1 = length(n1) > 1e-4 ? normalize(n1) : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
    vec3 n2 = normalize(cross(dir, n1));

    // The strike index snaps every filament onto a new shape uRestrike times a
    // second; the crawl inside kink() slides it continuously in between.
    float strike = floor(uTime * max(uRestrike, 0.01));
    float seed = hash11(aStrand * 7.13 + uSeed + strike * 3.77) * 97.0;
    float radial = uStrands <= 1.0 ? 0.0 : aStrand / (uStrands - 1.0);
    vStrand = radial;

    vec3 here = boltPoint(t, seed, radial, n1, n2, span);

    // Tangent by finite difference, mirrored at the far end.
    float step_ = 0.02;
    float ahead = t + step_;
    float flip = 1.0;
    if (ahead > 1.0) { ahead = t - step_; flip = -1.0; }
    vec3 next = boltPoint(ahead, seed, radial, n1, n2, span);
    vec3 tangent = (next - here) * flip;
    tangent = length(tangent) > 1e-5 ? normalize(tangent) : dir;

    // Turn the ribbon to face the camera — keeps apparent thickness from any
    // angle without ever being a screen-space line.
    vec3 toCamera = normalize(cameraPosition - here);
    vec3 binormal = cross(tangent, toCamera);
    float bl = length(binormal);
    binormal = bl > 1e-4 ? binormal / bl : n1;

    // A stuttering per-filament blink, quantised so the whole bundle strobes
    // on the same clock instead of shimmering independently.
    float flash = mix(1.0, hash11(floor(uTime * uFlickerSpeed) + aStrand * 3.7 + uSeed), uStrandFlash);
    vFlash = flash;

    float halfWidth = uWidth * uWidthScale;
    halfWidth *= mix(1.0, uWidthTip, clamp(t, 0.0, 1.0));
    halfWidth *= mix(uCoreWidth, 1.0, radial);
    halfWidth *= flash * uFade;

    vec4 mv = viewMatrix * vec4(here + binormal * side * halfWidth, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const BOLT_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uProgress;
  uniform float uTipGlow;
  uniform float uTipLength;
  uniform float uCoreSharp;
  uniform float uGlowFalloff;
  uniform float uBranchDim;
  uniform float uFlicker;
  uniform float uFlickerSpeed;
  uniform float uPassOpacity;
  uniform float uGlow;
  uniform float uFade;
  uniform vec3  uColorCore;
  uniform vec3  uColorInner;
  uniform vec3  uColorOuter;
  uniform vec3  uColorHalo;

  varying float vT;
  varying float vSide;
  varying float vStrand;
  varying float vFlash;

  ${noiseGLSL}

  void main() {
    // Ahead of the strike front there is no bolt yet: drawn whole, clipped
    // here — the SHAPE never changes as the front travels, only how much of
    // it exists.
    float tip = max(uTipLength, 1e-3);
    float drawn = smoothstep(uProgress, uProgress - tip, vT);
    if (drawn <= 0.002) discard;

    float v = clamp(abs(vSide), 0.0, 1.0);

    #ifdef BOLT_GLOW
      float profile = pow(1.0 - v, max(uGlowFalloff, 0.05));
      vec3 color = mix(uColorHalo, uColorOuter, profile);
      float alpha = profile;
    #else
      float profile = pow(1.0 - v, max(uCoreSharp, 0.05));
      vec3 color = mix(uColorOuter, uColorInner, smoothstep(0.0, 0.5, profile));
      color = mix(color, uColorCore, smoothstep(0.45, 1.0, profile));
      float alpha = profile;
    #endif

    // The leading edge is where the air is actually breaking down.
    color += uColorCore * smoothstep(uProgress - tip * 2.0, uProgress, vT) * uTipGlow;

    // Quantised, not sinusoidal: real lightning stutters between brightnesses,
    // it does not breathe.
    float flicker = 1.0 - uFlicker * hash11(floor(uTime * uFlickerSpeed) + uSeed);

    alpha *= drawn * flicker * vFlash * uFade * uPassOpacity;
    alpha *= mix(1.0, clamp(uBranchDim, 0.0, 1.0), vStrand);
    if (alpha < 0.003) discard;

    color *= uGlow;
    gl_FragColor = vec4(color, alpha);
  }
`;

export interface BoltColors {
  core: THREE.ColorRepresentation;
  inner: THREE.ColorRepresentation;
  outer: THREE.ColorRepresentation;
  halo: THREE.ColorRepresentation;
}

/**
 * One pass of a bolt. Both passes share every uniform except width scale and
 * opacity, so the caller drives them together (uOrigin/uTarget/uSide/uSeed/
 * uProgress/uFade/uTime per frame; the rest are tile-scale defaults).
 */
export function createLightningMaterial(pass: number, colors: BoltColors) {
  const glow = pass === BoltPass.GLOW;

  return new THREE.ShaderMaterial({
    defines: glow ? { BOLT_GLOW: '' } : {},
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uTarget: { value: new THREE.Vector3(0, 0, 1) },
      uSide: { value: new THREE.Vector3(1, 0, 0) },
      uSag: { value: 0.1 },
      uSeed: { value: 0 },
      uRestrike: { value: 24 },
      uProgress: { value: 0 },
      uFade: { value: 1 },

      uStrands: { value: 7 },
      uSpread: { value: 0.14 },
      uSpreadNear: { value: 0.02 },
      uTwist: { value: 0.4 },
      uTwistSpeed: { value: 0.8 },
      uBranchDim: { value: 0.7 },

      uJitter: { value: 0.11 },
      uJitterScale: { value: 3.2 },
      uJitterFalloff: { value: 0.55 },
      uCrawl: { value: 3.2 },
      uPinch: { value: 0.14 },

      uWidth: { value: 0.026 },
      uWidthTip: { value: 0.6 },
      uCoreWidth: { value: 2.0 },
      uCoreSharp: { value: 3.4 },
      uGlowFalloff: { value: 2.4 },
      uWidthScale: { value: glow ? 7 : 1 },
      uPassOpacity: { value: glow ? 0.3 : 1 },

      uFlicker: { value: 0.3 },
      uFlickerSpeed: { value: 34 },
      uStrandFlash: { value: 0.5 },
      uTipGlow: { value: 2 },
      uTipLength: { value: 0.08 },

      uGlow: { value: 2.3 },
      uColorCore: { value: new THREE.Color(colors.core) },
      uColorInner: { value: new THREE.Color(colors.inner) },
      uColorOuter: { value: new THREE.Color(colors.outer) },
      uColorHalo: { value: new THREE.Color(colors.halo) },
    },
    vertexShader: BOLT_VERTEX,
    fragmentShader: BOLT_FRAGMENT,
  });
}
