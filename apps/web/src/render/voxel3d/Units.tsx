import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import type { Facing, UnitView } from './types.js';
import type { CameraInteraction } from './CameraRig.js';
import { defForKind, isHeavyKind } from './units/unitDefs.js';
import { buildUnit, disposeUnit } from './units/buildUnit.js';
import { GltfUnit } from './units/GltfUnit.js';

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

/** Box-built fallback / heavy-mech body (shared with Suspense fallback). */
function BoxUnit({ unit }: { unit: UnitView }) {
  const model = React.useMemo(
    () => buildUnit(defForKind(unit.kind), unit.teamColor),
    [unit.kind, unit.teamColor],
  );
  React.useEffect(() => () => disposeUnit(model), [model]);
  return <primitive object={model} />;
}

function UnitMesh({ unit, onTileClick, interaction }: {
  unit: UnitView;
  onTileClick?: (x: number, y: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
}) {
  const bobRef = React.useRef<THREE.Group>(null);
  // Human-scale kinds use the vendored Kenney glTF characters; heavies keep
  // the box-built mech silhouette. Box fallback while a glb streams in.
  const useGltf = !isHeavyKind(unit.kind);

  // Idle bob: ±0.02 units, per-unit phase offset so a squad doesn't march in sync.
  const phase = (unit.id * 2.399) % (Math.PI * 2);
  useFrame(({ clock }) => {
    const g = bobRef.current;
    if (g) g.position.y = 0.015 + Math.sin(clock.elapsedTime * 2 + phase) * 0.02;
  });

  return (
    <group
      position={[unit.gridPos.x + 0.5, 0, unit.gridPos.y + 0.5]}
      rotation-y={FACING_ROT_Y[unit.facing]}
    >
      {unit.hostile && !useGltf && <ScanCone />}
      <group ref={bobRef}>
        {useGltf ? (
          <React.Suspense fallback={<BoxUnit unit={unit} />}>
            <GltfUnit kind={unit.kind} teamColor={unit.teamColor} />
          </React.Suspense>
        ) : (
          <BoxUnit unit={unit} />
        )}
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
