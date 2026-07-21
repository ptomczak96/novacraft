import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import type { Facing, UnitView } from './types.js';
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

function UnitMesh({ unit, onTileClick, interaction }: {
  unit: UnitView;
  onTileClick?: (x: number, y: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
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

  useFrame(({ clock }) => {
    const g = rootRef.current;
    if (!g) return;
    if (a.start === -2) a.start = clock.elapsedTime;
    if (a.start >= 0) {
      const t = Math.min(1, (clock.elapsedTime - a.start) / MOVE_DURATION);
      const e = t * t * (3 - 2 * t); // smoothstep ease
      a.x = a.fromX + (a.toX - a.fromX) * e;
      a.z = a.fromZ + (a.toZ - a.fromZ) * e;
      g.position.set(a.x, Math.sin(t * Math.PI) * 0.08, a.z);
      if (t >= 1) a.start = -1;
    } else {
      g.position.set(a.x, 0, a.z);
    }
  });

  return (
    <group
      ref={rootRef}
      position={[target.x, 0, target.z]}
      rotation-y={FACING_ROT_Y[unit.facing]}
    >
      {unit.hostile && isHeavyKind(unit.kind) && <ScanCone />}
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

export function Units({ units, onTileClick, interaction }: {
  units: UnitView[];
  onTileClick?: (x: number, y: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
}) {
  return (
    <>
      {units.map(u => (
        <UnitMesh key={u.id} unit={u} onTileClick={onTileClick} interaction={interaction} />
      ))}
    </>
  );
}
