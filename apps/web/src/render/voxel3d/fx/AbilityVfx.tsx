import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import type { AbilityFx, UnitView } from '../types.js';
import { ParticleSystem, ParticleShape, RateEmitter, type EmitParams } from './ParticleSystem.js';
import { createBoltRibbonGeometry, createLightningMaterial, BoltPass, MAX_STRANDS, type BoltColors } from './lightning.js';

/**
 * Procedural shader VFX for ability casts, in the idiom of the MIT-licensed
 * LinearAbiltyCastingThreeJS sandbox: GPU particles whose CPU side only
 * writes spawn data, and a vertex-shader lightning ribbon.
 *
 * Every active ability has a RECIPE — a declarative choreography composed
 * from shared elements:
 *   bolt     lightning ribbon caster → target (stun, infect, tracer_round)
 *   shells   lobbed projectiles with particle trails (volley, bile, charges)
 *   dash     a ground dust-wake rushing caster → target (ram)
 *   impact   one-shot burst per target: sparks / debris / smoke / flash /
 *            expanding ground ring, optionally directional or in a root-circle
 *   sustain  timed emitters that keep breathing after the hit (heal motes,
 *            infection cloud, beacon blinks, weld sparks, rage flames…)
 *   shield   a translucent bubble popping over the target (kinetic_shield)
 *
 * Same event contract as AbilityFxLayer — the latest AbilityFx by seq, one
 * cast animated at a time; ids without a recipe fall back to that layer.
 */

/* ====================================================================== */
/* Recipe vocabulary                                                       */
/* ====================================================================== */

type Grad = [string, string, string, string];

interface Palette {
  ring: string;
  shell: THREE.Color;
  sparks: Grad;
  embers: Grad;
  flash: Grad;
}

interface RingSpec {
  grow?: number; // world-units of radius gained over dur (default 0.75)
  dur?: number;
  color?: string;
}

interface ImpactSpec {
  sparks?: number;
  sparkSpeed?: number;
  debris?: number;
  debrisSpeed?: number;
  /** Emit debris from a circle of this radius, thrown up-and-out (roots). */
  debrisRing?: number;
  smoke?: number;
  smokeSize?: number;
  flash?: number; // flash particle size
  ring?: RingSpec;
  /** Throw sparks/debris along the cast direction instead of straight up. */
  directional?: boolean;
}

interface SustainSpec {
  sys: 'motes' | 'embers' | 'sparks' | 'flash' | 'smoke';
  rate: number;
  dur: number;
  delay?: number;
  radius?: number;
  size?: number;
  life?: number;
  speed?: number;
  spread?: number;
}

interface BoltSpec {
  colors: BoltColors;
  travel?: number;
  hold?: number;
  fade?: number;
  /** Uniform overrides on top of DEFAULT_BOLT (uStrands, uSag, uJitter…). */
  set?: Record<string, number>;
}

interface ShellSpec {
  stagger?: number;
  durBase?: number;
  durPerTile?: number;
  arcBase?: number;
  arcPerTile?: number;
  trailRate?: number;
  trailSize?: number;
  scale?: number;
}

interface Recipe {
  palette: Palette;
  bolt?: BoltSpec;
  shells?: ShellSpec;
  dash?: { dur: number; rate: number };
  impact?: ImpactSpec;
  /** Delay between per-target impacts when nothing (shell/bolt) sets timing. */
  impactStagger?: number;
  sustain?: SustainSpec[];
  shield?: boolean;
  casterFlash?: number;
  /** Per-cast gravity overrides (restored to defaults on the next cast). */
  gravity?: { sparks?: [number, number, number]; embers?: [number, number, number]; motes?: [number, number, number] };
  smokeColors?: Grad;
  debrisColors?: Grad;
  motesColors?: Grad;
}

/* ---------------------------------------------------------------------- */
/* Palettes                                                                */
/* ---------------------------------------------------------------------- */

const pal = (
  ring: string,
  shell: [number, number, number],
  sparks: Grad,
  embers: Grad,
  flash: Grad,
): Palette => ({ ring, shell: new THREE.Color(...shell), sparks, embers, flash });

const AMBER = pal('#ffe9a8', [2.4, 2.1, 1.2],
  ['#ffffff', '#ffe9a8', '#ffb84d', '#6b3505'],
  ['#ffffff', '#ffe9a8', '#ffcf5e', '#7a4a10'],
  ['#ffffff', '#fff3c8', '#ffcf5e', '#7a4a10']);
const ARTILLERY = pal('#ffc98a', [2.8, 1.6, 0.7],
  ['#ffffff', '#ffd9a0', '#ff8c3c', '#601c05'],
  ['#fff8e8', '#ffc86b', '#ff7a2a', '#3a1004'],
  ['#ffffff', '#ffe0b0', '#ff9c4d', '#702808']);
const HEAL = pal('#6bffb0', [0.5, 2.4, 1.2],
  ['#ffffff', '#b8ffd8', '#4bdf92', '#0c3a20'],
  ['#ffffff', '#8affc0', '#2fae62', '#0c3a20'],
  ['#ffffff', '#c8ffe0', '#58e89a', '#123a22']);
const CURE = pal('#a8ffd8', [1.2, 2.4, 1.8],
  ['#ffffff', '#d8fff0', '#7ae8c0', '#123a2c'],
  ['#ffffff', '#c0ffe4', '#66d8a8', '#123a2c'],
  ['#ffffff', '#e0fff2', '#88e8c2', '#16402e']);
const REPAIR = pal('#ffd898', [2.4, 1.7, 0.7],
  ['#ffffff', '#ffe0a8', '#ffa84d', '#4a2405'],
  ['#ffffff', '#ffd898', '#e8963a', '#4a2405'],
  ['#ffffff', '#ffe8c0', '#ffb45e', '#4a2808']);
const VENOM = pal('#c990ff', [1.7, 0.9, 2.6],
  ['#ffffff', '#e0c0ff', '#a05ae8', '#2a0c4a'],
  ['#f0e0ff', '#c990ff', '#8a3ae0', '#1c0838'],
  ['#ffffff', '#e8d0ff', '#b26bff', '#320a55']);
const BILE = pal('#a8ff5e', [1.4, 2.6, 0.5],
  ['#ffffff', '#d8ffa0', '#8ae03a', '#1c3a05'],
  ['#f4ffd8', '#b8ff6b', '#6bc22a', '#143002'],
  ['#ffffff', '#e4ffb8', '#9aE84d', '#1e3a06']);
