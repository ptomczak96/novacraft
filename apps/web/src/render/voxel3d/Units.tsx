import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import type { CombatFx, Facing, UnitGhost, UnitView } from './types.js';
import type { CameraInteraction } from './CameraRig.js';
import { defForKind, isHeavyKind } from './units/unitDefs.js';
import { buildUnit, disposeUnit } from './units/buildUnit.js';
import { StalkerModel } from './units/StalkerModel.js';
import { GlbUnitModel, GlbGhostModel } from './units/GlbUnitModel.js';
import { unitModelForKind } from './models/modelAssets.js';

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

/** Flat light-green back-face material shared by all selection shells. */
const SHELL_MAT = new THREE.MeshBasicMaterial({
  color: '#9dff8a',
  side: THREE.BackSide,
  toneMapped: false,
});

/**
 * Polytopia-style selection rim: a slightly scaled-up back-face clone of the
 * unit's meshes, drawn behind the body so it reads as a bright edge around
 * the silhouette. Rebuilt shortly after mount to catch glTF bodies that
 * stream in via Suspense.
 */
function SelectionShell({ body }: { body: React.RefObject<THREE.Group | null> }) {
  const [shell, setShell] = React.useState<THREE.Group | null>(null);

  React.useEffect(() => {
    const build = () => {
      const src = body.current;
      if (!src) return;
      src.updateWorldMatrix(true, true);
      const srcInv = new THREE.Matrix4().copy(src.matrixWorld).invert();
      const group = new THREE.Group();
      src.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible) return;
        const clone = new THREE.Mesh(m.geometry, SHELL_MAT);
        clone.matrixAutoUpdate = false;
        clone.matrix.copy(srcInv).multiply(m.matrixWorld);
        group.add(clone);
      });
      group.scale.setScalar(1.06);
      setShell(group);
    };
    build();
    const t = setTimeout(build, 400);
    return () => {
      clearTimeout(t);
      setShell(null);
    };
  }, [body]);

  if (!shell) return null;
  return <primitive object={shell} />;
}

/** Seconds to slide one move (covers multi-tile moves in one glide). */
const MOVE_DURATION = 0.3;
const LUNGE_DURATION = 0.22;
const FLASH_DURATION = 0.3;

function UnitMesh({ unit, onTileClick, interaction, combat, useModels }: {
  unit: UnitView;
  onTileClick?: (x: number, y: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
  combat?: CombatFx | null;
  useModels?: boolean;
}) {
  const rootRef = React.useRef<THREE.Group>(null);
  const bodyRef = React.useRef<THREE.Group>(null);

  // Move animation: when the grid position changes, glide from the previous
  // world position to the new one with a slight hop. Units are otherwise
  // static (no idle bob).
  const off = unit.visualOffset ?? 0;
  const target = { x: unit.gridPos.x + 0.5 + off, z: unit.gridPos.y + 0.5 + off };
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
      <group position-y={0.015} ref={bodyRef}>
        {unit.selected && <SelectionShell body={bodyRef} />}
        <UnitBody unit={unit} useModels={useModels} />
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
      position={[view.gridPos.x + 0.5, 0, view.gridPos.y + 0.5]}
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

export function Units({ units, ghosts, combat, onTileClick, interaction, useModels }: {
  units: UnitView[];
  ghosts?: UnitGhost[];
  combat?: CombatFx | null;
  onTileClick?: (x: number, y: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
  /** GEN 8 tileset mode: render real GLB unit models where available. */
  useModels?: boolean;
}) {
  return (
    <>
      {units.map(u => (
        <UnitMesh key={u.id} unit={u} onTileClick={onTileClick} interaction={interaction} combat={combat} useModels={useModels} />
      ))}
      {ghosts?.map(g => <GhostUnit key={g.ghostKey} view={g.view} useModels={useModels} />)}
    </>
  );
}
