import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { attackStyleFor, impactDelayFor } from './units/attackStyles.js';
import type { AbilityFx, CombatFx, Facing, UnitGhost, UnitView } from './types.js';
import type { CameraInteraction } from './CameraRig.js';
import { defForKind, isHeavyKind } from './units/unitDefs.js';
import { buildUnit, disposeUnit } from './units/buildUnit.js';
import { StalkerModel } from './units/StalkerModel.js';
import { GlbUnitModel, GlbGhostModel } from './units/GlbUnitModel.js';
import { unitModelForKind } from './models/modelAssets.js';
import { useOutlineStore } from './outlineStore.js';

/** Models are built facing +Z; rotate to the unit's grid facing. */
const FACING_ROT_Y: Record<Facing, number> = {
  se: Math.PI / 2,  // +x
  sw: 0,            // +y (world +z)
  nw: -Math.PI / 2, // -x
  ne: Math.PI,      // -y (world -z)
};

/**
 * Decorative red sensor sweep projected on the floor in front of hostile
 * heavies (the reference's mech scan cones). Purely visual — real threat
 * tiles remain the highlights props.
 */
function ScanCone() {
  const geometry = React.useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(-0.85, 2.6);
    shape.lineTo(0.85, 2.6);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);
  React.useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} rotation-x={Math.PI / 2} position={[0, 0.025, 0.3]}>
      <meshBasicMaterial
        color="#ff3b30"
        transparent
        opacity={0.14}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** Bespoke voxel body for the unit's kind (see units/unitDefs.ts). */
function BoxUnit({ unit }: { unit: UnitView }) {
  const model = React.useMemo(
    () => buildUnit(defForKind(unit.kind), unit.teamColor),
    [unit.kind, unit.teamColor],
  );
  React.useEffect(() => () => disposeUnit(model), [model]);
  return <primitive object={model} />;
}

/** Unit body router: kinds with real 3D models use them (box fallback while
 *  the asset streams in); everyone else keeps the box-voxel build. In tileset
 *  mode (`useModels`) every kind with a GLB in models/modelAssets.ts renders
 *  its real model; unmodeled kinds keep the box-voxel build. */
function UnitBody({ unit, useModels }: { unit: UnitView; useModels?: boolean }) {
  if (useModels && unitModelForKind(unit.kind)) {
    return (
      <React.Suspense fallback={<BoxUnit unit={unit} />}>
        <GlbUnitModel kind={unit.kind} teamColor={unit.teamColor} />
      </React.Suspense>
    );
  }
  if (unit.kind === 'stalker') {
    return (
      <React.Suspense fallback={<BoxUnit unit={unit} />}>
        <StalkerModel teamColor={unit.teamColor} />
      </React.Suspense>
    );
  }
  return <BoxUnit unit={unit} />;
}

/**
 * Selection highlight: the selected unit's meshes are handed to the PostFX
 * Outline pass (screen-space silhouette), which draws ONLY the outer edge —
 * inverted-hull shells showed backfaces through every crevice of the organic
 * glTF bodies. Re-collected shortly after selection to catch glTF bodies that
 * stream in via Suspense.
 */
function useSelectionOutline(
  selected: boolean | undefined,
  body: React.RefObject<THREE.Group | null>,
  kind: string,
) {
  React.useEffect(() => {
    if (!selected) return;
    const collect = () => {
      const meshes: THREE.Object3D[] = [];
      body.current?.traverse(o => {
        if ((o as THREE.Mesh).isMesh && o.visible && !o.userData.noOutline) meshes.push(o);
      });
      useOutlineStore.getState().set(meshes);
    };
    collect();
    const t = setTimeout(collect, 450);
    return () => {
      clearTimeout(t);
      useOutlineStore.getState().set([]);
    };
  }, [selected, body, kind]);
}

/** Seconds to slide one move (covers multi-tile moves in one glide). */
const MOVE_DURATION = 0.3;
const LUNGE_DURATION = 0.22;
const FLASH_DURATION = 0.3;

/**
 * Floating HP readout over the selected unit — the HUD card's segmented pip
 * row (see gen8hud.css .g8-pips), camera-facing and drawn on top: up to 12
 * glowing segments, red for hostiles, cyan for your own units, empty sockets
 * dark. Matches the intel-card style 1:1.
 */
const PIP_MAX = 12;
const PIP_W = 0.042;
const PIP_H = 0.05;
const PIP_GAP = 0.012;