const DUST = pal('#d8b98a', [2.0, 1.6, 1.0],
  ['#fff4e0', '#e8c898', '#a8845a', '#33220e'],
  ['#f8ead0', '#d8b98a', '#966b40', '#2a1c0c'],
  ['#fff8ec', '#ecd0a0', '#b8905e', '#33220e']);
const STEEL = pal('#9fd8ff', [1.2, 2.0, 2.8],
  ['#ffffff', '#d0ecff', '#6bb8f0', '#0c2a4a'],
  ['#ffffff', '#c0e4ff', '#58a8e8', '#0c2a4a'],
  ['#ffffff', '#e0f2ff', '#88c8f8', '#103252']);
const RAGE = pal('#ff6b50', [2.8, 0.9, 0.6],
  ['#ffffff', '#ffc0a0', '#ff5a2a', '#4a0c05'],
  ['#fff0e0', '#ff9a6b', '#f03a1a', '#3a0802'],
  ['#ffffff', '#ffd0b8', '#ff7a4d', '#521005']);
const LEAF = pal('#8ad98a', [0.9, 2.2, 0.9],
  ['#ffffff', '#d0ffd0', '#5ec25e', '#0c300c'],
  ['#f0fff0', '#a8e8a8', '#4aa84a', '#0c300c'],
  ['#ffffff', '#dcffdc', '#6bd96b', '#103410']);
const MARK = pal('#ffd98a', [2.6, 1.9, 0.8],
  ['#ffffff', '#ffe8b0', '#ffb84d', '#5a2c08'],
  ['#ffffff', '#ffe0a0', '#ffc058', '#5a2c08'],
  ['#ffffff', '#fff0c8', '#ffcf6b', '#5a2c08']);
const FUSE = pal('#ff9a5e', [2.8, 1.2, 0.5],
  ['#ffffff', '#ffcfa0', '#ff7a2a', '#4a1405'],
  ['#fff4e8', '#ffb87a', '#f0621a', '#3a1002'],
  ['#ffffff', '#ffd8b8', '#ff8c3c', '#521805']);

const DUST_SMOKE: Grad = ['#b89a72', '#967a54', '#6b563c', '#332818'];
const STEAM_SMOKE: Grad = ['#e8eef2', '#c0ccd4', '#8a96a0', '#3c444c'];
const BILE_SMOKE: Grad = ['#9ac25e', '#78a83e', '#4a7020', '#1c3008'];
const VEIL_SMOKE: Grad = ['#a8d8a8', '#78b878', '#4a8a4a', '#183418'];
const VENOM_SMOKE: Grad = ['#b090cc', '#8a62b0', '#5a3a80', '#241040'];
const GOO_DEBRIS: Grad = ['#c2e880', '#8ab84a', '#4f7a24', '#22380c'];
const ROOT_DEBRIS: Grad = ['#a8c27a', '#7a8a4a', '#54502e', '#28251a'];

/* ---------------------------------------------------------------------- */
/* The recipe per ability id                                               */
/* ---------------------------------------------------------------------- */

const STUN_BOLT: BoltColors = { core: '#ffffff', inner: '#fff3c0', outer: '#ffcf5e', halo: '#b06a10' };

