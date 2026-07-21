import * as THREE from 'three';
import React from 'react';
import { Canvas } from '@react-three/fiber';
import type { VoxelArenaProps } from './types.js';
import { BACKGROUND_COLOR, FOG_COLOR } from './palette.js';
import { CityCards, Rain, FogClouds, DustMotes, FrameStats } from './Atmosphere.js';
import { CameraRig } from './CameraRig.js';
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
}: VoxelArenaProps) {
  const debugCam = React.useMemo(
    () => new URLSearchParams(window.location.search).get('debugCam') === '1',
    [],
  );

  // Fog tuned so the arena stays clear and the background city softens: it
  // starts just past the arena's far edge as seen by the fixed camera.
  const [fogNear, fogFar] = React.useMemo(() => {
    const d = Math.max(map.width, map.height) * 1.25;
    const camDist = d * Math.sqrt(1 + 0.82 * 0.82 + 1);
    const diag = Math.hypot(map.width, map.height);
    const near = camDist + diag * 0.55;
    return [near, near + 55];
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
      <color attach="background" args={[BACKGROUND_COLOR]} />
      <fog attach="fog" args={[FOG_COLOR, fogNear, fogFar]} />
      <CameraRig width={map.width} height={map.height} debugCam={debugCam} />
      <Lights width={map.width} height={map.height} />
      <Floor
        width={map.width}
        height={map.height}
        quality={quality}
        floorTextures={floorTextures}
        onTileClick={onTileClick}
      />
      <EdgeRim width={map.width} height={map.height} />
      <TerrainBlocks map={map} visibility={visibility} />
      <Highlights highlights={highlights} />
      <Units units={units} onTileClick={onTileClick} />
      <FogClouds map={map} visibility={visibility} />
      {quality === 'high' && (
        <>
          <CityCards width={map.width} height={map.height} />
          <Rain width={map.width} height={map.height} />
          <DustMotes width={map.width} height={map.height} />
        </>
      )}
      <FrameStats quality={quality} />
      <PostFX quality={quality} />
    </Canvas>
  );
}
