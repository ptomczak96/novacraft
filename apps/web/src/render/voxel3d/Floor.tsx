import * as THREE from 'three';
import React from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import type { FloorTextures } from './types.js';
import { FLOOR_COLOR, GRID_LINE, GRID_LINE_BRIGHT } from './palette.js';
import { LAYER_NO_REFLECT } from './layers.js';
import { makeFloorRoughnessTexture } from './proceduralTextures.js';

/**
 * ONE reflector plane for the whole arena (never per-tile meshes). Tiles are
 * 1×1 world units, tile (x,y) centered at (x+0.5, 0, y+0.5), so the plane spans
 * [0..width]×[0..height]. Clicks raycast this plane and floor() to grid coords.
 */
export function Floor({ width, height, quality, floorTextures, onTileClick }: {
  width: number;
  height: number;
  quality: 'high' | 'low';
  floorTextures?: FloorTextures;
  onTileClick?: (x: number, y: number) => void;
}) {
  const roughnessMap = React.useMemo(
    () => floorTextures?.roughness ?? makeFloorRoughnessTexture(),
    [floorTextures?.roughness],
  );
  React.useMemo(() => {
    // Grime pattern spans ~8×8 tiles, then repeats across larger arenas.
    roughnessMap.repeat.set(width / 8, height / 8);
  }, [roughnessMap, width, height]);

  const handleClick = React.useCallback((e: ThreeEvent<MouseEvent>) => {
    if (!onTileClick) return;
    e.stopPropagation();
    const x = Math.min(width - 1, Math.max(0, Math.floor(e.point.x)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(e.point.z)));
    onTileClick(x, y);
  }, [onTileClick, width, height]);

  return (
    <>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[width / 2, 0, height / 2]}
        receiveShadow
        onClick={handleClick}
      >
        <planeGeometry args={[width, height]} />
        <MeshReflectorMaterial
          blur={[300, 100]}
          resolution={quality === 'high' ? 1024 : 512}
          mixBlur={1}
          mixStrength={2}
          roughness={0.7}
          metalness={0.4}
          mirror={0.5}
          depthScale={1.2}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color={FLOOR_COLOR}
          roughnessMap={roughnessMap}
          map={floorTextures?.albedo}
          normalMap={floorTextures?.normal}
        />
      </mesh>
      <GridOverlay width={width} height={height} />
    </>
  );
}

/**
 * Tile grid as a separate transparent quad floating 0.005 above the reflector
 * (never baked into the floor material). Excluded from the reflection pass.
 * Procedural shader: dim half-tile lines, brighter lines on every tile edge,
 * subtle glow falloff around the tile edges.
 */
function GridOverlay({ width, height }: { width: number; height: number }) {
  const meshRef = React.useRef<THREE.Mesh>(null);
  React.useLayoutEffect(() => {
    meshRef.current?.layers.set(LAYER_NO_REFLECT);
  }, []);

  const uniforms = React.useMemo(() => ({
    uSize: { value: new THREE.Vector2(width, height) },
    uLine: { value: new THREE.Color(GRID_LINE) },
    uLineBright: { value: new THREE.Color(GRID_LINE_BRIGHT) },
  }), [width, height]);

  return (
    <mesh
      ref={meshRef}
      rotation-x={-Math.PI / 2}
      position={[width / 2, 0.005, height / 2]}
    >
      <planeGeometry args={[width, height]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec2 uSize;
          uniform vec3 uLine;
          uniform vec3 uLineBright;
          varying vec2 vUv;

          // Antialiased distance-to-line mask for lines every 'step' units.
          float lineMask(vec2 coord, float step) {
            vec2 g = abs(fract(coord / step - 0.5) - 0.5) * step / fwidth(coord);
            return 1.0 - smoothstep(0.0, 1.2, min(g.x, g.y));
          }

          void main() {
            vec2 coord = vUv * uSize;
            float sub = lineMask(coord, 0.5);      // half-tile lines, dim
            float tile = lineMask(coord, 1.0);     // tile edges, brighter
            // Soft 1px-ish glow falloff around tile edges.
            vec2 gd = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
            float glow = exp(-min(gd.x, gd.y) * 0.9) * 0.25;
            vec3 col = uLine * sub * 0.5 + uLineBright * tile + uLineBright * glow;
            float alpha = max(tile, sub * 0.35) * 0.85 + glow;
            if (alpha < 0.01) discard;
            gl_FragColor = vec4(col, alpha);
          }
        `}
      />
    </mesh>
  );
}