const RECIPES: Record<string, Recipe> = {
  /* ---- bolts ---- */
  // Wraith stun: the flagship storm arc.
  stun: {
    palette: AMBER,
    bolt: { colors: STUN_BOLT },
    impact: { sparks: 20, ring: { grow: 0.75 }, flash: 0.35 },
    casterFlash: 0.24,
  },
  // Seercaust infect: a sickly violet filament that droops mid-flight and
  // leaves an infection cloud crawling over the victim.
  infect: {
    palette: VENOM,
    bolt: {
      colors: { core: '#ffffff', inner: '#e8d0ff', outer: '#a34de8', halo: '#3a0a66' },
      travel: 0.12, hold: 0.26, fade: 0.35,
      set: { uStrands: 5, uJitter: 0.07, uSag: -0.07, uCrawl: 1.4, uWidth: 0.021, uRestrike: 12 },
    },
    impact: { flash: 0.3, ring: { grow: 0.55, dur: 0.6 } },
    sustain: [{ sys: 'motes', rate: 55, dur: 0.85, radius: 0.2, size: 0.055, life: 0.9 }],
    motesColors: ['#e8d0ff', '#b26bff', '#6a2ab8', '#1c0838'],
    gravity: { motes: [0, 0.5, 0] },
    casterFlash: 0.2,
  },
  // Medic tracer round: a near-straight hot wire, then a marker pulsing on
  // the target so the whole squad can see what's been painted.
  tracer_round: {
    palette: MARK,
    bolt: {
      colors: { core: '#ffffff', inner: '#ffedc0', outer: '#ff9a3c', halo: '#8a3505' },
      travel: 0.05, hold: 0.1, fade: 0.14,
      set: { uStrands: 2, uJitter: 0.015, uJitterScale: 1.0, uSpread: 0.01, uWidth: 0.014, uRestrike: 60, uGlow: 2.6 },
    },
    impact: { flash: 0.22, sparks: 8, sparkSpeed: 1.4 },
    sustain: [{ sys: 'flash', rate: 4, dur: 1.2, delay: 0.1, size: 0.09, life: 0.16 }],
    casterFlash: 0.18,
  },

  /* ---- artillery ---- */
  ballistic_volley: {
    palette: ARTILLERY,
    shells: {},
    impact: { sparks: 24, debris: 12, smoke: 9, flash: 0.4, ring: { grow: 0.9 } },
  },
  percussive_shells: {
    palette: ARTILLERY,
    shells: {},
    impact: { sparks: 24, debris: 12, smoke: 10, flash: 0.42, ring: { grow: 1.0 } },
  },
  // Burstling self destruct: everything at once, at home.
  self_destruct: {
    palette: ARTILLERY,
    impact: { sparks: 38, debris: 20, smoke: 14, flash: 0.65, ring: { grow: 1.5, dur: 0.55 } },
  },
  // Seercaust spray bile: a fat dripping glob, a goo splash, then the pool
  // keeps bubbling (the persistent tile wash is BileOverlay's job).
  spray_bile: {
    palette: BILE,
    shells: { arcBase: 0.68, durBase: 0.4, trailRate: 140, trailSize: 0.055, scale: 1.5 },
    impact: { debris: 10, debrisSpeed: 1.6, smoke: 8, flash: 0.3, ring: { grow: 0.85 } },
    sustain: [{ sys: 'motes', rate: 45, dur: 1.0, radius: 0.3, size: 0.06, life: 0.7, speed: 0.35 }],
    smokeColors: BILE_SMOKE,
    debrisColors: GOO_DEBRIS,
    motesColors: ['#e4ffb8', '#a8ff5e', '#5a9a20', '#143002'],
    gravity: { embers: [0, -3.2, 0], motes: [0, 0.6, 0] },
  },
  // Wraith plant explosives: a small tossed charge, then a red arming
  // beacon blinking on the victim until it goes off (2 turns later).
  plant_explosives: {
    palette: FUSE,
    shells: { arcBase: 0.42, durBase: 0.3, trailRate: 40, trailSize: 0.03, scale: 0.7 },
    impact: { flash: 0.18, ring: { grow: 0.35, dur: 0.4 } },
    sustain: [{ sys: 'flash', rate: 3.5, dur: 1.6, delay: 0.15, size: 0.1, life: 0.18 }],
  },

  /* ---- melee / ground ---- */
  // Vindrace ram: a dust wake rushing the gap, then rubble thrown FORWARD —
  // the whole point of the ability is the shove.
  ram: {
    palette: DUST,
    dash: { dur: 0.18, rate: 170 },
    impact: { directional: true, sparks: 10, debris: 14, smoke: 8, flash: 0.35, ring: { grow: 0.8, dur: 0.45 } },
    smokeColors: DUST_SMOKE,
    casterFlash: 0.16,
  },
  // Wyrm burrow / erupt: the ground swallows it / gives it back.
  burrow: {
    palette: DUST,
    impact: { debris: 16, smoke: 12, flash: 0.2, ring: { grow: 0.6, dur: 0.5 } },
    smokeColors: DUST_SMOKE,
  },
  erupt: {
    palette: DUST,
    impact: { debris: 22, debrisSpeed: 2.8, smoke: 16, sparks: 8, flash: 0.4, ring: { grow: 1.1, dur: 0.55 } },
    smokeColors: DUST_SMOKE,
  },
  // Twin-strike pseudo-ability: two quick sand geysers.
  wyrm_strike: {
    palette: DUST,
    impact: { debris: 14, smoke: 8, flash: 0.28, ring: { grow: 0.7, dur: 0.45 } },
    impactStagger: 0.16,
    smokeColors: DUST_SMOKE,
  },
  // Sylvan treant entangle: roots punch out of a circle around it.
  entangle: {
    palette: LEAF,
    impact: { debrisRing: 0.38, debris: 18, smoke: 6, flash: 0.28, ring: { grow: 0.9, dur: 0.7, color: '#7ae87a' } },
    sustain: [{ sys: 'motes', rate: 35, dur: 0.7, radius: 0.35, size: 0.05, life: 0.8 }],
    smokeColors: VEIL_SMOKE,
    debrisColors: ROOT_DEBRIS,
    motesColors: ['#dcffdc', '#8ad98a', '#3a8a3a', '#0c300c'],
  },

  /* ---- self buffs / morphs ---- */
  // Tank assault mode: welding light, venting steam — machinery changing shape.
  assault_mode: {
    palette: STEEL,
    impact: { sparks: 22, sparkSpeed: 1.6, smoke: 10, flash: 0.4, ring: { grow: 0.9 } },
    smokeColors: STEAM_SMOKE,
  },
  // Berserker rage: fire climbs OUT of it.
  rage: {
    palette: RAGE,
    impact: { sparks: 14, flash: 0.45, ring: { grow: 0.8 } },
    sustain: [{ sys: 'embers', rate: 70, dur: 0.7, radius: 0.16, size: 0.05, life: 0.55, speed: 0.5 }],
    gravity: { sparks: [0, 1.5, 0], embers: [0, 1.8, 0] },
  },
  // Sylvan ranger camouflage: a green veil settles over it, motes drift DOWN.
  camouflage: {
    palette: LEAF,
    impact: { smoke: 12, smokeSize: 0.2, flash: 0.15, ring: { grow: 0.6, dur: 0.8 } },
    sustain: [{ sys: 'motes', rate: 50, dur: 0.8, radius: 0.3, size: 0.045, life: 0.9, speed: 0.3 }],
    smokeColors: VEIL_SMOKE,
    motesColors: ['#dcffdc', '#a8e8a8', '#4a9a4a', '#0c300c'],
    gravity: { motes: [0, -0.9, 0] },
  },

  /* ---- support ---- */
  heal_1: {
    palette: HEAL,
    impact: { flash: 0.22, ring: { grow: 0.45, dur: 0.7 } },
    sustain: [{ sys: 'motes', rate: 60, dur: 0.55, radius: 0.24, size: 0.05, life: 0.8 }],
    impactStagger: 0.12,
  },
  heal_2: {
    palette: HEAL,
    impact: { flash: 0.22, ring: { grow: 0.45, dur: 0.7 } },
    sustain: [{ sys: 'motes', rate: 60, dur: 0.55, radius: 0.24, size: 0.05, life: 0.8 }],
    impactStagger: 0.12,
  },
  cure: {
    palette: CURE,
    impact: { flash: 0.22, ring: { grow: 0.5, dur: 0.7 } },
    sustain: [{ sys: 'motes', rate: 55, dur: 0.6, radius: 0.26, size: 0.05, life: 0.8 }],
    impactStagger: 0.12,
  },
  // Repairs read mechanical: heal motes plus little weld sparks.
  repair_1: {
    palette: REPAIR,
    impact: { flash: 0.22, ring: { grow: 0.45, dur: 0.7 } },
    sustain: [
      { sys: 'motes', rate: 45, dur: 0.55, radius: 0.24, size: 0.05, life: 0.8 },
      { sys: 'sparks', rate: 16, dur: 0.45, radius: 0.12, size: 0.035, life: 0.35, speed: 0.9 },
    ],
    impactStagger: 0.12,
  },
  repair_2: {
    palette: REPAIR,
    impact: { flash: 0.22, ring: { grow: 0.5, dur: 0.7 } },
    sustain: [
      { sys: 'motes', rate: 55, dur: 0.6, radius: 0.26, size: 0.05, life: 0.8 },
      { sys: 'sparks', rate: 20, dur: 0.5, radius: 0.12, size: 0.035, life: 0.35, speed: 0.9 },
    ],
    impactStagger: 0.12,
  },
  // Engineer build node: scaffolding light — slow ring, climbing motes,
  // intermittent weld sparks.
  build_node: {
    palette: REPAIR,
    impact: { flash: 0.2, ring: { grow: 0.5, dur: 0.8 } },
    sustain: [
      { sys: 'sparks', rate: 26, dur: 0.9, radius: 0.16, size: 0.035, life: 0.4, speed: 0.9 },
      { sys: 'motes', rate: 30, dur: 0.9, radius: 0.2, size: 0.05, life: 0.9 },
    ],
    motesColors: ['#ffffff', '#ffd898', '#c8863a', '#4a2405'],
  },
  // Sentinel kinetic shield: a bubble pops over the ally.
  kinetic_shield: {
    palette: STEEL,
    shield: true,
    impact: { flash: 0.3, sparks: 12, sparkSpeed: 1.2, ring: { grow: 0.6, dur: 0.6 } },
    sustain: [{ sys: 'motes', rate: 40, dur: 0.4, radius: 0.28, size: 0.045, life: 0.6 }],
    motesColors: ['#ffffff', '#c0e4ff', '#58a8e8', '#0c2a4a'],
    gravity: { sparks: [0, 0.8, 0], motes: [0, 1.1, 0] },
  },
};

