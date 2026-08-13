import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import type { AbilityFx, CombatFx, MapData, UnitView } from '../types.js';
import { attackStyleFor, impactDelayFor } from '../units/attackStyles.js';
import { abilityImpactDelay } from './AbilityVfx.js';
import { ParticleShape, ParticleSystem, type EmitParams } from './ParticleSystem.js';
import {
  playFxPreview,
  requestCameraShake,
  subscribeFxPreview,
  type FxPreviewEvent,
} from './fxEvents.js';

type SystemName = 'sparks' | 'droplets' | 'smoke' | 'debris' | 'glow' | 'bubbles' | 'motes';
type Gradient = [string, string, string, string];

interface ParticleLayer {
  kind: 'particles';
  system: SystemName;
  delay: number;
  count: number;
  radius: number;
  y: number;
  speed: number;
  spread: number;
  size: number;
  life: number;
  spin?: number;
  direction: [number, number, number];
  inheritDirection?: boolean;
  gravity?: [number, number, number];
  gradient: Gradient;
}

interface RingLayer {
  kind: 'ring';
  delay: number;
  color: string;
  duration: number;
  start: number;
  end: number;
  opacity?: number;
}

interface ShakeLayer {
  kind: 'shake';
  delay: number;
  magnitude: number;
  duration: number;
}

type Layer = ParticleLayer | RingLayer | ShakeLayer;

interface FxRecipe {
  label: string;
  group: 'Combat' | 'Water' | 'World';
  layers: Layer[];
}

const HOT: Gradient = ['#ffffff', '#ffe49b', '#ff7d2c', '#7a2104'];
const CRIT: Gradient = ['#ffffff', '#fffbd1', '#ffd33d', '#ff5b16'];
const DUST: Gradient = ['#ead3ad', '#b98d62', '#74503c', '#2f2522'];
const SMOKE: Gradient = ['#8b827d', '#615a58', '#393536', '#181719'];
const WATER: Gradient = ['#ffffff', '#b9ffff', '#35d7e5', '#0c6788'];
const FOAM: Gradient = ['#ffffff', '#e8ffff', '#8be9ed', '#398ba5'];
const ELECTRIC: Gradient = ['#ffffff', '#d9ffff', '#53b7ff', '#7254ff'];
const AURA: Gradient = ['#ffffff', '#9fffd4', '#3de99c', '#126344'];
const PLASMA: Gradient = ['#ffffff', '#ffc8ff', '#ff61dc', '#7a2cff'];
const WATER_TERRAIN = new Set(['water', 'river']);

/**
 * Designer-facing recipe library. Layers are deliberately plain data: adding
 * a burst is a new object, not a new React component or shader.
 */