function HealthBar({ hp, maxHp, y, hostile }: {
  hp: number;
  maxHp: number;
  y: number;
  hostile?: boolean;
}) {
  const count = Math.max(1, Math.min(PIP_MAX, maxHp));
  const filled = Math.round((Math.max(0, hp) / (maxHp || 1)) * count);
  const span = count * PIP_W + (count - 1) * PIP_GAP;
  const onColor = hostile ? '#ff2e3c' : '#24e0ff';
  return (
    <Billboard position={[0, y, 0]}>
      {/* Dark plate behind the row, slightly padded. */}
      <mesh renderOrder={997}>
        <planeGeometry args={[span + 0.05, PIP_H + 0.045]} />
        <meshBasicMaterial color="#060a12" transparent opacity={0.8} depthTest={false} toneMapped={false} />
      </mesh>
      {Array.from({ length: count }, (_, i) => (
        <mesh
          key={i}
          position={[-span / 2 + PIP_W / 2 + i * (PIP_W + PIP_GAP), 0, 0.001]}
          renderOrder={998}
        >
          <planeGeometry args={[PIP_W, PIP_H]} />
          <meshBasicMaterial
            color={i < filled ? onColor : '#1a2233'}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </Billboard>
  );
}

function UnitMesh({ unit, onTileClick, interaction, combat, useModels, impactDelay = 0 }: {
  unit: UnitView;
  onTileClick?: (x: number, y: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
  combat?: CombatFx | null;
  useModels?: boolean;
  /** Seconds after the combat event until the hit lands (projectile flight /
   *  melee lunge apex) — delays the defender's hit flash to match. */
  impactDelay?: number;
}) {
  const rootRef = React.useRef<THREE.Group>(null);
  const bodyRef = React.useRef<THREE.Group>(null);

  // Click collider fitted to the actual body (GLB height + hover, or the
  // legacy box-unit envelope).
  const modelDef = useModels ? unitModelForKind(unit.kind) : null;
  const colliderH = (modelDef ? modelDef.height + (modelDef.hover ?? 0) : 0.95) + 0.1;

  useSelectionOutline(unit.selected, bodyRef, unit.kind);

  // Move animation: when the grid position changes, glide from the previous
  // world position to the new one with a slight hop. Units are otherwise
  // static (no idle bob). Elevation (mountain rock tops in tileset mode)
  // lerps along the same glide.
  const off = unit.visualOffset ?? 0;
  const target = {
    x: unit.gridPos.x + 0.5 + off,
    z: unit.gridPos.y + 0.5 + off,
    e: unit.elevation ?? 0,
  };
  const animRef = React.useRef({
    x: target.x, z: target.z, e: target.e,   // current rendered position
    fromX: target.x, fromZ: target.z, fromE: target.e,
    toX: target.x, toZ: target.z, toE: target.e,
    start: -1,                          // -1 = idle
  });
  const a = animRef.current;
  if (a.toX !== target.x || a.toZ !== target.z || a.toE !== target.e) {
    a.fromX = a.x;
    a.fromZ = a.z;
    a.fromE = a.e;
    a.toX = target.x;
    a.toZ = target.z;
    a.toE = target.e;
    a.start = -2; // armed; stamped with clock time on the next frame
  }

  // Combat effects: the attacker turns to face its target, then lunges
  // (melee) or recoils from the shot (ranged); the defender flashes when the
  // hit actually lands (impactDelay). Facing eases back afterwards.
  const attackStyle = attackStyleFor(unit.kind);
  const flashRef = React.useRef<THREE.Mesh>(null);
  const fxRef = React.useRef({
    seq: -1, lungeStart: -1, flashStart: -1, flashDelay: 0,
    dirX: 0, dirZ: 0, targetYaw: 0, faceUntil: -1,
  });
  const fx = fxRef.current;
  if (combat && combat.seq !== fx.seq) {
    fx.seq = combat.seq;
    if (combat.attackerId === unit.id) {
      const dx = combat.defenderPos.x - combat.attackerPos.x;
      const dz = combat.defenderPos.y - combat.attackerPos.y;
      const len = Math.hypot(dx, dz) || 1;
      fx.dirX = dx / len;
      fx.dirZ = dz / len;
      fx.targetYaw = Math.atan2(dx, dz); // models face +Z
      fx.lungeStart = -2;
    } else if (combat.defenderId === unit.id) {
      fx.flashDelay = impactDelay;
      fx.flashStart = -2;
    }
  }

  useFrame(({ clock }) => {
    const g = rootRef.current;
    if (!g) return;
    if (a.start === -2) a.start = clock.elapsedTime;
    if (fx.lungeStart === -2) {
      fx.lungeStart = clock.elapsedTime;
      fx.faceUntil = clock.elapsedTime + Math.max(LUNGE_DURATION, impactDelay) + 0.25;
    }
    if (fx.flashStart === -2) fx.flashStart = clock.elapsedTime + fx.flashDelay;

    // Attack facing: snap toward the target for the strike, ease back after.
    const baseYaw = FACING_ROT_Y[unit.facing];
    if (clock.elapsedTime < fx.faceUntil) {
      g.rotation.y = fx.targetYaw;
    } else {
      // Shortest-path ease back to the grid facing.
      let d = baseYaw - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.rotation.y = Math.abs(d) < 0.03 ? baseYaw : g.rotation.y + d * 0.18;
    }

    let y = a.e;
    if (a.start >= 0) {
      const t = Math.min(1, (clock.elapsedTime - a.start) / MOVE_DURATION);
      const e = t * t * (3 - 2 * t); // smoothstep ease
      a.x = a.fromX + (a.toX - a.fromX) * e;
      a.z = a.fromZ + (a.toZ - a.fromZ) * e;
      a.e = a.fromE + (a.toE - a.fromE) * e;
      y = a.e + Math.sin(t * Math.PI) * 0.08;
      if (t >= 1) a.start = -1;
    }
    // Melee: quick out-and-back thrust toward the defender.
    // Ranged: a short recoil kick away from the shot instead.
    let lx = 0, lz = 0;
    if (fx.lungeStart >= 0) {
      const t = Math.min(1, (clock.elapsedTime - fx.lungeStart) / LUNGE_DURATION);
      const k = Math.sin(t * Math.PI) * (attackStyle.kind === 'melee' ? 0.32 : -0.09);
      lx = fx.dirX * k;
      lz = fx.dirZ * k;
      if (t >= 1) fx.lungeStart = -1;
    }
    g.position.set(a.x + lx, y, a.z + lz);

    // Hit flash: additive red shell that pops when the hit LANDS (delayed by
    // projectile flight / melee wind-up) and decays.
    const f = flashRef.current;
    if (f) {
      if (fx.flashStart >= 0) {
        const t = (clock.elapsedTime - fx.flashStart) / FLASH_DURATION;
        if (t < 0) {
          f.visible = false; // hit still in flight
        } else {
          f.visible = t < 1;
          (f.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - Math.min(1, t));
          if (t >= 1) fx.flashStart = -1;
        }
      } else {
        f.visible = false;
      }
    }
  });

  return (
    <group
      ref={rootRef}
      position={[target.x, 0, target.z]}
      rotation-y={FACING_ROT_Y[unit.facing]}
    >
      {unit.hostile && isHeavyKind(unit.kind) && <ScanCone />}
      {unit.selected && unit.hp != null && unit.maxHp != null && (
        <HealthBar hp={unit.hp} maxHp={unit.maxHp} y={colliderH + 0.14} hostile={unit.hostile} />
      )}
      <mesh ref={flashRef} visible={false} position={[0, 0.42, 0]}>
        <boxGeometry args={[0.62, 0.95, 0.62]} />
        <meshBasicMaterial
          color="#ff5040"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <group position-y={0.015} ref={bodyRef}>
        <UnitBody unit={unit} useModels={useModels} />
        {/* Invisible collider: clicking a unit's body must resolve to ITS tile,
            not the tile the ray would hit on the floor behind it. Sized to the
            unit's real model so small units don't shadow the tile behind them.
            While the unit IS selected the click projects through to the ground
            instead — otherwise the body blocks its own northern move target. */}
        {onTileClick && (
          <mesh
            visible={false}
            position={[0, colliderH / 2, 0]}
            onClick={e => {
              if (interaction?.current.suppressClick) return; // grab-pan release
              e.stopPropagation();
              if (unit.selected && e.ray.direction.y < 0) {
                const t = -(e.ray.origin.y) / e.ray.direction.y;
                const gx = Math.floor(e.ray.origin.x + e.ray.direction.x * t);
                const gz = Math.floor(e.ray.origin.z + e.ray.direction.z * t);
                onTileClick(gx, gz);
                return;
              }
              onTileClick(unit.gridPos.x, unit.gridPos.y);
            }}
          >
            <boxGeometry args={[0.6, colliderH, 0.6]} />
          </mesh>
        )}
      </group>
    </group>
  );
}

/**
 * One-shot attack FX for the latest combat event: a styled projectile flying
 * attacker → defender (tracer / lobbed shell / bolt / acid glob / arrow, per
 * units/attackStyles.ts) with a muzzle flash, or a slash arc sweeping across
 * the defender for melee strikes. Purely presentational.
 */
function CombatFxLayer({ combat, units }: { combat?: CombatFx | null; units: UnitView[] }) {
  const unitsRef = React.useRef(units);
  unitsRef.current = units;

  const projRef = React.useRef<THREE.Mesh>(null);
  const muzzleRef = React.useRef<THREE.Mesh>(null);
  const slashRef = React.useRef<THREE.Mesh>(null);
  const stateRef = React.useRef({
    seq: -1, start: -1,
    style: attackStyleFor(''),
    from: new THREE.Vector3(), to: new THREE.Vector3(),
    dur: 0, yaw: 0,
  });

  const s = stateRef.current;
  if (combat && combat.seq !== s.seq) {
    s.seq = combat.seq;
    const attacker = unitsRef.current.find(u => u.id === combat.attackerId);
    s.style = attackStyleFor(attacker?.kind ?? '');
    s.from.set(
      combat.attackerPos.x + 0.5,
      0.45 + (attacker?.elevation ?? 0),
      combat.attackerPos.y + 0.5,
    );
    s.to.set(combat.defenderPos.x + 0.5, 0.35, combat.defenderPos.y + 0.5);
    const dist = Math.hypot(s.to.x - s.from.x, s.to.z - s.from.z);
    s.dur = impactDelayFor(s.style, dist);
    s.yaw = Math.atan2(s.to.x - s.from.x, s.to.z - s.from.z);
    s.start = -2; // stamped on next frame
  }

  // Shared geometries/materials, keyed by the active shape via visibility.
  const projGeom = React.useMemo(() => ({
    bullet: new THREE.BoxGeometry(0.035, 0.035, 0.2),
    arrow: new THREE.BoxGeometry(0.025, 0.025, 0.24),
    bolt: new THREE.SphereGeometry(0.075, 12, 10),
    glob: new THREE.SphereGeometry(0.08, 10, 8),
    shell: new THREE.SphereGeometry(0.095, 12, 10),
  }), []);
  React.useEffect(() => () => Object.values(projGeom).forEach(g => g.dispose()), [projGeom]);
  const projMat = React.useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const muzzleMat = React.useMemo(() => new THREE.MeshBasicMaterial({
    color: '#fff2c8', transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }), []);
  const slashMat = React.useMemo(() => new THREE.MeshBasicMaterial({
    color: '#eaffff', transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }), []);
  React.useEffect(() => () => {
    projMat.dispose();
    muzzleMat.dispose();
    slashMat.dispose();
  }, [projMat, muzzleMat, slashMat]);

  useFrame(({ clock }) => {
    const proj = projRef.current;
    const muzzle = muzzleRef.current;
    const slash = slashRef.current;
    if (!proj || !muzzle || !slash) return;
    if (s.start === -2) {
      s.start = clock.elapsedTime;
      if (s.style.kind === 'projectile') {
        proj.geometry = projGeom[s.style.shape];
        projMat.color.set(s.style.color);
        const k = s.style.size ?? 1;
        proj.scale.setScalar(k);
      }
    }
    proj.visible = muzzle.visible = slash.visible = false;
    if (s.start < 0) return;
    const el = clock.elapsedTime - s.start;

    if (s.style.kind === 'projectile') {
      // Muzzle flash: a brief additive quad at the barrel.
      if (el < 0.07) {
        muzzle.visible = true;
        muzzle.position.copy(s.from);
        muzzle.scale.setScalar(1 + el * 20);
        muzzleMat.opacity = 0.9 * (1 - el / 0.07);
      }
      // Flight with optional lobbed arc; nose aligned along the velocity.
      const t = el / s.dur;
      if (t <= 1) {
        proj.visible = true;
        proj.position.lerpVectors(s.from, s.to, t);
        const arc = s.style.arc ?? 0;
        proj.position.y += arc * 4 * t * (1 - t);
        if (s.style.shape === 'bullet' || s.style.shape === 'arrow') {
          const t2 = Math.min(1, t + 0.05);
          const ahead = new THREE.Vector3().lerpVectors(s.from, s.to, t2);
          ahead.y += arc * 4 * t2 * (1 - t2);
          proj.lookAt(ahead);
        }
      }
    } else {
      // Melee slash: a crescent sweeping across the defender at impact.
      const t0 = 0.08; // wind-up
      const t = (el - t0) / 0.2;
      if (t >= 0 && t <= 1) {
        slash.visible = true;
        slash.position.set(s.to.x, 0.45, s.to.z);
        slash.rotation.set(-Math.PI / 2, 0, s.yaw + (t - 0.5) * 2.4);
        slashMat.opacity = 0.85 * Math.sin(Math.min(1, t) * Math.PI);
      }
    }
  });

  return (
    <>
      <mesh ref={projRef} visible={false} geometry={projGeom.bullet} material={projMat} />
      <mesh ref={muzzleRef} visible={false} material={muzzleMat}>
        <planeGeometry args={[0.16, 0.16]} />
      </mesh>
      <mesh ref={slashRef} visible={false} material={slashMat}>
        <ringGeometry args={[0.2, 0.38, 24, 1, 0, 1.7]} />
      </mesh>
    </>
  );
}

/**
 * Ability cast animations. Every active ability maps to two shared visual
 * primitives — an optional PROJECTILE (straight bolt or lobbed glob/shell,
 * per target) and a BURST at the destination (expanding ground ring + rising
 * glow column). Multi-target casts stagger per target. Self-casts and morphs
 * (burrow, assault mode, rage…) burst at the caster.
 */
interface CastStyle {
  color: string;
  /** 'bolt' = fast straight shot, 'lob' = arcing shell/glob, none = no projectile. */
  projectile?: 'bolt' | 'lob';
  /** Column height multiplier for the burst (heals rise tall, blasts stay squat). */
  column?: number;
  ring?: number;
}
const CAST_STYLES: Record<string, CastStyle> = {
  // Heals / support: no projectile, tall rising glow.
  heal_1: { color: '#4bffa5', column: 1.4 },
  heal_2: { color: '#4bffa5', column: 1.4 },
  cure: { color: '#9dffd0', column: 1.4 },
  repair_1: { color: '#ffc86b', column: 1.2 },
  repair_2: { color: '#ffc86b', column: 1.2 },
  kinetic_shield: { color: '#6be4ff', column: 1.3 },
  build_node: { color: '#ffc86b', column: 1.0 },
  // Bolts.
  infect: { color: '#b26bff', projectile: 'bolt' },
  stun: { color: '#ffe28a', projectile: 'bolt' },
  tracer_round: { color: '#ffd98a', projectile: 'bolt' },
  plant_explosives: { color: '#ff8a3c', projectile: 'bolt' },
  // Lobbed.
  spray_bile: { color: '#8aff4d', projectile: 'lob', ring: 1.4 },
  percussive_shells: { color: '#ffab52', projectile: 'lob', ring: 1.5 },
  ballistic_volley: { color: '#ffab52', projectile: 'lob', ring: 1.3 },
  // Ground / melee-flavoured.
  wyrm_strike: { color: '#d8b06a', column: 1.6, ring: 1.4 },
  ram: { color: '#ffb28a', ring: 1.3 },
  // Self-casts / morphs.
  self_destruct: { color: '#ff5040', ring: 2.2, column: 1.2 },
  burrow: { color: '#c9a06b', ring: 1.4 },
  erupt: { color: '#c9a06b', ring: 1.6, column: 1.2 },
  assault_mode: { color: '#9fd8ff', ring: 1.3 },
  rage: { color: '#ff5040', ring: 1.4, column: 1.1 },
  camouflage: { color: '#8ad98a', ring: 1.3 },
  entangle: { color: '#6bd96b', ring: 1.5 },
};
const DEFAULT_CAST: CastStyle = { color: '#8ecbff', ring: 1.1 };

const MAX_CAST_TARGETS = 4;
const CAST_STAGGER = 0.1;
const BOLT_DUR = 0.16;
const LOB_DUR = 0.34;
const BURST_DUR = 0.55;

function AbilityFxLayer({ ability, units }: { ability?: AbilityFx | null; units: UnitView[] }) {
  const unitsRef = React.useRef(units);
  unitsRef.current = units;

  interface Shot { from: THREE.Vector3; to: THREE.Vector3; delay: number; dur: number; lob: boolean }
  interface Burst { at: THREE.Vector3; delay: number; column: number; ring: number }
  const stateRef = React.useRef({
    seq: -1, start: -1, color: '#ffffff',
    shots: [] as Shot[], bursts: [] as Burst[],
  });
  const s = stateRef.current;
  if (ability && ability.seq !== s.seq) {
    s.seq = ability.seq;
    const style = CAST_STYLES[ability.abilityId] ?? DEFAULT_CAST;
    s.color = style.color;
    s.shots = [];
    s.bursts = [];
    const caster = unitsRef.current.find(u => u.id === ability.unitId);
    const from = new THREE.Vector3(
      ability.casterPos.x + 0.5,
      0.5 + (caster?.elevation ?? 0),
      ability.casterPos.y + 0.5,
    );
    const targets = (ability.targets.length ? ability.targets : [ability.casterPos])
      .slice(0, MAX_CAST_TARGETS);
    targets.forEach((t, i) => {
      const at = new THREE.Vector3(t.x + 0.5, 0.03, t.y + 0.5);
      const delay = i * CAST_STAGGER;
      const flight = style.projectile ? (style.projectile === 'lob' ? LOB_DUR : BOLT_DUR) : 0;
      if (style.projectile) {
        s.shots.push({ from, to: at.clone().setY(0.3), delay, dur: flight, lob: style.projectile === 'lob' });
      }
      s.bursts.push({ at, delay: delay + flight, column: style.column ?? 0.6, ring: style.ring ?? 1 });
    });
    s.start = -2;
  }

  // Pooled meshes: MAX projectiles + MAX (ring + column) pairs. Each element
  // fades independently, so every mesh gets its own material; the cast colour
  // is stamped onto all of them when a new event arms.
  const mats = React.useMemo(() => Array.from({ length: MAX_CAST_TARGETS * 3 }, () =>
    new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    })), []);
  React.useEffect(() => () => mats.forEach(m => m.dispose()), [mats]);
  const shotRefs = React.useRef<(THREE.Mesh | null)[]>([]);
  const ringRefs = React.useRef<(THREE.Mesh | null)[]>([]);
  const colRefs = React.useRef<(THREE.Mesh | null)[]>([]);

  useFrame(({ clock }) => {
    if (s.start === -2) {
      s.start = clock.elapsedTime;
      mats.forEach(m => m.color.set(s.color));
    }
    const el = s.start >= 0 ? clock.elapsedTime - s.start : -1;
    for (let i = 0; i < MAX_CAST_TARGETS; i++) {
      const shot = shotRefs.current[i];
      if (shot) {
        const sp = s.shots[i];
        const t = sp ? (el - sp.delay) / sp.dur : -1;
        shot.visible = !!sp && t >= 0 && t <= 1;
        if (sp && shot.visible) {
          shot.position.lerpVectors(sp.from, sp.to, t);
          if (sp.lob) shot.position.y += 0.6 * 4 * t * (1 - t);
        }
      }
      const ring = ringRefs.current[i];
      const col = colRefs.current[i];
      const b = s.bursts[i];
      const bt = b ? (el - b.delay) / BURST_DUR : -1;
      const active = !!b && bt >= 0 && bt <= 1;
      if (ring) {
        ring.visible = active;
        if (b && active) {
          ring.position.set(b.at.x, b.at.y + 0.02, b.at.z);
          const k = 0.15 + bt * 0.5 * b.ring;
          ring.scale.setScalar(k / 0.3);
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - bt);
        }
      }
      if (col) {
        col.visible = active && b!.column > 0;
        if (b && col.visible) {
          const h = b.column * (0.3 + bt * 0.7);
          col.position.set(b.at.x, b.at.y + h / 2, b.at.z);
          col.scale.set(1, h, 1);
          (col.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - bt);
        }
      }
    }
  });

  return (
    <>
      {Array.from({ length: MAX_CAST_TARGETS }, (_, i) => (
        <React.Fragment key={i}>
          <mesh ref={m => { shotRefs.current[i] = m; }} visible={false} material={mats[i * 3]}>
            <sphereGeometry args={[0.07, 10, 8]} />
          </mesh>
          <mesh ref={m => { ringRefs.current[i] = m; }} visible={false} material={mats[i * 3 + 1]} rotation-x={-Math.PI / 2}>
            <ringGeometry args={[0.22, 0.3, 28]} />
          </mesh>
          <mesh ref={m => { colRefs.current[i] = m; }} visible={false} material={mats[i * 3 + 2]}>
            <cylinderGeometry args={[0.1, 0.16, 1, 10, 1, true]} />
          </mesh>
        </React.Fragment>
      ))}
    </>
  );
}

const GHOST_DURATION = 0.6;

/** Sink-and-fade animation shared by both ghost bodies. Reads the current
 *  model from a ref so glTF bodies that stream in late still fade. */
function useGhostFade(
  ref: React.RefObject<THREE.Group | null>,
  modelRef: React.MutableRefObject<THREE.Group | null>,
) {
  const startRef = React.useRef(-1);
  useFrame(({ clock }) => {
    if (startRef.current < 0) startRef.current = clock.elapsedTime;
    const t = Math.min(1, (clock.elapsedTime - startRef.current) / GHOST_DURATION);
    const g = ref.current;
    if (!g) return;
    g.visible = t < 1;
    g.position.y = 0.015 - t * 0.12;
    const fade = 0.9 * (1 - t);
    modelRef.current?.traverse(o => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).opacity = fade;
    });
  });
}