export const UPGRADED_CAST_IDS = new Set(Object.keys(RECIPES));

/**
 * When does this cast's impact land on `target`? Mirrors the recipe timing the
 * VFX layer uses, so death animations can hold the corpse until the hit
 * actually arrives (index = target's position in the cast's target list).
 */
export function abilityImpactDelay(
  abilityId: string,
  casterPos: { x: number; y: number },
  target: { x: number; y: number },
  index = 0,
): number {
  const r = RECIPES[abilityId];
  if (!r) return 0;
  if (r.shells) {
    const sh = r.shells;
    const dist = Math.hypot(target.x - casterPos.x, target.y - casterPos.y);
    return index * (sh.stagger ?? SHELL_STAGGER) + (sh.durBase ?? 0.32) + dist * (sh.durPerTile ?? 0.05);
  }
  if (r.bolt) return r.bolt.travel ?? BOLT_TRAVEL;
  if (r.dash) return r.dash.dur;
  return index * (r.impactStagger ?? 0.12);
}

/* ====================================================================== */
/* Timings and defaults                                                    */
/* ====================================================================== */

const MAX_TARGETS = 4;
const BOLT_TRAVEL = 0.09;
const BOLT_HOLD = 0.32;
const BOLT_FADE = 0.4;
const RING_DUR = 0.5;
const SHELL_STAGGER = 0.13;

const DEFAULT_BOLT: Record<string, number> = {
  uStrands: MAX_STRANDS,
  uSag: 0.1,
  uJitter: 0.11,
  uJitterScale: 3.2,
  uCrawl: 3.2,
  uSpread: 0.14,
  uWidth: 0.026,
  uRestrike: 24,
  uGlow: 2.3,
};

const DEFAULT_SMOKE: Grad = ['#8a8a92', '#6a6a72', '#4a4a52', '#26262c'];
const DEFAULT_DEBRIS: Grad = ['#c9b8a8', '#8a7a6a', '#4a4038', '#26201a'];
const G_SPARKS: [number, number, number] = [0, -6, 0];
const G_EMBERS: [number, number, number] = [0, -1.2, 0];
const G_MOTES: [number, number, number] = [0, 0.85, 0];

interface Shell {
  from: THREE.Vector3;
  to: THREE.Vector3;
  delay: number;
  dur: number;
  arc: number;
  trail: RateEmitter;
}

interface Impact {
  at: THREE.Vector3;
  delay: number;
  fired: boolean;
}

interface Sustain {
  spec: SustainSpec;
  at: THREE.Vector3;
  delay: number;
  emitter: RateEmitter;
}

function easeInCubic(t: number) {
  return t * t * t;
}

const _emit: Partial<EmitParams> & { position: THREE.Vector3; time: number } = {
  position: new THREE.Vector3(),
  time: 0,
};
const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Dev harness, inert in normal play. `?fxtest=1` exposes
 * `window.__fxcast(abilityId, targets?, caster?)` in the console to fire any
 * cast at chosen tiles; `?fxtest=auto` additionally cycles through every
 * recipe on a timer. Lets the effects be eyeballed and tuned without playing
 * a game to the units that own them.
 */
function useFxDemo(): AbilityFx | null {
  const mode = React.useMemo(
    () => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('fxtest') : null),
    [],
  );
  const [fx, setFx] = React.useState<AbilityFx | null>(null);
  React.useEffect(() => {
    if (!mode) return;
    let seq = 0;
    const cast = (
      id: string,
      targets: { x: number; y: number }[] = [{ x: 7, y: 5 }],
      caster: { x: number; y: number } = { x: 4, y: 4 },
    ) => setFx({ seq: 1e6 + ++seq, abilityId: id, unitId: -1, casterPos: caster, targets });
    (window as unknown as { __fxcast?: typeof cast }).__fxcast = cast;

    let timer: ReturnType<typeof setInterval> | undefined;
    if (mode === 'auto') {
      const selfIds = ['self_destruct', 'burrow', 'erupt', 'assault_mode', 'rage', 'camouflage', 'entangle'];
      const casts = Object.keys(RECIPES).map(id => ({
        id,
        targets:
          id === 'ballistic_volley' || id === 'percussive_shells'
            ? [{ x: 6, y: 6 }, { x: 7, y: 6 }, { x: 6, y: 7 }, { x: 7, y: 7 }]
            : id === 'wyrm_strike'
              ? [{ x: 5, y: 4 }, { x: 6, y: 4 }]
              : id === 'ram'
                ? [{ x: 5, y: 4 }]
                : selfIds.includes(id)
                  ? []
                  : [{ x: 7, y: 5 }],
      }));
      let i = 0;
      timer = setInterval(() => {
        const c = casts[i++ % casts.length];
        cast(c.id, c.targets);
      }, 1900);
    }
    return () => {
      if (timer) clearInterval(timer);
      delete (window as unknown as { __fxcast?: typeof cast }).__fxcast;
    };
  }, [mode]);
  return mode ? fx : null;
}

