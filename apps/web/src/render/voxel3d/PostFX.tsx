import React from 'react';
import {
  EffectComposer, N8AO, Bloom, HueSaturation, BrightnessContrast, Vignette, Noise,
} from '@react-three/postprocessing';

/**
 * Post chain, in order: N8AO → Bloom → Vignette → Noise.
 * N8AO grounds units/blocks with contact occlusion (high tier only).
 * Only surfaces with luminance > 1 (emissive strips, visors, lava) bloom.
 * Low quality: no AO, bloom at half resolution, film noise dropped.
 */
export function PostFX({ quality }: { quality: 'high' | 'low' }) {
  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0}>
      {quality === 'high' ? (
        <N8AO aoRadius={0.5} intensity={2.5} distanceFalloff={0.6} halfRes />
      ) : (
        <></>
      )}
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