/** A killed unit's last body, fading out and sinking. No shadows, no clicks. */
function GhostUnit({ view, useModels }: { view: UnitView; useModels?: boolean }) {
  const glb = useModels && unitModelForKind(view.kind) != null;

  const boxModel = React.useMemo(() => {
    if (glb) return null;
    const m = buildUnit(defForKind(view.kind), view.teamColor);
    m.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = false;
        (o.material as THREE.Material).transparent = true;
      }
    });
    return m;
  }, [view, glb]);
  React.useEffect(() => () => { if (boxModel) disposeUnit(boxModel); }, [boxModel]);

  const ref = React.useRef<THREE.Group>(null);
  // The faded model: the box build immediately, or the GLB once it streams in
  // (GlbGhostModel clones its materials, so fading never dims living units).
  const modelRef = React.useRef<THREE.Group | null>(null);
  modelRef.current = boxModel ?? modelRef.current;
  const onGlbModel = React.useCallback((m: THREE.Group) => { modelRef.current = m; }, []);
  useGhostFade(ref, modelRef);

  return (
    <group
      position={[view.gridPos.x + 0.5, view.elevation ?? 0, view.gridPos.y + 0.5]}
      rotation-y={FACING_ROT_Y[view.facing]}
    >
      <group ref={ref}>
        {glb ? (
          <React.Suspense fallback={null}>
            <GlbGhostModel kind={view.kind} onModel={onGlbModel} />
          </React.Suspense>
        ) : (
          boxModel && <primitive object={boxModel} />
        )}
      </group>
    </group>
  );
}