/* ====================================================================== */
/* Component                                                               */
/* ====================================================================== */

export function AbilityVfx({ ability: abilityProp, units }: { ability?: AbilityFx | null; units: UnitView[] }) {
  const unitsRef = React.useRef(units);
  unitsRef.current = units;
  const demoFx = useFxDemo();
  const ability = demoFx ?? abilityProp;

  /* ---------------- shared particle systems ---------------- */
  const systems = React.useMemo(() => {
    const sparks = new ParticleSystem({ name: 'fx.sparks', capacity: 1500, shape: ParticleShape.STREAK, additive: true, stretch: true });
    sparks.uniforms.uDrag.value = 1.4;
    sparks.uniforms.uEndSize.value = 0.25;
    sparks.uniforms.uSizeIn.value = 0.02;
    sparks.uniforms.uFadeIn.value = 0.03;
    sparks.uniforms.uFadeOut.value = 0.45;
    sparks.uniforms.uStretch.value = 0.35;
    sparks.uniforms.uGlow.value = 2.0;
    sparks.uniforms.uTurbulence.value = 0.1;

    const embers = new ParticleSystem({ name: 'fx.embers', capacity: 1500, shape: ParticleShape.SOFT, additive: true });
    embers.uniforms.uDrag.value = 2.0;
    embers.uniforms.uEndSize.value = 0.3;
    embers.uniforms.uFadeOut.value = 0.5;
    embers.uniforms.uGlow.value = 1.8;
    embers.uniforms.uTurbulence.value = 0.15;

    const smoke = new ParticleSystem({ name: 'fx.smoke', capacity: 600, shape: ParticleShape.SMOKE, additive: false, curl: true });
    smoke.uniforms.uGravity.value.set(0, 0.55, 0);
    smoke.uniforms.uDrag.value = 1.8;
    smoke.uniforms.uEndSize.value = 3.2;
    smoke.uniforms.uSizeIn.value = 0.12;
    smoke.uniforms.uFadeIn.value = 0.14;
    smoke.uniforms.uFadeOut.value = 0.35;
    smoke.uniforms.uOpacity.value = 0.5;
    smoke.uniforms.uGlow.value = 1;
    smoke.uniforms.uTurbulence.value = 0.25;

    const debris = new ParticleSystem({ name: 'fx.debris', capacity: 600, shape: ParticleShape.CHIP, additive: false });
    debris.uniforms.uGravity.value.set(0, -9, 0);
    debris.uniforms.uDrag.value = 0.3;
    debris.uniforms.uEndSize.value = 0.8;
    debris.uniforms.uFadeOut.value = 0.75;
    debris.uniforms.uGlow.value = 1;
    debris.uniforms.uTurbulence.value = 0;

    const motes = new ParticleSystem({ name: 'fx.motes', capacity: 800, shape: ParticleShape.SOFT, additive: true, curl: true });
    motes.uniforms.uDrag.value = 1.6;
    motes.uniforms.uEndSize.value = 0.2;
    motes.uniforms.uSizeIn.value = 0.1;
    motes.uniforms.uFadeIn.value = 0.12;
    motes.uniforms.uFadeOut.value = 0.5;
    motes.uniforms.uGlow.value = 1.6;
    motes.uniforms.uTurbulence.value = 0.3;

    const flash = new ParticleSystem({ name: 'fx.flash', capacity: 32, shape: ParticleShape.SOFT, additive: true });
    flash.uniforms.uGravity.value.set(0, 0, 0);
    flash.uniforms.uDrag.value = 3;
    flash.uniforms.uEndSize.value = 2.4;
    flash.uniforms.uSizeIn.value = 0.01;
    flash.uniforms.uFadeIn.value = 0.02;
    flash.uniforms.uFadeOut.value = 0.25;
    flash.uniforms.uGlow.value = 2.2;
    flash.uniforms.uTurbulence.value = 0;

    return { sparks, embers, smoke, debris, motes, flash };
  }, []);
  const systemsList = React.useMemo(() => Object.values(systems), [systems]);
  React.useEffect(() => () => systemsList.forEach(s => s.dispose()), [systemsList]);

  /* ---------------- lightning bolt (two passes, one geometry) ---------------- */
  const boltGeom = React.useMemo(() => createBoltRibbonGeometry(), []);
  const boltMats = React.useMemo(
    () => [
      createLightningMaterial(BoltPass.GLOW, STUN_BOLT),
      createLightningMaterial(BoltPass.CORE, STUN_BOLT),
    ],
    [],
  );
  React.useEffect(() => () => {
    boltGeom.dispose();
    boltMats.forEach(m => m.dispose());
  }, [boltGeom, boltMats]);
  const boltRefs = React.useRef<(THREE.Mesh | null)[]>([]);

  /* ---------------- pooled impact rings, shells, shield ---------------- */
  const ringMats = React.useMemo(
    () => Array.from({ length: MAX_TARGETS }, () =>
      new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      })),
    [],
  );
  const shellMat = React.useMemo(
    () => new THREE.MeshBasicMaterial({ toneMapped: false }),
    [],
  );
  const shieldMat = React.useMemo(
    () => new THREE.MeshBasicMaterial({
      color: '#9fd8ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }),
    [],
  );
  React.useEffect(() => () => {
    ringMats.forEach(m => m.dispose());
    shellMat.dispose();
    shieldMat.dispose();
  }, [ringMats, shellMat, shieldMat]);
  const ringRefs = React.useRef<(THREE.Mesh | null)[]>([]);
  const shellRefs = React.useRef<(THREE.Mesh | null)[]>([]);
  const shieldRef = React.useRef<THREE.Mesh | null>(null);

  /* ---------------- cast state (armed in render, driven in useFrame) ---------------- */
  const stateRef = React.useRef({
    seq: -1,
    start: -1,
    recipe: null as Recipe | null,
    boltFrom: new THREE.Vector3(),
    boltTo: new THREE.Vector3(),
    boltSide: new THREE.Vector3(1, 0, 0),
    boltSeed: 0,
    boltStrands: MAX_STRANDS,
    boltTravel: BOLT_TRAVEL,
    boltHold: BOLT_HOLD,
    boltFade: BOLT_FADE,
    boltSparks: new RateEmitter(),
    castFrom: new THREE.Vector3(), // caster, on the ground
    castDir: new THREE.Vector3(0, 0, 1),
    dashTo: new THREE.Vector3(),
    dashEmitter: new RateEmitter(),
    shells: [] as Shell[],
    impacts: [] as Impact[],
    sustains: [] as Sustain[],
    shieldAt: null as THREE.Vector3 | null,
    shieldDelay: 0,
  });
  const s = stateRef.current;

  if (ability && ability.seq !== s.seq) {
    s.seq = ability.seq;
    const recipe = RECIPES[ability.abilityId] ?? null;
    s.recipe = recipe;
    if (recipe) {
      const caster = unitsRef.current.find(u => u.id === ability.unitId);
      const casterElev = caster?.elevation ?? 0;
      const muzzle = new THREE.Vector3(
        ability.casterPos.x + 0.5,
        0.5 + casterElev,
        ability.casterPos.y + 0.5,
      );
      s.castFrom.set(ability.casterPos.x + 0.5, 0.06 + casterElev, ability.casterPos.y + 0.5);
      const rawTargets = ability.targets.filter(t => t != null);
      const targets = (rawTargets.length ? rawTargets : [ability.casterPos]).slice(0, MAX_TARGETS);
      const targetY = (t: { x: number; y: number }) => {
        const u = unitsRef.current.find(v => v.gridPos.x === t.x && v.gridPos.y === t.y);
        return u?.elevation ?? 0;
      };
      const groundAt = (t: { x: number; y: number }) =>
        new THREE.Vector3(t.x + 0.5, 0.03 + targetY(t), t.y + 0.5);

      const t0 = targets[0];
      s.castDir.set(t0.x + 0.5, 0, t0.y + 0.5).sub(_pos.set(muzzle.x, 0, muzzle.z));
      if (s.castDir.lengthSq() < 1e-6) s.castDir.set(0, 0, 1);
      else s.castDir.normalize();

      s.shells = [];
      s.impacts = [];
      s.sustains = [];
      s.shieldAt = null;
      s.boltSparks.reset();
      s.dashEmitter.reset();

      /* bolt (single target) */
      if (recipe.bolt) {
        s.boltFrom.copy(muzzle);
        s.boltTo.set(t0.x + 0.5, 0.35 + targetY(t0), t0.y + 0.5);
        s.boltSide.crossVectors(s.castDir, _up).normalize();
        s.boltSeed = Math.random() * 100;
        s.boltTravel = recipe.bolt.travel ?? BOLT_TRAVEL;
        s.boltHold = recipe.bolt.hold ?? BOLT_HOLD;
        s.boltFade = recipe.bolt.fade ?? BOLT_FADE;
        s.boltStrands = Math.min(MAX_STRANDS, recipe.bolt.set?.uStrands ?? DEFAULT_BOLT.uStrands);
      }

      /* dash (ram) */
      if (recipe.dash) s.dashTo.copy(groundAt(t0));

      /* shells + impacts + sustains per target */
      targets.forEach((t, i) => {
        const at = groundAt(t);
        let impactDelay: number;
        if (recipe.shells) {
          const sh = recipe.shells;
          const delay = i * (sh.stagger ?? SHELL_STAGGER);
          const dist = Math.hypot(at.x - muzzle.x, at.z - muzzle.z);
          const dur = (sh.durBase ?? 0.32) + dist * (sh.durPerTile ?? 0.05);
          s.shells.push({
            from: muzzle.clone(),
            to: at.clone().setY(at.y + 0.05),
            delay,
            dur,
            arc: (sh.arcBase ?? 0.5) + dist * (sh.arcPerTile ?? 0.12),
            trail: new RateEmitter(),
          });
          impactDelay = delay + dur;
        } else if (recipe.bolt) {
          impactDelay = s.boltTravel;
        } else if (recipe.dash) {
          impactDelay = recipe.dash.dur;
        } else {
          impactDelay = i * (recipe.impactStagger ?? 0.12);
        }
        s.impacts.push({ at, delay: impactDelay, fired: false });
        for (const spec of recipe.sustain ?? []) {
          s.sustains.push({ spec, at, delay: impactDelay + (spec.delay ?? 0), emitter: new RateEmitter() });
        }
        if (recipe.shield && i === 0) {
          s.shieldAt = at.clone().setY(at.y + 0.32);
          s.shieldDelay = impactDelay;
        }
      });
      s.start = -2;
    }
  }

  /* ---------------- one-shot impact bursts ---------------- */
  const fireImpact = (imp: Impact, time: number) => {
    const recipe = s.recipe;
    if (!recipe?.impact) return;
    const spec = recipe.impact;
    _emit.time = time;

    if (spec.flash) {
      _emit.position.copy(imp.at).setY(imp.at.y + 0.18);
      _emit.radius = 0.02;
      _emit.direction = null;
      _emit.speed = 0.1;
      _emit.spread = 1;
      _emit.size = spec.flash;
      _emit.sizeVariance = 0.2;
      _emit.life = 0.16;
      _emit.lifeVariance = 0.2;
      _emit.spin = 0;
      _emit.tint = null;
      systems.flash.emit(1, _emit as EmitParams);
    }

    if (spec.sparks) {
      _emit.position.copy(imp.at).setY(imp.at.y + 0.06);
      _emit.radius = 0.08;
      _emit.direction = spec.directional
        ? _dir.copy(s.castDir).multiplyScalar(0.7).setY(0.55).normalize()
        : _dir.set(0, 1, 0);
      _emit.speed = spec.sparkSpeed ?? 2.2;
      _emit.speedVariance = 0.8;
      _emit.spread = spec.directional ? 0.5 : 0.85;
      _emit.size = 0.05;
      _emit.sizeVariance = 0.6;
      _emit.life = 0.5;
      _emit.lifeVariance = 0.5;
      _emit.spin = 0;
      systems.sparks.emit(spec.sparks, _emit as EmitParams);
    }

    if (spec.debris) {
      _emit.speed = spec.debrisSpeed ?? 2.4;
      _emit.speedVariance = 0.75;
      _emit.size = 0.055;
      _emit.sizeVariance = 0.7;
      _emit.life = 0.7;
      _emit.lifeVariance = 0.4;
      _emit.spin = 9;
      if (spec.debrisRing) {
        // Roots: debris erupts from a circle, thrown up-and-out.
        const n = spec.debris;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + Math.random() * 0.6;
          const cx = Math.cos(a);
          const cz = Math.sin(a);
          _emit.position.set(imp.at.x + cx * spec.debrisRing, imp.at.y + 0.02, imp.at.z + cz * spec.debrisRing);
          _emit.radius = 0.04;
          _emit.direction = _dir.set(cx * 0.45, 1, cz * 0.45).normalize();
          _emit.spread = 0.3;
          systems.debris.emit(1, _emit as EmitParams);
        }
      } else {
        _emit.position.copy(imp.at).setY(imp.at.y + 0.04);
        _emit.radius = 0.08;
        _emit.direction = spec.directional
          ? _dir.copy(s.castDir).multiplyScalar(0.6).setY(0.8).normalize()
          : _dir.set(0, 1, 0);
        _emit.spread = spec.directional ? 0.45 : 0.7;
        systems.debris.emit(spec.debris, _emit as EmitParams);
      }
    }

    if (spec.smoke) {
      _emit.position.copy(imp.at).setY(imp.at.y + 0.08);
      _emit.radius = 0.14;
      _emit.direction = _dir.set(0, 1, 0);
      _emit.speed = 0.9;
      _emit.speedVariance = 0.6;
      _emit.spread = 0.9;
      _emit.size = spec.smokeSize ?? 0.24;
      _emit.sizeVariance = 0.5;
      _emit.life = 0.9;
      _emit.lifeVariance = 0.4;
      _emit.spin = 0.5;
      systems.smoke.emit(spec.smoke, _emit as EmitParams);
    }
  };

  /** Drive one sustained emitter for this frame. */
  const driveSustain = (su: Sustain, dt: number, time: number) => {
    const n = su.emitter.tick(dt, su.spec.rate);
    if (n <= 0) return;
    const spec = su.spec;
    _emit.time = time;
    _emit.position.copy(su.at).setY(su.at.y + 0.08);
    _emit.radius = spec.radius ?? 0.2;
    _emit.direction = _dir.set(0, 1, 0);
    _emit.speed = spec.speed ?? (spec.sys === 'sparks' ? 0.9 : spec.sys === 'flash' ? 0.05 : 0.5);
    _emit.speedVariance = 0.5;
    _emit.spread = spec.spread ?? (spec.sys === 'sparks' ? 0.8 : 0.35);
    _emit.size = spec.size ?? 0.05;
    _emit.sizeVariance = 0.4;
    _emit.life = spec.life ?? 0.8;
    _emit.lifeVariance = 0.35;
    _emit.spin = 0;
    _emit.tint = null;
    systems[spec.sys].emit(n, _emit as EmitParams);
  };

  /* ---------------- frame drive ---------------- */
  useFrame(({ clock }, dt) => {
    const time = clock.elapsedTime;
    for (const sys of systemsList) sys.uniforms.uTime.value = time;
    for (const m of boltMats) m.uniforms.uTime.value = time;

    const recipe = s.recipe;

    if (s.start === -2 && recipe) {
      s.start = time;
      const p = recipe.palette;

      /* stamp everything this cast owns — and restore what the last one bent */
      shellMat.color.copy(p.shell);
      ringMats.forEach(m => m.color.set(recipe.impact?.ring?.color ?? p.ring));
      shieldMat.color.set(p.ring);
      systems.sparks.setGradient(...p.sparks);
      systems.embers.setGradient(...p.embers);
      systems.flash.setGradient(...p.flash);
      systems.smoke.setGradient(...(recipe.smokeColors ?? DEFAULT_SMOKE));
      systems.debris.setGradient(...(recipe.debrisColors ?? DEFAULT_DEBRIS));
      systems.motes.setGradient(...(recipe.motesColors ?? p.embers));
      (systems.sparks.uniforms.uGravity.value as THREE.Vector3).fromArray(recipe.gravity?.sparks ?? G_SPARKS);
      (systems.embers.uniforms.uGravity.value as THREE.Vector3).fromArray(recipe.gravity?.embers ?? G_EMBERS);
      (systems.motes.uniforms.uGravity.value as THREE.Vector3).fromArray(recipe.gravity?.motes ?? G_MOTES);

      if (recipe.bolt) {
        for (const m of boltMats) {
          const u = m.uniforms;
          for (const [key, value] of Object.entries({ ...DEFAULT_BOLT, ...recipe.bolt.set })) {
            if (u[key]) u[key].value = value;
          }
          (u.uColorCore.value as THREE.Color).set(recipe.bolt.colors.core);
          (u.uColorInner.value as THREE.Color).set(recipe.bolt.colors.inner);
          (u.uColorOuter.value as THREE.Color).set(recipe.bolt.colors.outer);
          (u.uColorHalo.value as THREE.Color).set(recipe.bolt.colors.halo);
        }
      }

      const shellScale = recipe.shells?.scale ?? 1;
      for (const mesh of shellRefs.current) mesh?.scale.setScalar(shellScale);

      if (recipe.casterFlash) {
        _emit.time = time;
        _emit.position.copy(s.castFrom).setY(s.castFrom.y + 0.4);
        _emit.radius = 0.02;
        _emit.direction = null;
        _emit.speed = 0.1;
        _emit.spread = 1;
        _emit.size = recipe.casterFlash;
        _emit.sizeVariance = 0.2;
        _emit.life = 0.14;
        _emit.lifeVariance = 0.2;
        _emit.spin = 0;
        _emit.tint = null;
        systems.flash.emit(1, _emit as EmitParams);
      }
    }
    const el = s.start >= 0 && recipe ? time - s.start : -1;

    /* ---- bolt ---- */
    const boltActive = !!recipe?.bolt && el >= 0 && el <= s.boltTravel + s.boltHold + s.boltFade;
    for (const mesh of boltRefs.current) {
      if (mesh) mesh.visible = boltActive;
    }
    if (recipe?.bolt && boltActive) {
      const progress = Math.min(1, el / s.boltTravel);
      const holdEnd = s.boltTravel + s.boltHold;
      const fade = el <= holdEnd ? 1 : 1 - easeInCubic(Math.min(1, (el - holdEnd) / s.boltFade));
      boltGeom.instanceCount = s.boltStrands;
      for (const m of boltMats) {
        const u = m.uniforms;
        (u.uOrigin.value as THREE.Vector3).copy(s.boltFrom);
        (u.uTarget.value as THREE.Vector3).copy(s.boltTo);
        (u.uSide.value as THREE.Vector3).copy(s.boltSide);
        u.uSeed.value = s.boltSeed;
        u.uStrands.value = s.boltStrands;
        u.uProgress.value = progress;
        u.uFade.value = Math.max(0, fade);
      }
      // sparks shed along the drawn part of the bolt
      const n = s.boltSparks.tick(dt, 70 * fade);
      if (n > 0) {
        _emit.time = time;
        const at = Math.random() * progress;
        _pos.lerpVectors(s.boltFrom, s.boltTo, at);
        _pos.y += 0.08 * Math.sin(at * Math.PI);
        _emit.position.copy(_pos);
        _emit.radius = 0.07;
        _emit.direction = _dir.set(0, 1, 0);
        _emit.speed = 0.8;
        _emit.speedVariance = 0.8;
        _emit.spread = 1;
        _emit.size = 0.04;
        _emit.sizeVariance = 0.6;
        _emit.life = 0.35;
        _emit.lifeVariance = 0.5;
        _emit.spin = 0;
        _emit.tint = null;
        systems.sparks.emit(n, _emit as EmitParams);
      }
    }

    /* ---- dash (ram): dust rushing along the ground ---- */
    if (recipe?.dash && el >= 0 && el <= recipe.dash.dur) {
      const n = s.dashEmitter.tick(dt, recipe.dash.rate);
      if (n > 0) {
        _emit.time = time;
        _pos.lerpVectors(s.castFrom, s.dashTo, el / recipe.dash.dur);
        _emit.position.copy(_pos);
        _emit.radius = 0.08;
        _emit.direction = _dir.set(0, 1, 0);
        _emit.speed = 0.45;
        _emit.speedVariance = 0.6;
        _emit.spread = 0.7;
        _emit.size = 0.14;
        _emit.sizeVariance = 0.5;
        _emit.life = 0.45;
        _emit.lifeVariance = 0.4;
        _emit.spin = 0.6;
        _emit.tint = null;
        systems.smoke.emit(n, _emit as EmitParams);
      }
    }

    /* ---- shells in flight ---- */
    for (let i = 0; i < MAX_TARGETS; i++) {
      const mesh = shellRefs.current[i];
      if (!mesh) continue;
      const shell = s.shells[i];
      const t = shell && el >= 0 ? (el - shell.delay) / shell.dur : -1;
      mesh.visible = !!shell && t >= 0 && t <= 1;
      if (shell && mesh.visible) {
        mesh.position.lerpVectors(shell.from, shell.to, t);
        mesh.position.y += shell.arc * 4 * t * (1 - t);
        const trailRate = recipe?.shells?.trailRate ?? 110;
        const n = shell.trail.tick(dt, trailRate);
        if (n > 0) {
          _emit.time = time;
          _emit.position.copy(mesh.position);
          _emit.radius = 0.03;
          _emit.direction = null;
          _emit.speed = 0.15;
          _emit.speedVariance = 0.5;
          _emit.spread = 1;
          _emit.size = recipe?.shells?.trailSize ?? 0.045;
          _emit.sizeVariance = 0.5;
          _emit.life = 0.32;
          _emit.lifeVariance = 0.4;
          _emit.spin = 0;
          _emit.tint = null;
          systems.embers.emit(n, _emit as EmitParams);
        }
      }
    }

    /* ---- impacts: one-shot bursts + expanding ground rings ---- */
    for (let i = 0; i < MAX_TARGETS; i++) {
      const ring = ringRefs.current[i];
      const imp = el >= 0 ? s.impacts[i] : undefined;
      if (imp && !imp.fired && el >= imp.delay) {
        imp.fired = true;
        fireImpact(imp, time);
      }
      if (ring) {
        const ringSpec = recipe?.impact?.ring;
        const ringDur = ringSpec?.dur ?? RING_DUR;
        const rt = imp && ringSpec ? (el - imp.delay) / ringDur : -1;
        ring.visible = !!imp && !!ringSpec && rt >= 0 && rt <= 1;
        if (imp && ringSpec && ring.visible) {
          ring.position.set(imp.at.x, imp.at.y + 0.02, imp.at.z);
          const k = 0.18 + rt * (ringSpec.grow ?? 0.75);
          ring.scale.setScalar(k / 0.33);
          ringMats[i].opacity = 0.85 * (1 - rt);
        }
      }
    }

    /* ---- sustained emitters ---- */
    if (el >= 0) {
      for (const su of s.sustains) {
        if (el >= su.delay && el <= su.delay + su.spec.dur) driveSustain(su, dt, time);
      }
    }

    /* ---- shield bubble ---- */
    const shield = shieldRef.current;
    if (shield) {
      const st = s.shieldAt && el >= 0 ? el - s.shieldDelay : -1;
      const SHIELD_DUR = 1.0;
      shield.visible = st >= 0 && st <= SHIELD_DUR;
      if (shield.visible && s.shieldAt) {
        shield.position.copy(s.shieldAt);
        const grow = 1 - Math.pow(1 - Math.min(1, st / 0.22), 3); // outCubic pop
        shield.scale.setScalar(0.12 + grow * 0.34);
        const fade = st < 0.6 ? 1 : 1 - (st - 0.6) / 0.4;
        shieldMat.opacity = 0.34 * fade;
      }
    }

    for (const sys of systemsList) sys.flush();
  });

  return (
    <>
      {systemsList.map(sys => (
        <primitive key={sys.name} object={sys.mesh} />
      ))}
      {boltMats.map((mat, i) => (
        <mesh
          key={i}
          ref={m => { boltRefs.current[i] = m; }}
          geometry={boltGeom}
          material={mat}
          visible={false}
          frustumCulled={false}
          matrixAutoUpdate={false}
          renderOrder={11 + i * 2}
        />
      ))}
      <mesh ref={shieldRef} visible={false} material={shieldMat} renderOrder={13}>
        <sphereGeometry args={[1, 24, 18]} />
      </mesh>
      {Array.from({ length: MAX_TARGETS }, (_, i) => (
        <React.Fragment key={i}>
          <mesh ref={m => { shellRefs.current[i] = m; }} visible={false} material={shellMat}>
            <sphereGeometry args={[0.055, 10, 8]} />
          </mesh>
          <mesh
            ref={m => { ringRefs.current[i] = m; }}
            visible={false}
            material={ringMats[i]}
            rotation-x={-Math.PI / 2}
          >
            <ringGeometry args={[0.27, 0.33, 32]} />
          </mesh>
        </React.Fragment>
      ))}
    </>
  );
}
