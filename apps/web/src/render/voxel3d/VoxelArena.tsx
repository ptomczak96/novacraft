import * as THREE from 'three';
import React from 'react';
import { Canvas } from '@react-three/fiber';
import type { VoxelArenaProps } from './types.js';
import { BACKGROUND_COLOR, NEON_CYAN } from './palette.js';
import { CameraRig } from './CameraRig.js';
import { PostFX } from './PostFX.js';

/** Milestone 1 pipeline proof: one emissive cube at arena center must bloom. */
function TestCube({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x, 0.5, z]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="#0a0a0a"
        emissive={NEON_CYAN}
        emissiveIntensity={4}
      />
    </mesh>
  );
}

export function VoxelArena({
  map,
  units,
  highlights,
  quality = 'high',
  onTileClick,
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
      <ambientLight color="#4a3a6b" intensity={0.5} />
      <TestCube x={map.width / 2} z={map.height / 2} />
      <PostFX quality={quality} />
    </Canvas>
  );
}
