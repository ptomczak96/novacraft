import * as THREE from 'three';
import React from 'react';
import { useFrame } from '@react-three/fiber';
import {
  EffectComposer, N8AO, Bloom, HueSaturation, BrightnessContrast, Vignette, Noise, Outline,
} from '@react-three/postprocessing';
import { useOutlineStore } from './outlineStore.js';

/**
 * postprocessing@6.39 under r3f: OutlineEffect's mask pass clears its target
 * WHITE via a ClearPass (the edge shader detects edges in the R channel, i.e.
 * against a white background) and then restores the previous clear color —
 * but r3f leaves `renderer.autoClear = true`, so the pass's scene render
 * immediately AUTO-clears again with the restored (black) color, wiping the
 * white background. Result: an empty edge buffer and a silently invisible
 * outline (verified by reading the mask target back: black background).
 * Fix: run the mask pass with autoClear off so its own ClearPass is the only
 * clear that happens.
 */
interface PatchableOutline {
  maskPass?: { render: (renderer: THREE.WebGLRenderer, ...rest: unknown[]) => void };
}
function patchOutlineClear(fx: PatchableOutline) {
  const mask = fx.maskPass;
  if (!mask) return;
  const orig = mask.render.bind(mask);
  mask.render = function (renderer: THREE.WebGLRenderer, ...rest: unknown[]) {
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    orig(renderer, ...rest);
    renderer.autoClear = prevAuto;
  };
}

/**
 * Post chain, in order: N8AO → Outline → Bloom → Vignette → Noise.
 * N8AO grounds units/blocks with contact occlusion (high tier only).
 * Outline draws the selected unit's screen-space silhouette (outer edge only —
 * see Units.tsx useSelectionOutline; inverted hulls bled through crevices).
 * Only surfaces with luminance > 1 (emissive strips, visors, lava) bloom.
 * Low quality: no AO, bloom at half resolution, film noise dropped.
 */
export function PostFX({ quality }: { quality: 'high' | 'low' }) {
  const selected = useOutlineStore(s => s.objects);
  // The Outline effect instance is recreated whenever its memo inputs change
  // (e.g. camera swap), so re-apply the clear patch whenever the ref moves.
  const outlineRef = React.useRef<InstanceType<typeof import('postprocessing').OutlineEffect> | null>(null);
  const patchedRef = React.useRef<object | null>(null);
  useFrame(() => {
    if (outlineRef.current && outlineRef.current !== patchedRef.current) {
      patchOutlineClear(outlineRef.current as unknown as PatchableOutline);
      patchedRef.current = outlineRef.current;
    }
  });
  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0}>
      {/* Contact occlusion so geometry sits on the floor. Low tier skips AO
          entirely — its low-tier answer is "off" (a high-tier luxury). */}
      {quality === 'high' ? (
        <N8AO aoRadius={0.4} intensity={3} distanceFalloff={0.4} halfRes />
      ) : (
        <></>
      )}
      {/* Mounted permanently (empty selection = no-op): swapping composer
          children on selection changes would rebuild every pass. */}
      <Outline
        ref={outlineRef}
        selection={selected}
        visibleEdgeColor={0x9dff8a}
        hiddenEdgeColor={0x2e5c2a}
        edgeStrength={12}
        xRay
      />
      <Bloom
        mipmapBlur
        luminanceThreshold={1.0}
        luminanceSmoothing={0.2}
        intensity={1.3}
        resolutionScale={quality === 'high' ? 1 : 0.5}
      />
      {/* Reference-style grade: push saturation and a touch of contrast. */}
      <HueSaturation saturation={0.16} />
      <BrightnessContrast brightness={0} contrast={0.06} />
      <Vignette offset={0.25} darkness={0.65} />
      {quality === 'high' ? <Noise opacity={0.022} /> : <></>}
    </EffectComposer>
  );
}
