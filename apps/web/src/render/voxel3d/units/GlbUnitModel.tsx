import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import { MAX_FOOTPRINT, unitModelForKind } from '../models/modelAssets.js';
import { applyPixelTitanMaterials } from './pixelTitanMaterial.js';

/** Render-side motion state written by UnitMesh each frame; rigged models
 *  read it to choose their animation clip (walk / attack / idle). */
export interface UnitMotion {
  moving: boolean;
  attackSeq: number;
}

/**
 * Generic GLB unit body for the GEN 8 — 3D Tileset mode. Loads the kind's
 * model (see models/modelAssets.ts), scales it to the kind's target height
 * (heights deliberately differ per unit class), clamps the footprint so the
 * unit always fits inside one tile, and rests it base-down centered on the
 * tile origin — the parent UnitMesh group already sits at the tile center.
 *
 * Original baked materials/textures are kept (shared across clones, never
 * mutated); ownership reads from a team-colored glow ring at the base.
 */

/**
 * X/Z centre of the model's FEET — the bbox of only the vertices in the bottom
 * ~18% of the body. Centring on the full bbox lets a long sword or tail drag
 * the body off the tile centre; a unit stands where its feet are.
 */
function feetCenter(model: THREE.Group, box: THREE.Box3): { x: number; z: number } {
  const cutoff = box.min.y + (box.max.y - box.min.y) * 0.18;
  const fb = new THREE.Box3();
  const v = new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const stride = pos.count > 30000 ? 3 : 1; // bbox needs a sample, not every vert
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
      if (v.y <= cutoff) fb.expandByPoint(v);
    }
  });
  if (fb.isEmpty()) return { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 };
  return { x: (fb.min.x + fb.max.x) / 2, z: (fb.min.z + fb.max.z) / 2 };
}

function normalize(scene: THREE.Group, targetHeight: number, opts?: { cloneMaterials?: boolean }) {
  // SkeletonUtils.clone keeps skinned meshes bound to THEIR clone's skeleton —
  // a plain clone would leave every instance puppeting the shared source bones.
  const model = SkeletonUtils.clone(scene) as THREE.Group;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  let s = targetHeight / (size.y || 1);
  const foot = Math.max(size.x, size.z) || 1;
  // Never wider than a tile, whatever the model's proportions.
  if (foot * s > MAX_FOOTPRINT) s = MAX_FOOTPRINT / foot;
  model.scale.setScalar(s);
  const sb = new THREE.Box3().setFromObject(model);
  const feet = feetCenter(model, sb);
  model.position.set(-feet.x, -sb.min.y, -feet.z);
  model.traverse(o => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      // Animated skins move outside their bind-pose bounds; never cull them.
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
      if (opts?.cloneMaterials) {
        o.material = (o.material as THREE.Material).clone();
        (o.material as THREE.Material).transparent = true;
      }
    }
  });
  return { model, height: sb.max.y - sb.min.y };
}

/** Flyer idle: gentle bob around the hover height, phase-shifted per mount. */
function HoverBody({ hover, children }: { hover: number; children: React.ReactNode }) {
  const ref = React.useRef<THREE.Group>(null);
  const phase = React.useMemo(() => Math.random() * Math.PI * 2, []);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (g) g.position.y = hover + Math.sin(clock.elapsedTime * 1.7 + phase) * 0.045;
  });
  return <group ref={ref} position-y={hover}>{children}</group>;
}