export const FX_RECIPES: Record<string, FxRecipe> = {
  plasma_projectile: {
    label: 'Plasma Projectile', group: 'Combat', layers: [
      { kind: 'particles', system: 'glow', delay: 0, count: 2, radius: 0.015, y: 0.28, speed: 4.6, spread: 0.015, size: 0.28, life: 0.56, direction: [1, 0.03, 0], inheritDirection: true, gradient: PLASMA },
      { kind: 'particles', system: 'sparks', delay: 0, count: 15, radius: 0.03, y: 0.28, speed: 4.1, spread: 0.055, size: 0.055, life: 0.60, direction: [1, 0.03, 0], inheritDirection: true, gradient: PLASMA },
      { kind: 'particles', system: 'motes', delay: 0.02, count: 12, radius: 0.04, y: 0.28, speed: 3.6, spread: 0.10, size: 0.04, life: 0.58, direction: [1, 0.04, 0], inheritDirection: true, gradient: ELECTRIC },
    ],
  },
  melee_impact: {
    label: 'Melee Impact', group: 'Combat', layers: [
      { kind: 'particles', system: 'glow', delay: 0, count: 2, radius: 0.02, y: 0.18, speed: 0.08, spread: 1, size: 0.42, life: 0.14, direction: [0, 1, 0], gradient: HOT },
      { kind: 'particles', system: 'sparks', delay: 0.01, count: 16, radius: 0.06, y: 0.12, speed: 2.4, spread: 0.48, size: 0.055, life: 0.42, direction: [1, 0.58, 0], inheritDirection: true, gravity: [0, -6, 0], gradient: HOT },
      { kind: 'particles', system: 'debris', delay: 0.015, count: 8, radius: 0.09, y: 0.04, speed: 1.45, spread: 0.72, size: 0.07, life: 0.68, spin: 10, direction: [0, 1, 0], gravity: [0, -4.8, 0], gradient: DUST },
      { kind: 'ring', delay: 0, color: '#ffd275', duration: 0.32, start: 0.12, end: 0.76 },
      { kind: 'shake', delay: 0, magnitude: 0.10, duration: 0.10 },
    ],
  },
  ranged_impact: {
    label: 'Ranged Hit', group: 'Combat', layers: [
      { kind: 'particles', system: 'glow', delay: 0, count: 1, radius: 0.01, y: 0.20, speed: 0, spread: 1, size: 0.34, life: 0.12, direction: [0, 1, 0], gradient: HOT },
      { kind: 'particles', system: 'sparks', delay: 0, count: 13, radius: 0.045, y: 0.16, speed: 2.1, spread: 0.38, size: 0.045, life: 0.36, direction: [1, 0.42, 0], inheritDirection: true, gravity: [0, -5.4, 0], gradient: HOT },
      { kind: 'particles', system: 'smoke', delay: 0.03, count: 4, radius: 0.07, y: 0.10, speed: 0.32, spread: 0.9, size: 0.16, life: 0.62, direction: [0, 1, 0], gravity: [0, 0.22, 0], gradient: SMOKE },
      { kind: 'ring', delay: 0, color: '#ffb951', duration: 0.26, start: 0.09, end: 0.48 },
      { kind: 'shake', delay: 0, magnitude: 0.055, duration: 0.07 },
    ],
  },
  critical_hit: {
    label: 'Critical Hit', group: 'Combat', layers: [
      { kind: 'particles', system: 'glow', delay: 0, count: 4, radius: 0.04, y: 0.22, speed: 0.18, spread: 1, size: 0.62, life: 0.18, direction: [0, 1, 0], gradient: CRIT },
      { kind: 'particles', system: 'sparks', delay: 0.008, count: 38, radius: 0.09, y: 0.14, speed: 3.2, spread: 0.82, size: 0.065, life: 0.62, direction: [1, 0.66, 0], inheritDirection: true, gravity: [0, -5.8, 0], gradient: CRIT },
      { kind: 'particles', system: 'debris', delay: 0.02, count: 14, radius: 0.10, y: 0.05, speed: 2.0, spread: 0.82, size: 0.09, life: 0.85, spin: 12, direction: [0, 1, 0], gravity: [0, -5.0, 0], gradient: HOT },
      { kind: 'ring', delay: 0, color: '#fff0a3', duration: 0.38, start: 0.16, end: 1.16, opacity: 1 },
      { kind: 'ring', delay: 0.07, color: '#ff9f36', duration: 0.42, start: 0.10, end: 0.88 },
      { kind: 'shake', delay: 0, magnitude: 0.22, duration: 0.18 },
    ],
  },
  explosion: {
    label: 'Heavy Explosion', group: 'Combat', layers: [
      { kind: 'particles', system: 'glow', delay: 0, count: 4, radius: 0.08, y: 0.18, speed: 0.25, spread: 1, size: 0.78, life: 0.22, direction: [0, 1, 0], gradient: HOT },
      { kind: 'particles', system: 'sparks', delay: 0.01, count: 34, radius: 0.12, y: 0.10, speed: 3.5, spread: 0.95, size: 0.06, life: 0.72, direction: [0, 1, 0], gravity: [0, -5.8, 0], gradient: HOT },
      { kind: 'particles', system: 'debris', delay: 0.025, count: 20, radius: 0.16, y: 0.05, speed: 2.5, spread: 0.95, size: 0.11, life: 1.0, spin: 11, direction: [0, 1, 0], gravity: [0, -4.8, 0], gradient: DUST },
      { kind: 'particles', system: 'smoke', delay: 0.07, count: 15, radius: 0.20, y: 0.12, speed: 0.78, spread: 0.95, size: 0.30, life: 1.3, spin: 0.7, direction: [0, 1, 0], gravity: [0, 0.52, 0], gradient: SMOKE },
      { kind: 'ring', delay: 0, color: '#ffbd62', duration: 0.48, start: 0.24, end: 1.55, opacity: 1 },
      { kind: 'shake', delay: 0, magnitude: 0.28, duration: 0.24 },
    ],
  },
  shockwave: {
    label: 'Shockwave', group: 'Combat', layers: [
      { kind: 'particles', system: 'glow', delay: 0, count: 2, radius: 0.02, y: 0.06, speed: 0, spread: 1, size: 0.54, life: 0.22, direction: [0, 1, 0], gradient: CRIT },
      { kind: 'ring', delay: 0, color: '#fff6c7', duration: 0.46, start: 0.16, end: 1.75, opacity: 1 },
      { kind: 'ring', delay: 0.08, color: '#ff8a38', duration: 0.52, start: 0.12, end: 1.34 },
      { kind: 'ring', delay: 0.15, color: '#8adfff', duration: 0.56, start: 0.08, end: 1.06, opacity: 0.62 },
      { kind: 'shake', delay: 0, magnitude: 0.16, duration: 0.18 },
    ],
  },
  electric_status: {
    label: 'Status Shock', group: 'Combat', layers: [
      { kind: 'particles', system: 'glow', delay: 0, count: 3, radius: 0.10, y: 0.38, speed: 0.16, spread: 1, size: 0.45, life: 0.20, direction: [0, 1, 0], gradient: ELECTRIC },
      { kind: 'particles', system: 'sparks', delay: 0, count: 26, radius: 0.22, y: 0.34, speed: 1.7, spread: 1, size: 0.045, life: 0.38, direction: [0, 1, 0], gravity: [0, 0.4, 0], gradient: ELECTRIC },
      { kind: 'particles', system: 'motes', delay: 0.06, count: 12, radius: 0.24, y: 0.12, speed: 0.44, spread: 0.75, size: 0.05, life: 0.78, direction: [0, 1, 0], gravity: [0, 0.72, 0], gradient: ELECTRIC },
      { kind: 'ring', delay: 0.02, color: '#80d9ff', duration: 0.42, start: 0.18, end: 0.80 },
      { kind: 'shake', delay: 0, magnitude: 0.07, duration: 0.10 },
    ],
  },
  unit_death: {
    label: 'Unit Death', group: 'Combat', layers: [
      { kind: 'particles', system: 'glow', delay: 0, count: 3, radius: 0.08, y: 0.30, speed: 0.12, spread: 1, size: 0.58, life: 0.22, direction: [0, 1, 0], gradient: HOT },
      { kind: 'particles', system: 'debris', delay: 0.03, count: 24, radius: 0.16, y: 0.16, speed: 2.35, spread: 0.95, size: 0.105, life: 1.05, spin: 13, direction: [0, 1, 0], gravity: [0, -4.5, 0], gradient: DUST },
      { kind: 'particles', system: 'sparks', delay: 0.04, count: 20, radius: 0.14, y: 0.22, speed: 1.8, spread: 0.95, size: 0.048, life: 0.82, direction: [0, 1, 0], gravity: [0, -1.4, 0], gradient: HOT },
      { kind: 'particles', system: 'smoke', delay: 0.09, count: 12, radius: 0.20, y: 0.16, speed: 0.56, spread: 0.95, size: 0.28, life: 1.45, spin: 0.7, direction: [0, 1, 0], gravity: [0, 0.48, 0], gradient: SMOKE },
      { kind: 'ring', delay: 0.02, color: '#ff9b4a', duration: 0.52, start: 0.20, end: 1.22 },
      { kind: 'shake', delay: 0, magnitude: 0.15, duration: 0.18 },
    ],
  },
  water_splash: {
    label: 'Water Entry', group: 'Water', layers: [
      { kind: 'particles', system: 'droplets', delay: 0, count: 30, radius: 0.15, y: 0.02, speed: 2.5, spread: 0.82, size: 0.07, life: 0.82, direction: [0, 1, 0], gravity: [0, -4.4, 0], gradient: WATER },
      { kind: 'particles', system: 'glow', delay: 0, count: 2, radius: 0.04, y: 0.04, speed: 0.1, spread: 1, size: 0.42, life: 0.20, direction: [0, 1, 0], gradient: FOAM },
      { kind: 'particles', system: 'bubbles', delay: 0.14, count: 12, radius: 0.20, y: -0.02, speed: 0.34, spread: 0.55, size: 0.075, life: 1.28, direction: [0, 1, 0], gravity: [0, 0.24, 0], gradient: WATER },
      { kind: 'ring', delay: 0, color: '#b9ffff', duration: 0.66, start: 0.18, end: 1.28, opacity: 0.9 },
      { kind: 'ring', delay: 0.12, color: '#58dce7', duration: 0.78, start: 0.12, end: 0.96, opacity: 0.68 },
      { kind: 'shake', delay: 0, magnitude: 0.06, duration: 0.10 },
    ],
  },
  water_explosion: {
    label: 'Water Explosion', group: 'Water', layers: [
      { kind: 'particles', system: 'glow', delay: 0, count: 5, radius: 0.10, y: 0.05, speed: 0.22, spread: 1, size: 0.86, life: 0.24, direction: [0, 1, 0], gradient: FOAM },
      { kind: 'particles', system: 'droplets', delay: 0, count: 62, radius: 0.22, y: 0.02, speed: 4.1, spread: 0.95, size: 0.085, life: 1.0, direction: [0, 1, 0], gravity: [0, -4.7, 0], gradient: WATER },
      { kind: 'particles', system: 'smoke', delay: 0.07, count: 14, radius: 0.24, y: 0.12, speed: 0.70, spread: 0.9, size: 0.30, life: 1.22, spin: 0.6, direction: [0, 1, 0], gravity: [0, 0.28, 0], gradient: FOAM },
      { kind: 'particles', system: 'bubbles', delay: 0.17, count: 28, radius: 0.30, y: -0.03, speed: 0.48, spread: 0.7, size: 0.09, life: 1.65, direction: [0, 1, 0], gravity: [0, 0.28, 0], gradient: WATER },
      { kind: 'ring', delay: 0, color: '#d7ffff', duration: 0.72, start: 0.34, end: 2.0, opacity: 1 },
      { kind: 'ring', delay: 0.10, color: '#49dae4', duration: 0.88, start: 0.20, end: 1.58, opacity: 0.72 },
      { kind: 'shake', delay: 0, magnitude: 0.24, duration: 0.24 },
    ],
  },
  water_bolt: {
    label: 'Water Lance', group: 'Water', layers: [
      { kind: 'particles', system: 'glow', delay: 0, count: 2, radius: 0.02, y: 0.24, speed: 4.0, spread: 0.02, size: 0.25, life: 0.62, direction: [1, 0.05, 0], inheritDirection: true, gradient: FOAM },
      { kind: 'particles', system: 'droplets', delay: 0, count: 24, radius: 0.05, y: 0.24, speed: 3.7, spread: 0.11, size: 0.06, life: 0.68, direction: [1, 0.08, 0], inheritDirection: true, gravity: [0, -0.35, 0], gradient: WATER },
      { kind: 'particles', system: 'bubbles', delay: 0.04, count: 9, radius: 0.05, y: 0.22, speed: 3.15, spread: 0.13, size: 0.06, life: 0.70, direction: [1, 0.10, 0], inheritDirection: true, gravity: [0, 0.18, 0], gradient: WATER },
    ],
  },
  dust_burst: {
    label: 'Dust & Debris', group: 'World', layers: [
      { kind: 'particles', system: 'smoke', delay: 0, count: 10, radius: 0.16, y: 0.03, speed: 0.48, spread: 0.95, size: 0.22, life: 1.0, spin: 0.8, direction: [0, 1, 0], gravity: [0, 0.20, 0], gradient: DUST },
      { kind: 'particles', system: 'debris', delay: 0, count: 7, radius: 0.10, y: 0.03, speed: 1.15, spread: 0.85, size: 0.06, life: 0.62, spin: 10, direction: [0, 1, 0], gravity: [0, -4.0, 0], gradient: DUST },
      { kind: 'ring', delay: 0, color: '#d3a170', duration: 0.44, start: 0.10, end: 0.70, opacity: 0.38 },
    ],
  },
  healing_aura: {
    label: 'Glowing Aura', group: 'World', layers: [
      { kind: 'particles', system: 'motes', delay: 0, count: 42, radius: 0.30, y: 0.04, speed: 0.58, spread: 0.64, size: 0.065, life: 1.45, direction: [0, 1, 0], gravity: [0, 0.78, 0], gradient: AURA },
      { kind: 'particles', system: 'glow', delay: 0, count: 3, radius: 0.08, y: 0.20, speed: 0.10, spread: 1, size: 0.46, life: 0.56, direction: [0, 1, 0], gradient: AURA },
      { kind: 'ring', delay: 0, color: '#7fffc2', duration: 0.85, start: 0.22, end: 0.82, opacity: 0.72 },
      { kind: 'ring', delay: 0.26, color: '#d9fff0', duration: 0.9, start: 0.14, end: 0.64, opacity: 0.54 },
    ],
  },
};

