import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import type { CombatFx, Facing, UnitGhost, UnitView } from './types.js';
import type { CameraInteraction } from './CameraRig.js';
import { defForKind, isHeavyKind } from './units/unitDefs.js';
import { buildUnit, disposeUnit } from './units/buildUnit.js';

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

/** Seconds to slide one move (covers multi-tile moves in one glide). */
const MOVE_DURATION = 0.3;
const LUNGE_DURATION = 0.22;
const FLASH_DURATION = 0.3;

function UnitMesh({ unit, onTileClick, interaction, combat }: {
  unit: UnitView;
  onTileClick?: (x: number, y: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
  combat?: CombatFx | null;
}) {
  const rootRef = React.useRef<THREE.Group>(null);

  // Move animation: when the grid position changes, glide from the previous
  // world position to the new one with a slight hop. Units are otherwise
  // static (no idle bob).
  const target = { x: unit.gridPos.x + 0.5, z: unit.gridPos.y + 0.5 };
  const animRef = React.useRef({
    x: target.x, z: target.z,          // current rendered position
    fromX: target.x, fromZ: target.z,
    toX: target.x, toZ: target.z,
    start: -1,                          // -1 = idle
  });
  const a = animRef.current;
  if (a.toX !== target.x || a.toZ !== target.z) {
    a.fromX = a.x;
    a.fromZ = a.z;
    a.toX = target.x;
    a.toZ = target.z;
    a.start = -2; // armed; stamped with clock time on the next frame
  }

  // Combat effects: attacker lunges toward the target, defender flashes.
  const flashRef = React.useRef<THREE.Mesh>(null);
  const fxRef = React.useRef({ seq: -1, lungeStart: -1, flashStart: -1, dirX: 0, dirZ: 0 });
  const fx = fxRef.current;
  if (combat && combat.seq !== fx.seq) {
    fx.seq = combat.seq;
    if (combat.attackerId === unit.id) {
      const dx = combat.defenderPos.x - combat.attackerPos.x;
      const dz = combat.defenderPos.y - combat.attackerPos.y;
      const len = Math.hypot(dx, dz) || 1;
      fx.dirX = dx / len;
      fx.dirZ = dz / len;
      fx.lungeStart = -2;
    } else if (combat.defenderId === unit.id) {
      fx.flashStart = -2;
    }
  }

  useFrame(({ clock }) => {
    const g = rootRef.current;
    if (!g) return;
    if (a.start === -2) a.start = clock.elapsedTime;
    if (fx.lungeStart === -2) fx.lungeStart = clock.elapsedTime;
    if (fx.flashStart === -2) fx.flashStart = clock.elapsedTime;

    let y = 0;
    if (a.start >= 0) {
      const t = Math.min(1, (clock.elapsedTime - a.start) / MOVE_DURATION);
      const e = t * t * (3 - 2 * t); // smoothstep ease
      a.x = a.fromX + (a.toX - a.fromX) * e;
      a.z = a.fromZ + (a.toZ - a.fromZ) * e;
      y = Math.sin(t * Math.PI) * 0.08;
      if (t >= 1) a.start = -1;
    }
    // Lunge: quick out-and-back thrust toward the defender.
    let lx = 0, lz = 0;
    if (fx.lungeStart >= 0) {
      const t = Math.min(1, (clock.elapsedTime - fx.lungeStart) / LUNGE_DURATION);
      const k = Math.sin(t * Math.PI) * 0.32;
      lx = fx.dirX * k;
      lz = fx.dirZ * k;
      if (t >= 1) fx.lungeStart = -1;
    }
    g.position.set(a.x + lx, y, a.z + lz);

    // Hit flash: additive red shell that pops and decays.
    const f = flashRef.current;
    if (f) {
      if (fx.flashStart >= 0) {
        const t = Math.min(1, (clock.elapsedTime - fx.flashStart) / FLASH_DURATION);
        f.visible = t < 1;
        (f.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
        if (t >= 1) fx.flashStart = -1;
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
      <group position-y={0.015}>
        <BoxUnit unit={unit} />
        {/* Invisible collider: clicking a unit's body must resolve to ITS tile,
            not the tile the ray would hit on the floor behind it. */}
        {onTileClick && (
          <mesh
            visible={false}
            position={[0, 0.5, 0]}
            onClick={e => {
              if (interaction?.current.suppressClick) return; // grab-pan release
              e.stopPropagation();
              onTileClick(unit.gridPos.x, unit.gridPos.y);
            }}
          >
            <boxGeometry args={[0.7, 1.05, 0.7]} />
          </mesh>
        )}
      </group>
    </group>
  );
}

const GHOST_DURATION = 0.6;

/** A killed unit's last body, fading out and sinking. No shadows, no clicks. */
function GhostUnit({ view }: { view: UnitView }) {
  const model = React.useMemo(() => {
    const m = buildUnit(defForKind(view.kind), view.teamColor);
    m.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = false;
        (o.material as THREE.Material).transparent = true;
      }
    });
    return m;
  }, [view]);
  React.useEffect(() => () => disposeUnit(model), [model]);

  const ref = React.useRef<THREE.Group>(null);
  const startRef = React.useRef(-1);
  useFrame(({ clock }) => {
    if (startRef.current < 0) startRef.current = clock.elapsedTime;
    const t = Math.min(1, (clock.elapsedTime - startRef.current) / GHOST_DURATION);
    const g = ref.current;
    if (!g) return;
    g.visible = t < 1;
    g.position.y = 0.015 - t * 0.12;
    const fade = 0.9 * (1 - t);
    model.traverse(o => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).opacity = fade;
    });
  });

  return (
    <group
      position={[view.gridPos.x + 0.5, 0, view.gridPos.y + 0.5]}
      rotation-y={FACING_ROT_Y[view.facing]}
    >
      <group ref={ref}>
        <primitive object={model} />
      </group>
    </group>
  );
}

export function Units({ units, ghosts, combat, onTileClick, interaction }: {
  units: UnitView[];
  ghosts?: UnitGhost[];
  combat?: CombatFx | null;
  onTileClick?: (x: number, y: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
}) {
  return (
    <>
      {units.map(u => (
        <UnitMesh key={u.id} unit={u} onTileClick={onTileClick} interaction={interaction} combat={combat} />
      ))}
      {ghosts?.map(g => <GhostUnit key={g.ghostKey} view={g.view} />)}
    </>
  );
}
