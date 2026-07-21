import * as THREE from 'three';
import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import type { ArenaTheme, VoxelArenaProps } from './types.js';
import { BACKGROUND_COLOR, FOG_COLOR } from './palette.js';
import { CityBlocks, HazeLayers, Bokeh, Rain, FogClouds, DustMotes, FrameStats } from './Atmosphere.js';
import { Signage } from './Signage.js';
import { CameraRig, type CameraInteraction } from './CameraRig.js';
import { Lights } from './Lights.js';
import { Floor } from './Floor.js';
import { EdgeRim } from './EdgeRim.js';
import { TerrainBlocks } from './TerrainBlocks.js';
import { Highlights } from './Highlights.js';
import { Units } from './Units.js';
import { PostFX } from './PostFX.js';

export function VoxelArena({
  map,
  units,
  highlights,
  quality = 'high',
  onTileClick,
  visibility,
  floorTextures,
  combat,
  ghosts,
}: VoxelArenaProps) {
  const debugCam = React.useMemo(
    () => new URLSearchParams(window.location.search).get('debugCam') === '1',
    [],
  );

  // Shared with CameraRig: a grab-pan drag must not fire a tile click on release.
  const interaction = React.useRef<CameraInteraction>({ suppressClick: false });

  // Visual theme, detected from the map's dominant terrain (works for both
  // generated desert-biome maps and hand-built editor maps).
  const theme = React.useMemo<ArenaTheme>(() => {
    let sand = 0, total = 0;
    for (const row of map.tiles) {
      for (const tile of row) {
        total++;
        if (tile.terrain === 'sand') sand++;
      }
    }
    return total > 0 && sand / total > 0.3 ? 'desert' : 'city';
  }, [map]);

  // Fog tuned so the arena stays clear and the background city softens: it
  // starts just past the arena's far edge as seen by the fixed camera.
  const [fogNear, fogFar] = React.useMemo(() => {
    const d = Math.max(map.width, map.height) * 1.25;
    const camDist = d * Math.sqrt(1 + 0.82 * 0.82 + 1);
    const diag = Math.hypot(map.width, map.height);
    const near = camDist + diag * 0.55;
    return [near, near + 38];
  }, [map.width, map.height]);

  return (
    <Canvas
      shadows
      dpr={quality === 'low' ? [1, 1.5] : [1, 2]}
      // preserveDrawingBuffer only in dev: lets tooling read the canvas for
      // screenshots; never enabled in production builds (costs performance).
      gl={{ antialias: true, preserveDrawingBuffer: import.meta.env.DEV }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={[theme === 'desert' ? '#241628' : BACKGROUND_COLOR]} />
      <fog attach="fog" args={[theme === 'desert' ? '#3a2145' : FOG_COLOR, fogNear, fogFar]} />
      <CameraRig width={map.width} height={map.height} debugCam={debugCam} interaction={interaction} />
      <Lights width={map.width} height={map.height} theme={theme} quality={quality} />
      <React.Suspense fallback={null}>
        <Floor
          width={map.width}
          height={map.height}
          quality={quality}
          floorTextures={floorTextures}
          onTileClick={onTileClick}
          interaction={interaction}
          theme={theme}
        />
      </React.Suspense>
      <EdgeRim width={map.width} height={map.height} theme={theme} />
      <TerrainBlocks map={map} visibility={visibility} theme={theme} />
      <Highlights highlights={highlights} />
      <Units units={units} ghosts={ghosts} combat={combat} onTileClick={onTileClick} interaction={interaction} />
      <FogClouds map={map} visibility={visibility} theme={theme} />
      {quality === 'high' && (
        <>
          {/* Night-city IBL (Poly Haven, CC0, vendored) — subtle sheen on the
              metal floor and units; lighting-only, never the background. */}
          <React.Suspense fallback={null}>
            <Environment files="/voxel3d/env_night.hdr" environmentIntensity={0.18} />
          </React.Suspense>
          <HazeLayers width={map.width} height={map.height} theme={theme} />
          <CityBlocks width={map.width} height={map.height} theme={theme} />
          {/* City-only: window bokeh, neon signage, rain. The desert horizon
              is buttes + two radio masts; dust carries its atmosphere. */}
          {theme === 'city' && (
            <>
              <Bokeh width={map.width} height={map.height} />
              <Signage width={map.width} height={map.height} />
              <Rain width={map.width} height={map.height} />
            </>
          )}
          <DustMotes width={map.width} height={map.height} theme={theme} />
        </>
      )}
      <FrameStats quality={quality} />
      <PostFX quality={quality} />
    </Canvas>
  );
}
