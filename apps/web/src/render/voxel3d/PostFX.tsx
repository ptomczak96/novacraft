import React from 'react';
import {
  EffectComposer, N8AO, Bloom, HueSaturation, BrightnessContrast, Vignette, Noise,
  Pixelation,
} from '@react-three/postprocessing';

/**
 * Post chain, in order: N8AO → Bloom → Vignette → Noise.
 * N8AO grounds units/blocks with contact occlusion (high tier only).
 * Only surfaces with luminance > 1 (emissive strips, visors, lava) bloom.
 * Low quality: no AO, bloom at half resolution, film noise dropped.
 */
export function PostFX({ quality }: { quality: 'high' | 'low' }) {
  // Fat-pixel pass, last in the chain, so bloom/grade/neon all land on the
  // same chunky pixel grid — the reference frame's pixel-art look.
  // Granularity is in device pixels; override with ?pixel=N, disable ?pixel=0.
  const granularity = React.useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('pixel');
    if (raw === null) return 5;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }, []);

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
      {granularity >= 2 ? <Pixelation granularity={granularity} /> : <></>}
    </EffectComposer>
  );
}