export const FX_SHOWCASE_ITEMS = Object.entries(FX_RECIPES).map(([id, recipe]) => ({
  id,
  label: recipe.label,
  group: recipe.group,
}));

interface ScheduledLayer {
  due: number;
  layer: Layer;
  position: THREE.Vector3;
  direction: THREE.Vector3;
}

interface RingState {
  startTime: number;
  duration: number;
  startRadius: number;
  endRadius: number;
  opacity: number;
  color: string;
  position: THREE.Vector3;
}

const _emit: Partial<EmitParams> & { position: THREE.Vector3; time: number } = {
  position: new THREE.Vector3(), time: 0,
};
const _direction = new THREE.Vector3();
const MAX_RINGS = 16;

function createSystems() {
  const sparks = new ParticleSystem({ name: 'battle.sparks', capacity: 1800, shape: ParticleShape.STREAK, additive: true, stretch: true });
  sparks.uniforms.uDrag.value = 1.4;
  sparks.uniforms.uEndSize.value = 0.18;
  sparks.uniforms.uSizeIn.value = 0.02;
  sparks.uniforms.uFadeOut.value = 0.56;
  sparks.uniforms.uStretch.value = 0.34;
  sparks.uniforms.uGlow.value = 2.2;
  sparks.uniforms.uTurbulence.value = 0.08;

  const droplets = new ParticleSystem({ name: 'battle.droplets', capacity: 1600, shape: ParticleShape.STREAK, additive: true, stretch: true });
  droplets.uniforms.uDrag.value = 0.55;
  droplets.uniforms.uEndSize.value = 0.34;
  droplets.uniforms.uSizeIn.value = 0.02;
  droplets.uniforms.uFadeOut.value = 0.72;
  droplets.uniforms.uStretch.value = 0.20;
  droplets.uniforms.uGlow.value = 1.5;
  droplets.uniforms.uTurbulence.value = 0.04;

  const smoke = new ParticleSystem({ name: 'battle.smoke', capacity: 800, shape: ParticleShape.SMOKE, additive: false, curl: true });
  smoke.uniforms.uDrag.value = 1.9;
  smoke.uniforms.uEndSize.value = 1.65;
  smoke.uniforms.uSizeIn.value = 0.12;
  smoke.uniforms.uFadeIn.value = 0.07;
  smoke.uniforms.uFadeOut.value = 0.55;
  smoke.uniforms.uOpacity.value = 0.72;
  smoke.uniforms.uGlow.value = 0.75;
  smoke.uniforms.uTurbulence.value = 0.42;

  const debris = new ParticleSystem({ name: 'battle.debris', capacity: 1000, shape: ParticleShape.CHIP, additive: false });
  debris.uniforms.uDrag.value = 0.65;
  debris.uniforms.uEndSize.value = 0.54;
  debris.uniforms.uSizeIn.value = 0.02;
  debris.uniforms.uFadeOut.value = 0.76;
  debris.uniforms.uGlow.value = 0.88;
  debris.uniforms.uTurbulence.value = 0.03;

  const glow = new ParticleSystem({ name: 'battle.glow', capacity: 500, shape: ParticleShape.SOFT, additive: true });
  glow.uniforms.uDrag.value = 4.0;
  glow.uniforms.uEndSize.value = 1.6;
  glow.uniforms.uSizeIn.value = 0.04;
  glow.uniforms.uFadeOut.value = 0.34;
  glow.uniforms.uGlow.value = 2.7;
  glow.uniforms.uTurbulence.value = 0;

  const bubbles = new ParticleSystem({ name: 'battle.bubbles', capacity: 900, shape: ParticleShape.RING, additive: true, curl: true });
  bubbles.uniforms.uDrag.value = 2.2;
  bubbles.uniforms.uEndSize.value = 0.72;
  bubbles.uniforms.uSizeIn.value = 0.08;
  bubbles.uniforms.uFadeOut.value = 0.70;
  bubbles.uniforms.uGlow.value = 1.5;
  bubbles.uniforms.uTurbulence.value = 0.20;

  const motes = new ParticleSystem({ name: 'battle.motes', capacity: 1200, shape: ParticleShape.SOFT, additive: true, curl: true });
  motes.uniforms.uDrag.value = 1.8;
  motes.uniforms.uEndSize.value = 0.24;
  motes.uniforms.uSizeIn.value = 0.08;
  motes.uniforms.uFadeOut.value = 0.68;
  motes.uniforms.uGlow.value = 2.0;
  motes.uniforms.uTurbulence.value = 0.24;

  return { sparks, droplets, smoke, debris, glow, bubbles, motes };
}

