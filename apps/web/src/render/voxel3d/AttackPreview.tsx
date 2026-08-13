import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import type { PushPreview } from '../../game/attackPreview.js';

/**
 * Into-the-Breach-style outcome telegraphing, shown while HOVERING a legal
 * attack tile (or an armed Percussive Shells / Ram target):
 *  - dotted trajectory from attacker to target (arcing for lobbed weapons);
 *  - a pulsing reticle on the impact tile;
 *  - damage forecast over the defender, retaliation over the attacker,
 *    LETHAL emphasized;
 *  - push arrows on every unit the blast will shove, with the outcome at the
 *    arrow's head: clean slide, collide (-2, obstacle -2), or void death (×).
 * Pure presentation — every number comes from the engine's own preview
 * helpers (game/attackPreview.ts), so the telegraph can never lie.
 */

export interface AttackPreviewData {
  kind: 'attack' | 'percussive' | 'ram';
  attacker: { x: number; y: number };
  attackerElevation?: number;
  target: { x: number; y: number };
  trajectory: 'straight' | 'arc' | 'none';
  damage?: number;
  retaliation?: number;
  lethal?: boolean;
  attackerLethal?: boolean;
  centerDamage?: number | null;
  pushes?: PushPreview[];
}

const DOT_COUNT = 9;
const YELLOW = '#ffe14d';
const RED = '#ff2e3c';
const AMBER = '#ffb347';
const WHITE = '#f2f6ff';

/** Damage forecast badge — always faces the camera, drawn over everything. */
function DamageTag({ x, y, z, text, color, size = 0.22 }: {
  x: number; y: number; z: number; text: string; color: string; size?: number;
}) {
  return (
    <Billboard position={[x, y, z]}>
      <Text
        fontSize={size}
        color={color}
        outlineWidth={size * 0.14}
        outlineColor="#05070d"
        anchorX="center"
        anchorY="middle"
        renderOrder={1002}
        material-depthTest={false}
        material-toneMapped={false}
      >
        {text}
      </Text>
    </Billboard>
  );
}

/** Flat chevron arrow on the deck: victim tile → push destination. */
function PushArrow({ push }: { push: PushPreview }) {
  const ref = React.useRef<THREE.Group>(null);
  const { from, dir, outcome } = push;
  const yaw = Math.atan2(dir.dx, dir.dy);
  const geometry = React.useMemo(() => {
    // Chevron pointing +Z (push direction after yaw), sized inside a tile.
    const s = new THREE.Shape();
    s.moveTo(0, 0.34);
    s.lineTo(-0.2, 0.1);
    s.lineTo(-0.09, 0.1);
    s.lineTo(-0.09, -0.18);
    s.lineTo(0.09, -0.18);
    s.lineTo(0.09, 0.1);
    s.lineTo(0.2, 0.1);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  }, []);
  React.useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    // ITB-style nudge: the arrow pumps toward the push destination.
    const k = 0.1 + (Math.sin(clock.elapsedTime * 5) * 0.5 + 0.5) * 0.16;
    g.position.set(from.x + 0.5 + dir.dx * (0.28 + k), 0.04, from.y + 0.5 + dir.dy * (0.28 + k));
  });

  const color = outcome === 'void' ? RED : outcome === 'collide' ? AMBER : WHITE;
  return (
    <>
      <group ref={ref} rotation-y={yaw}>
        {/* rotation-x=+π/2 maps the shape's +Y onto world +Z, so the yaw
            (atan2(dx, dy) aiming +Z) points the chevron WITH the push. */}
        <mesh geometry={geometry} rotation-x={Math.PI / 2} renderOrder={1001}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.9}
            depthTest={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>
      {/* Outcome forecast at the pushed unit / obstacle. */}
      {outcome === 'collide' && (
        <DamageTag x={from.x + 0.5} y={0.95} z={from.y + 0.5} text={`-${push.damage}`} color={AMBER} />
      )}
      {outcome === 'collide' && push.obstacle && (
        <DamageTag x={push.dest.x + 0.5} y={0.95} z={push.dest.y + 0.5} text={`-${push.obstacle.damage}`} color={AMBER} />
      )}
      {outcome === 'void' && (
        <DamageTag x={push.dest.x + 0.5} y={0.6} z={push.dest.y + 0.5} text="×" color={RED} size={0.34} />
      )}
    </>
  );
}

