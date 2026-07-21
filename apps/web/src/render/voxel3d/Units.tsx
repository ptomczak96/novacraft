import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import type { Facing, UnitView } from './types.js';
import { defForKind } from './units/unitDefs.js';
import { buildUnit, disposeUnit } from './units/buildUnit.js';

/** Models are built facing +Z; rotate to the unit's grid facing. */
const FACING_ROT_Y: Record<Facing, number> = {
  se: Math.PI / 2,  // +x
  sw: 0,            // +y (world +z)
  nw: -Math.PI / 2, // -x
  ne: Math.PI,      // -y (world -z)
};

function UnitMesh({ unit }: { unit: UnitView }) {
  const bobRef = React.useRef<THREE.Group>(null);
  const model = React.useMemo(
    () => buildUnit(defForKind(unit.kind), unit.teamColor),
    [unit.kind, unit.teamColor],
  );
  React.useEffect(() => () => disposeUnit(model), [model]);

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
      <group ref={bobRef}>
        <primitive object={model} />
      </group>
    </group>
  );
}

export function Units({ units }: { units: UnitView[] }) {
  return (
    <>
      {units.map(u => <UnitMesh key={u.id} unit={u} />)}
    </>
  );
}
