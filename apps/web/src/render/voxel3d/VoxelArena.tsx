import * as THREE from 'three';
import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import type { ArenaTheme, VoxelArenaProps } from './types.js';
import { BACKGROUND_COLOR } from './palette.js';
import { SpaceStars, FogClouds, FrameStats } from './Atmosphere.js';
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
      {/* Open space: near-black void, no atmospheric fog. */}
      <color attach="background" args={[BACKGROUND_COLOR]} />
      <CameraRig width={map.width} height={map.height} debugCam={debugCam} interaction={interaction} />
      <Lights width={map.width} height={map.height} theme={theme} />
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
      <SpaceStars width={map.width} height={map.height} quality={quality} />
      {quality === 'high' && (
        // Night IBL (Poly Haven, CC0, vendored) — subtle sheen on the floor
        // and units; lighting-only, never the background.
        <React.Suspense fallback={null}>
          <Environment files="/voxel3d/env_night.hdr" environmentIntensity={0.18} />
        </React.Suspense>
      )}
      <FrameStats quality={quality} />
      <PostFX quality={quality} />
    </Canvas>
  );
}