export function BattlefieldVfx({ map, units, combat, ability }: {
  map: MapData;
  units: UnitView[];
  combat?: CombatFx | null;
  ability?: AbilityFx | null;
}) {
  const systems = React.useMemo(createSystems, []);
  const systemsList = React.useMemo(() => Object.values(systems), [systems]);
  const queue = React.useRef<ScheduledLayer[]>([]);
  const lastTime = React.useRef(0);
  const lastCombatSeq = React.useRef(-1);
  const lastAbilitySeq = React.useRef(-1);
  const previousUnits = React.useRef<Map<number, UnitView>>(new Map());
  const ringStates = React.useRef<(RingState | null)[]>(Array(MAX_RINGS).fill(null));
  const ringCursor = React.useRef(0);
  const ringRefs = React.useRef<(THREE.Mesh | null)[]>([]);
  const ringMaterials = React.useMemo(() => Array.from({ length: MAX_RINGS }, () =>
    new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    })), []);

  React.useEffect(() => () => {
    systemsList.forEach(system => system.dispose());
    ringMaterials.forEach(material => material.dispose());
  }, [ringMaterials, systemsList]);

  const schedule = React.useCallback((
    id: string,
    position: { x: number; y: number },
    direction = { x: 0, y: 1 },
    extraDelay = 0,
  ) => {
    const recipe = FX_RECIPES[id];
    if (!recipe) return;
    const origin = new THREE.Vector3(position.x + 0.5, 0, position.y + 0.5);
    const dir = new THREE.Vector3(direction.x, 0, direction.y).normalize();
    if (dir.lengthSq() < 0.001) dir.set(1, 0, 0);
    const now = lastTime.current;
    for (const layer of recipe.layers) {
      queue.current.push({
        due: now + extraDelay + layer.delay,
        layer,
        position: origin.clone(),
        direction: dir.clone(),
      });
    }
  }, []);

  React.useEffect(() => subscribeFxPreview((event: FxPreviewEvent) => {
    schedule(event.id, event.position, event.direction);
  }), [schedule]);

  // Real attacks automatically receive material-aware impacts and death bursts.
  React.useEffect(() => {
    if (!combat || combat.seq === lastCombatSeq.current) return;
    lastCombatSeq.current = combat.seq;
    const attacker = units.find(unit => unit.id === combat.attackerId);
    const style = attackStyleFor(attacker?.kind ?? '');
    const dx = combat.defenderPos.x - combat.attackerPos.x;
    const dy = combat.defenderPos.y - combat.attackerPos.y;
    const distance = Math.hypot(dx, dy);
    const delay = impactDelayFor(style, distance);
    const terrain = map.tiles[combat.defenderPos.y]?.[combat.defenderPos.x]?.terrain;
    const liquid = terrain != null && WATER_TERRAIN.has(terrain);
    schedule(
      liquid ? 'water_explosion' : style.kind === 'melee' ? 'melee_impact' : 'ranged_impact',
      combat.defenderPos,
      { x: dx / (distance || 1), y: dy / (distance || 1) },
      delay,
    );
    if (combat.defenderKilled) {
      schedule('unit_death', combat.defenderPos, { x: dx / (distance || 1), y: dy / (distance || 1) }, delay + 0.035);
    }
    if (combat.attackerKilled) {
      schedule('unit_death', combat.attackerPos, { x: -dx / (distance || 1), y: -dy / (distance || 1) }, delay + 0.22);
    }
  }, [combat, map, schedule, units]);

  // Ability kills use the same impact timing as their projectile/shell recipe.
  React.useEffect(() => {
    if (!ability || ability.seq === lastAbilitySeq.current) return;
    lastAbilitySeq.current = ability.seq;
    for (const killed of ability.killed ?? []) {
      const index = Math.max(0, ability.targets.findIndex(t => t.x === killed.pos.x && t.y === killed.pos.y));
      const delay = abilityImpactDelay(ability.abilityId, ability.casterPos, killed.pos, index);
      const dx = killed.pos.x - ability.casterPos.x;
      const dy = killed.pos.y - ability.casterPos.y;
      const length = Math.hypot(dx, dy) || 1;
      schedule('unit_death', killed.pos, { x: dx / length, y: dy / length }, delay + 0.035);
    }
  }, [ability, schedule]);

  // Movement kicks material from the destination. The water branch is ready
  // for amphibious units and river maps even though deep Ashwater is impassable.
  React.useEffect(() => {
    const previous = previousUnits.current;
    if (previous.size > 0) {
      for (const unit of units) {
        const before = previous.get(unit.id);
        if (!before) continue;
        if (before.gridPos.x !== unit.gridPos.x || before.gridPos.y !== unit.gridPos.y) {
          const fromTerrain = map.tiles[before.gridPos.y]?.[before.gridPos.x]?.terrain;
          const toTerrain = map.tiles[unit.gridPos.y]?.[unit.gridPos.x]?.terrain;
          if ((fromTerrain && WATER_TERRAIN.has(fromTerrain)) || (toTerrain && WATER_TERRAIN.has(toTerrain))) {
            schedule('water_splash', unit.gridPos);
          } else {
            schedule('dust_burst', unit.gridPos);
          }
        }
        const oldStatuses = new Set(before.statuses ?? []);
        if ((unit.statuses ?? []).some(status => !oldStatuses.has(status))) {
          schedule('electric_status', unit.gridPos);
        }
      }
    }
    previousUnits.current = new Map(units.map(unit => [unit.id, { ...unit, gridPos: { ...unit.gridPos }, statuses: [...(unit.statuses ?? [])] }]));
  }, [map, schedule, units]);

  const fire = React.useCallback((entry: ScheduledLayer, time: number) => {
    const layer = entry.layer;
    if (layer.kind === 'shake') {
      requestCameraShake(layer.magnitude, layer.duration);
      return;
    }
    if (layer.kind === 'ring') {
      const index = ringCursor.current++ % MAX_RINGS;
      ringStates.current[index] = {
        startTime: time,
        duration: layer.duration,
        startRadius: layer.start,
        endRadius: layer.end,
        opacity: layer.opacity ?? 0.82,
        color: layer.color,
        position: entry.position.clone(),
      };
      ringMaterials[index].color.set(layer.color);
      return;
    }

    const system = systems[layer.system];
    system.setGradient(...layer.gradient);
    (system.uniforms.uGravity.value as THREE.Vector3).fromArray(layer.gravity ?? [0, 0, 0]);
    _emit.time = time;
    _emit.position.copy(entry.position).setY(entry.position.y + layer.y);
    _emit.radius = layer.radius;
    if (layer.inheritDirection) {
      _direction.copy(entry.direction).multiplyScalar(layer.direction[0]);
      _direction.y = layer.direction[1];
      _emit.direction = _direction.normalize();
    } else {
      _emit.direction = _direction.fromArray(layer.direction).normalize();
    }
    _emit.speed = layer.speed;
    _emit.speedVariance = 0.42;
    _emit.spread = layer.spread;
    _emit.size = layer.size;
    _emit.sizeVariance = 0.42;
    _emit.life = layer.life;
    _emit.lifeVariance = 0.30;
    _emit.spin = layer.spin ?? 0;
    _emit.tint = null;
    system.emit(layer.count, _emit as EmitParams);
  }, [ringMaterials, systems]);

  useFrame(({ clock }, delta) => {
    const time = clock.elapsedTime;
    lastTime.current = time;
    for (const system of systemsList) system.uniforms.uTime.value = time;

    for (let i = queue.current.length - 1; i >= 0; i--) {
      const entry = queue.current[i];
      if (entry.due <= time) {
        fire(entry, time);
        queue.current.splice(i, 1);
      }
    }

    for (let i = 0; i < MAX_RINGS; i++) {
      const mesh = ringRefs.current[i];
      const state = ringStates.current[i];
      if (!mesh || !state) continue;
      const t = (time - state.startTime) / state.duration;
      mesh.visible = t >= 0 && t <= 1;
      if (!mesh.visible) {
        ringStates.current[i] = null;
        continue;
      }
      const eased = 1 - Math.pow(1 - Math.min(1, t), 3);
      const radius = THREE.MathUtils.lerp(state.startRadius, state.endRadius, eased);
      mesh.position.set(state.position.x, 0.026, state.position.z);
      mesh.scale.setScalar(radius);
      ringMaterials[i].opacity = state.opacity * (1 - t) * (1 - t * 0.25);
    }

    // Ensure a background tab cannot create an oversized one-frame emission.
    void delta;
    systemsList.forEach(system => system.flush());
  });

  return (
    <>
      {systemsList.map(system => <primitive key={system.name} object={system.mesh} />)}
      {Array.from({ length: MAX_RINGS }, (_, index) => (
        <mesh
          key={index}
          ref={mesh => { ringRefs.current[index] = mesh; }}
          visible={false}
          rotation-x={-Math.PI / 2}
          material={ringMaterials[index]}
          renderOrder={14}
        >
          <ringGeometry args={[0.82, 1, 40]} />
        </mesh>
      ))}
    </>
  );
}