export function Units({ units, ghosts, combat, ability, onTileClick, interaction, useModels }: {
  units: UnitView[];
  ghosts?: UnitGhost[];
  combat?: CombatFx | null;
  ability?: AbilityFx | null;
  onTileClick?: (x: number, y: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
  /** GEN 8 tileset mode: render real GLB unit models where available. */
  useModels?: boolean;
}) {
  // When the hit lands (shared by the defender's flash and the projectile):
  // melee at the lunge apex, ranged when the projectile arrives.
  const impactDelay = React.useMemo(() => {
    if (!combat) return 0;
    const attacker = units.find(u => u.id === combat.attackerId);
    const style = attackStyleFor(attacker?.kind ?? '');
    const dist = Math.hypot(
      combat.defenderPos.x - combat.attackerPos.x,
      combat.defenderPos.y - combat.attackerPos.y,
    );
    return impactDelayFor(style, dist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combat?.seq]);

  return (
    <>
      {units.map(u => (
        <UnitMesh key={u.id} unit={u} onTileClick={onTileClick} interaction={interaction} combat={combat} useModels={useModels} impactDelay={impactDelay} />
      ))}
      <CombatFxLayer combat={combat} units={units} />
      <AbilityFxLayer ability={ability} units={units} />
      {ghosts?.map(g => <GhostUnit key={g.ghostKey} view={g.view} useModels={useModels} />)}
    </>
  );
}
