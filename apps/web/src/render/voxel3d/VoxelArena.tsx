import * as THREE from 'three';
import React from 'react';
import { Canvas } from '@react-three/fiber';
import type { VoxelArenaProps } from './types.js';
import { BACKGROUND_COLOR } from './palette.js';
import { CameraRig } from './CameraRig.js';
import { Lights } from './Lights.js';
import { Floor } from './Floor.js';
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

  return (
    <Canvas
      shadows
      dpr={quality === 'low' ? [1, 1.5] : [1, 2]}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={[BACKGROUND_COLOR]} />
      <CameraRig width={map.width} height={map.height} debugCam={debugCam} />
      <Lights width={map.width} height={map.height} />
      <Floor
        width={map.width}
        height={map.height}
        quality={quality}
        floorTextures={floorTextures}
        onTileClick={onTileClick}
      />
      <Units units={units} />
      <PostFX quality={quality} />
    </Canvas>
  );
}