export function AttackPreviewLayer({ preview }: { preview: AttackPreviewData | null }) {
  const dotsRef = React.useRef<THREE.InstancedMesh>(null);
  const reticleRef = React.useRef<THREE.Mesh>(null);
  const dummy = React.useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    const dots = dotsRef.current;
    if (dots) {
      if (preview && preview.trajectory !== 'none') {
        const from = new THREE.Vector3(
          preview.attacker.x + 0.5,
          0.55 + (preview.attackerElevation ?? 0),
          preview.attacker.y + 0.5,
        );
        const to = new THREE.Vector3(preview.target.x + 0.5, 0.35, preview.target.y + 0.5);
        const arc = preview.trajectory === 'arc'
          ? Math.max(0.5, from.distanceTo(to) * 0.28)
          : 0.08;
        const crawl = (clock.elapsedTime * 0.9) % (1 / DOT_COUNT);
        for (let i = 0; i < DOT_COUNT; i++) {
          const t = Math.min(0.985, (i + 0.5) / DOT_COUNT + crawl);
          dummy.position.lerpVectors(from, to, t);
          dummy.position.y += arc * 4 * t * (1 - t);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          dots.setMatrixAt(i, dummy.matrix);
        }
        dots.count = DOT_COUNT;
        dots.visible = true;
        dots.instanceMatrix.needsUpdate = true;
      } else {
        dots.visible = false;
      }
    }
    const ret = reticleRef.current;
    if (ret) {
      ret.visible = !!preview;
      if (preview) {
        ret.position.set(preview.target.x + 0.5, 0.035, preview.target.y + 0.5);
        const pulse = 1 + Math.sin(clock.elapsedTime * 6) * 0.08;
        ret.scale.setScalar(pulse);
      }
    }
  });

  return (
    <>
      {/* Warm-up: troika compiles its SDF font atlas on the first <Text>
          mount, which can stall a frame — pay that cost at scene load, not
          on the first hover. */}
      <Text fontSize={0.001} position={[0, -50, 0]} visible={false}>-0×</Text>

      {/* Trajectory dots (pooled; hidden when no preview). */}
      <instancedMesh ref={dotsRef} args={[undefined, undefined, DOT_COUNT]} visible={false} frustumCulled={false}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshBasicMaterial color={YELLOW} depthTest={false} toneMapped={false} transparent opacity={0.95} />
      </instancedMesh>

      {/* Impact reticle. */}
      <mesh ref={reticleRef} visible={false} rotation-x={-Math.PI / 2} renderOrder={1000}>
        <ringGeometry args={[0.3, 0.36, 32]} />
        <meshBasicMaterial color={RED} transparent opacity={0.85} depthTest={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>

      {preview && (
        <>
          {/* Damage over the defender; retaliation back at the attacker. */}
          {preview.damage != null && (
            <DamageTag
              x={preview.target.x + 0.5}
              y={1.05}
              z={preview.target.y + 0.5}
              text={preview.lethal ? `-${preview.damage} ×` : `-${preview.damage}`}
              color={RED}
              size={preview.lethal ? 0.27 : 0.22}
            />
          )}
          {preview.centerDamage != null && (
            <DamageTag x={preview.target.x + 0.5} y={1.05} z={preview.target.y + 0.5} text={`-${preview.centerDamage}`} color={RED} />
          )}
          {preview.retaliation != null && preview.retaliation > 0 && (
            <DamageTag
              x={preview.attacker.x + 0.5}
              y={1.05 + (preview.attackerElevation ?? 0)}
              z={preview.attacker.y + 0.5}
              text={preview.attackerLethal ? `-${preview.retaliation} ×` : `-${preview.retaliation}`}
              color={AMBER}
            />
          )}
          {preview.pushes?.map(p =>
            p.outcome === 'immune' ? null : <PushArrow key={p.unitId} push={p} />,
          )}
        </>
      )}
    </>
  );
}
