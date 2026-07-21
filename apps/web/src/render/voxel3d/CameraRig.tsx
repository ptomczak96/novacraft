import * as THREE from 'three';
import React from 'react';
import { useThree } from '@react-three/fiber';
import { OrthographicCamera, OrbitControls } from '@react-three/drei';
import { LAYER_NO_REFLECT } from './layers.js';

/** Fraction of viewport height the arena should fill. */
const FIT_FRACTION = 0.7;
/** Head-room above the floor included in the fit (units, corner risers). */
const FIT_HEADROOM = 1.8;

/**
 * Dimetric game camera: orthographic, azimuth 45°, elevation ~35°
 * (position center + [d, d*0.82, d]). Zoom is fitted by projecting the arena
 * bounds through the camera and scaling to FIT_FRACTION of the viewport.
 * Game mode has no controls; `?debugCam=1` adds dev-only OrbitControls.
 */
export function CameraRig({ width, height, debugCam }: {
  width: number;
  height: number;
  debugCam: boolean;
}) {
  const camRef = React.useRef<THREE.OrthographicCamera>(null);
  const size = useThree(s => s.size);

  const cx = width / 2;
  const cz = height / 2;
  const d = Math.max(width, height) * 1.25;

  React.useLayoutEffect(() => {
    const cam = camRef.current;
    if (!cam) return;
    cam.layers.enable(LAYER_NO_REFLECT);
    // Set the frustum explicitly so the fit below is deterministic regardless of
    // effect ordering with r3f's own resize handling.
    cam.left = -size.width / 2;
    cam.right = size.width / 2;
    cam.top = size.height / 2;
    cam.bottom = -size.height / 2;
    cam.position.set(cx + d, d * 0.82, cz + d);
    cam.lookAt(cx, 0, cz);
    cam.zoom = 1;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    // Project the arena's bounding corners (floor + head-room) to NDC and fit.
    const v = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const px of [-1, width + 1]) {
      for (const pz of [-1, height + 1]) {
        for (const py of [0, FIT_HEADROOM]) {
          v.set(px, py, pz).project(cam);
          minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        }
      }
    }
    const zoomY = (2 * FIT_FRACTION) / (maxY - minY);
    const zoomX = (2 * 0.92) / (maxX - minX); // never overflow horizontally
    cam.zoom = Math.min(zoomY, zoomX);
    cam.updateProjectionMatrix();
  }, [cx, cz, d, width, height, size.width, size.height]);

  return (
    <>
      <OrthographicCamera ref={camRef} makeDefault near={0.1} far={500} />
      {debugCam && <OrbitControls target={[cx, 0, cz]} />}
    </>
  );
}