const GROUPS: FxRecipe['group'][] = ['Combat', 'Water', 'World'];

export function FxShowcasePanel({ map, hovered }: {
  map: MapData;
  hovered?: { x: number; y: number } | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState<string | null>(null);
  const clearTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  const findTarget = React.useCallback((id: string) => {
    // A hovered cell always wins so the lab behaves like an aiming tool.
    if (hovered) return hovered;
    if (id.startsWith('water_')) {
      const centre = { x: map.width / 2, y: map.height / 2 };
      let nearest: { x: number; y: number } | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (!WATER_TERRAIN.has(map.tiles[y][x].terrain)) continue;
          const distance = Math.hypot(x - centre.x, y - centre.y);
          if (distance < nearestDistance) {
            nearest = { x, y };
            nearestDistance = distance;
          }
        }
      }
      if (nearest) return nearest;
    }
    return { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  }, [hovered, map]);

  const play = React.useCallback((id: string) => {
    const position = findTarget(id);
    playFxPreview({ id, position, direction: { x: 0.9, y: 0.35 } });
    setActive(id);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setActive(null), 900);
  }, [findTarget]);

  return (
    <div className={`fx-lab${open ? ' open' : ''}`}>
      <button
        type="button"
        className="fx-lab-trigger"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="fx-lab-pip" />
        VFX LAB
        <span className="fx-lab-key">{open ? 'CLOSE' : 'OPEN'}</span>
      </button>
      {open && (
        <div className="fx-lab-panel">
          <div className="fx-lab-heading">
            <span>LIVE EFFECT LIBRARY</span>
            <small>Hover a tile to aim</small>
          </div>
          {GROUPS.map(group => (
            <div className="fx-lab-group" key={group}>
              <span className="fx-lab-group-name">{group}</span>
              <div className="fx-lab-grid">
                {FX_SHOWCASE_ITEMS.filter(item => item.group === group).map(item => (
                  <button
                    type="button"
                    key={item.id}
                    className={active === item.id ? 'active' : ''}
                    onClick={() => play(item.id)}
                  >
                    <span>{item.label}</span>
                    <i aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