export function GlbUnitModel({ kind, teamColor, motion }: {
  kind: string;
  teamColor: string;
  motion?: React.MutableRefObject<UnitMotion>;
}) {
  const def = unitModelForKind(kind);
  if (!def) throw new Error(`no GLB model registered for unit kind "${kind}"`);
  const { scene, animations } = useGLTF(def.url);
  const { model } = React.useMemo(() => normalize(scene, def.height), [scene, def]);
  // Opt-in comparison prototype: ?pixelTitan=1. Titan keeps its GLB rig and
  // clips, but receives a chunky stepped pixel-3D material. No shared source
  // material is mutated, so removing the query flag restores the current look.
  const pixelTitan = React.useMemo(
    () => def.pixelStyle === true && new URLSearchParams(window.location.search).get('pixelTitan') === '1',
    [def.pixelStyle],
  );
  React.useEffect(() => {
    if (!pixelTitan) return;
    return applyPixelTitanMaterials(model);
  }, [model, pixelTitan]);

  // ── Clip playback for rigged models (walk / attack / idle by name) ──
  const animRef = React.useRef<{
    mixer: THREE.AnimationMixer;
    clips: Record<string, THREE.AnimationAction>;
    mode: 'idle' | 'walk' | 'attack';
    attackSeq: number;
    current: THREE.AnimationAction | null;
  } | null>(null);

  React.useEffect(() => {
    if (!animations.length) { animRef.current = null; return; }
    const mixer = new THREE.AnimationMixer(model);
    const clips: Record<string, THREE.AnimationAction> = {};
    for (const c of animations) clips[c.name] = mixer.clipAction(c);
    const st = {
      mixer, clips, mode: 'idle' as 'idle' | 'walk' | 'attack',
      attackSeq: motion?.current.attackSeq ?? -1,
      current: null as THREE.AnimationAction | null,
    };
    if (clips.idle) { clips.idle.play(); st.current = clips.idle; }
    const onFinished = () => {
      // Attack finished → settle back to idle
      if (st.mode === 'attack') {
        st.mode = 'idle';
        if (clips.idle) {
          clips.idle.reset().fadeIn(0.15).play();
          st.current?.fadeOut(0.15);
          st.current = clips.idle;
        }
      }
    };
    mixer.addEventListener('finished', onFinished);
    animRef.current = st;
    return () => {
      mixer.removeEventListener('finished', onFinished);
      mixer.stopAllAction();
      animRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, animations]);

  useFrame((_, dt) => {
    const st = animRef.current;
    if (!st) return;
    const m = motion?.current;
    if (m) {
      const swap = (next: THREE.AnimationAction, mode: typeof st.mode, timeScale = 1) => {
        next.reset().setEffectiveTimeScale(timeScale).fadeIn(0.12).play();
        st.current?.fadeOut(0.12);
        st.current = next;
        st.mode = mode;
      };
      if (m.attackSeq !== st.attackSeq) {
        st.attackSeq = m.attackSeq;
        if (st.clips.attack) {
          st.clips.attack.setLoop(THREE.LoopOnce, 1);
          swap(st.clips.attack, 'attack', 1.4);
        }
      } else if (st.mode !== 'attack') {
        if (m.moving && st.mode !== 'walk' && st.clips.walk) {
          swap(st.clips.walk, 'walk', 2.0); // brisk stride for the short glide
        } else if (!m.moving && st.mode === 'walk' && st.clips.idle) {
          swap(st.clips.idle, 'idle');
        }
      }
    }
    st.mixer.update(dt);
  });

  const body = <primitive object={model} />;
  return (
    <group>
      {def.hover ? <HoverBody hover={def.hover}>{body}</HoverBody> : body}
      {/* Team allegiance ring at the model's feet (flyers: landing marker).
          noOutline: the selection silhouette should trace the body only. */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} userData={{ noOutline: true }}>
        <ringGeometry args={[0.3, 0.36, 40]} />
        <meshBasicMaterial
          color={teamColor}
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Ghost variant: materials are CLONED so the death fade can animate opacity
 * without dimming living units that share the same GLB. The parent GhostUnit
 * drives opacity via the ref'd model traversal, same contract as its box path.
 */
export function GlbGhostModel({ kind, onModel }: {
  kind: string;
  onModel: (model: THREE.Group) => void;
}) {
  const def = unitModelForKind(kind);
  if (!def) throw new Error(`no GLB model registered for unit kind "${kind}"`);
  const { scene } = useGLTF(def.url);
  const { model } = React.useMemo(() => {
    const n = normalize(scene, def.height, { cloneMaterials: true });
    n.model.traverse(o => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    return n;
  }, [scene, def]);
  React.useEffect(() => {
    onModel(model);
    return () => {
      model.traverse(o => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
      });
    };
  }, [model, onModel]);
  // Flyers die in the air; the ghost sinks from the hover height.
  return <group position-y={def.hover ?? 0}><primitive object={model} /></group>;
}
