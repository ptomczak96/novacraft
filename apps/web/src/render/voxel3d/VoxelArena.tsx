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
import { ModelTiles } from './models/ModelTiles.js';
import { TilesetFX } from './models/TilesetFX.js';
import { MOUNTAIN_UNIT_ELEVATION } from './models/modelAssets.js';
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
  ability,
  ghosts,
  tileset = false,
}: VoxelArenaProps) {
  const debugCam = React.useMemo(
    () => new URLSearchParams(window.location.search).get('debugCam') === '1',
    [],
  );

  // Shared with CameraRig: a grab-pan drag must not fire a tile click on release.
  const interaction = React.useRef<CameraInteraction>({ suppressClick: false });


  // Opening camera focus: the player's starting units (captured once per map).
  const focus = React.useMemo<[number, number] | null>(() => {
    const friendly = units.filter(u => !u.hostile);
    if (friendly.length === 0) return null;
    const ax = friendly.reduce((s2, u) => s2 + u.gridPos.x, 0) / friendly.length;
    const ay = friendly.reduce((s2, u) => s2 + u.gridPos.y, 0) / friendly.length;
    return [ax + 0.5, ay + 0.5];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

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

  // Garrisoned units shift slightly toward the camera so they stand clear of
  // their (centred) city tower. In tileset mode, units on mountain tiles are
  // lifted onto the rock top so they never merge into the tile's geometry.
  const adjustedUnits = React.useMemo(
    () => units.map(u => {
      const tile = map.tiles[u.gridPos.y]?.[u.gridPos.x];
      if (tile?.isCity) return { ...u, visualOffset: 0.18 };
      if (tileset && tile?.terrain === 'mountain') return { ...u, elevation: MOUNTAIN_UNIT_ELEVATION };
      return u;
    }),
    [units, map, tileset],
  );

  // Tiles occupied by a unit — forest blocks swap to flat ground under them
  // (Polytopia-style) so trees never clip through a unit's body.
  const occupied = React.useMemo(() => {
    if (!tileset) return undefined;
    return new Set(units.map(u => `${u.gridPos.x},${u.gridPos.y}`));
  }, [tileset, units]);

  // Impassable terrain renders as holes in the platform (SC1 space-platform
  // style): no floor tile, space visible through the gap.
  const holes = React.useMemo(() => {
    return map.tiles.map(row => row.map(t => t.terrain === 'water' || t.terrain === 'lava'));
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
      <CameraRig width={map.width} height={map.height} debugCam={debugCam} interaction={interaction} focus={focus} />
      <Lights width={map.width} height={map.height} theme={theme} quality={quality} tileset={tileset} />
      <React.Suspense fallback={null}>
        {tileset ? (
          // GEN 8 — 3D Tileset: GLB tile blocks ARE the board (flat / forest /
          // mountain / water); no reflector floor, no hole-cutting.
          <>
            <ModelTiles
              map={map}
              visibility={visibility}
              onTileClick={onTileClick}
              interaction={interaction}
              occupied={occupied}
            />
            <TilesetFX map={map} visibility={visibility} quality={quality} />
          </>
        ) : (
          <Floor
            width={map.width}
            height={map.height}
            quality={quality}
            floorTextures={floorTextures}
            onTileClick={onTileClick}
            interaction={interaction}
            theme={theme}
            holes={holes}
          />
        )}
      </React.Suspense>
      {/* No platform frame in tileset mode — the GLB tiles ARE the island edge. */}
      {!tileset && <EdgeRim width={map.width} height={map.height} theme={theme} />}
      <TerrainBlocks map={map} visibility={visibility} theme={theme} natureProps={!tileset} />
      <Highlights highlights={highlights} />
      <Units units={adjustedUnits} ghosts={ghosts} combat={combat} ability={ability} onTileClick={onTileClick} interaction={interaction} useModels={tileset} />
      <FogClouds map={map} visibility={visibility} theme={theme} />
      <SpaceStars width={map.width} height={map.height} quality={quality} />
      {quality === 'high' && (
        // Night IBL (Poly Haven, CC0, vendored) — subtle sheen; lighting-only.
        <React.Suspense fallback={null}>
          <Environment files="/voxel3d/env_night.hdr" environmentIntensity={0.18} />
        </React.Suspense>
      )}
      <FrameStats quality={quality} />
      <PostFX quality={quality} />
    </Canvas>
  );
}
