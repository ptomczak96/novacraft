import * as THREE from 'three';
import React from 'react';
import { useLoader, type ThreeEvent } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import type { ArenaTheme, FloorTextures } from './types.js';
import type { CameraInteraction } from './CameraRig.js';
import { GRID_LINE, GRID_LINE_BRIGHT } from './palette.js';
import { LAYER_NO_REFLECT } from './layers.js';
import { makeFloorPlateTextures } from './proceduralTextures.js';

/**
 * ONE reflector plane for the whole arena (never per-tile meshes). Tiles are
 * 1×1 world units, tile (x,y) centered at (x+0.5, 0, y+0.5), so the plane spans
 * [0..width]×[0..height]. Clicks raycast this plane and floor() to grid coords.
 */
export function Floor({ width, height, quality, floorTextures, onTileClick, interaction, theme = 'city' }: {
  width: number;
  height: number;
  quality: 'high' | 'low';
  floorTextures?: FloorTextures;
  onTileClick?: (x: number, y: number) => void;
  interaction?: React.MutableRefObject<CameraInteraction>;
  theme?: ArenaTheme;
}) {
  // Worn metal plates, one per tile, baked into albedo+roughness (1:1 UV over
  // the arena). Hand-authored maps via floorTextures take precedence.
  const plates = React.useMemo(
    () => makeFloorPlateTextures(width, height, 99, theme, quality),
    [width, height, theme, quality],
  );
  const albedoMap = floorTextures?.albedo ?? plates.albedo;
  const roughnessMap = floorTextures?.roughness ?? plates.roughness;

  // Physical micro-relief: ambientCG MetalPlates006 normal map (CC0, vendored),
  // tiled one plate per tile so bolts/ridges align with the grid. City only —
  // the diamond-plate relief reads as a metal grate, which is wrong on sand.
  const defaultNormal = useLoader(THREE.TextureLoader, '/voxel3d/floor_normal.jpg');
  React.useMemo(() => {
    defaultNormal.wrapS = defaultNormal.wrapT = THREE.RepeatWrapping;
    defaultNormal.repeat.set(width, height);
  }, [defaultNormal, width, height]);
  const normalMap = floorTextures?.normal ?? (theme === 'city' ? defaultNormal : undefined);

  const handleClick = React.useCallback((e: ThreeEvent<MouseEvent>) => {
    if (!onTileClick) return;
    if (interaction?.current.suppressClick) return; // release of a grab-pan
    e.stopPropagation();
    const x = Math.min(width - 1, Math.max(0, Math.floor(e.point.x)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(e.point.z)));
    onTileClick(x, y);
  }, [onTileClick, width, height, interaction]);

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
          // blur kept moderate so reflected strips/units stay identifiable;
          // the roughnessMap modulates blurFactor per-pixel (puddles sharp,
          // grime fully blurred — drei's shader multiplies roughness × map.g).
          blur={[200, 80]}
          resolution={quality === 'high' ? 1024 : 512}
          mixBlur={1.6}
          mixStrength={4}
          roughness={0.7}
          metalness={theme === 'desert' ? 0.1 : 0.2}
          mirror={0.7}
          depthScale={1.2}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          // Near-white multiplier: the generated albedo carries the value; a
          // dark tint here multiplies the reflection toward nothing.
          color={theme === 'desert' ? '#e6d9bf' : '#dfe5f0'}
          roughnessMap={roughnessMap}
          map={albedoMap}
          normalMap={normalMap}
          normalScale={new THREE.Vector2(0.35, 0.35)}
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
            // Bright seam lines like the reference floor, plus faint half-tile
            // sub-grid; the baked plate seams add the dark gap underneath.
            vec3 col = uLine * sub * 0.35 + uLineBright * tile * 0.95 + uLineBright * glow * 0.6;
            float alpha = max(tile * 0.8, sub * 0.25) + glow * 0.55;
            if (alpha < 0.01) discard;
            gl_FragColor = vec4(col, alpha);
          }
        `}
      />
    </mesh>
  );
}
