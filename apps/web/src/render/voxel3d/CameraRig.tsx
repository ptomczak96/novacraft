import * as THREE from 'three';
import React from 'react';
import { useThree } from '@react-three/fiber';
import { OrthographicCamera, OrbitControls } from '@react-three/drei';
import { LAYER_NO_REFLECT } from './layers.js';

/** Fraction of viewport height the arena would fill at fit zoom. */
const FIT_FRACTION = 0.7;
/** Head-room above the floor included in the fit (units, corner risers). */
const FIT_HEADROOM = 1.8;
/** Initial zoom relative to the fitted view (4 = large, board-filling tiles). */
const DEFAULT_ZOOM_FACTOR = 4;
const MIN_ZOOM_FACTOR = 0.6;
const MAX_ZOOM_FACTOR = 6;
/** Pixels of pointer travel before a press counts as a drag, not a click. */
const DRAG_THRESHOLD_PX = 5;

/** Shared with Floor/Units so a drag-pan doesn't fire a tile click on release. */
export interface CameraInteraction {
  suppressClick: boolean;
}

/**
 * Dimetric game camera: orthographic, azimuth 45°, elevation ~35°. Starts
 * zoomed well past the fitted view; left-drag grab-pans the arena and the wheel zooms
 * toward the cursor. Orientation is always fixed — panning translates the
 * camera in its own screen plane. `?debugCam=1` swaps in OrbitControls.
 */
export function CameraRig({ width, height, debugCam, interaction, focus }: {
  width: number;
  height: number;
  debugCam: boolean;
  interaction?: React.MutableRefObject<CameraInteraction>;
  /** World x/z to centre the initial (zoomed) view on — e.g. the player's
   *  starting units, so a new game doesn't open staring at mid-board fog. */
  focus?: [number, number] | null;
}) {
  const camRef = React.useRef<THREE.OrthographicCamera>(null);
  const size = useThree(s => s.size);
  const gl = useThree(s => s.gl);

  // ?campos=default: fixed comparison framing (fit zoom, no pan, input
  // disabled) so before/after screenshots are pixel-comparable.
  const fixedCam = React.useMemo(
    () => new URLSearchParams(window.location.search).get('campos') === 'default',
    [],
  );

  const cx = width / 2;
  const cz = height / 2;
  const d = Math.max(width, height) * 1.25;

  // View state relative to the fitted framing: world-space pan offset in the
  // camera's screen plane + zoom factor. Kept in a ref so pointer events can
  // mutate it without re-rendering React.
  const viewRef = React.useRef({
    pan: new THREE.Vector3(),
    zoomFactor: DEFAULT_ZOOM_FACTOR,
    fitZoom: 1,
    basePos: new THREE.Vector3(),
  });

  // New arena → reset pan/zoom and re-apply the initial focus.
  const pendingFocusRef = React.useRef<[number, number] | null>(null);
  React.useMemo(() => {
    viewRef.current.pan.set(0, 0, 0);
    viewRef.current.zoomFactor = fixedCam ? 1 : DEFAULT_ZOOM_FACTOR;
    pendingFocusRef.current = fixedCam ? null : (focus ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, fixedCam]);

  const applyView = React.useCallback(() => {
    const cam = camRef.current;
    if (!cam) return;
    const v = viewRef.current;
    cam.position.copy(v.basePos).add(v.pan);
    cam.zoom = v.fitZoom * v.zoomFactor;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }, []);

  React.useLayoutEffect(() => {
    const cam = camRef.current;
    if (!cam) return;
    cam.layers.enable(LAYER_NO_REFLECT);
    cam.left = -size.width / 2;
    cam.right = size.width / 2;
    cam.top = size.height / 2;
    cam.bottom = -size.height / 2;
    cam.position.set(cx + d, d * 0.82, cz + d);
    cam.lookAt(cx, 0, cz);
    cam.zoom = 1;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    // Fit: project the arena's bounding corners (floor + head-room) to NDC.
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
    const zoomX = (2 * 0.92) / (maxX - minX);
    viewRef.current.fitZoom = Math.min(zoomY, zoomX);
    viewRef.current.basePos.set(cx + d, d * 0.82, cz + d);
    // Centre the opening view on the focus point (project the offset into the
    // camera plane — the view-direction component doesn't affect framing).
    const pf = pendingFocusRef.current;
    if (pf) {
      pendingFocusRef.current = null;
      const delta = new THREE.Vector3(pf[0] - cx, 0, pf[1] - cz);
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const upS = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      viewRef.current.pan
        .set(0, 0, 0)
        .addScaledVector(right, delta.dot(right))
        .addScaledVector(upS, delta.dot(upS));
    }
    applyView();
  }, [cx, cz, d, width, height, size.width, size.height, applyView]);

  // Grab-pan + wheel-zoom on the canvas (game mode only; OrbitControls owns
  // the pointer when debugCam is active).
  React.useEffect(() => {
    if (debugCam || fixedCam) return;
    const el = gl.domElement;
    const maxPan = Math.max(width, height) * 1.1;
    let down = false;
    let lastX = 0, lastY = 0, travelled = 0;
    const right = new THREE.Vector3();
    const upS = new THREE.Vector3();

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      down = true;
      travelled = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      if (interaction) interaction.current.suppressClick = false;
      el.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!down) return;
      const cam = camRef.current;
      if (!cam) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      travelled += Math.abs(dx) + Math.abs(dy);
      if (travelled > DRAG_THRESHOLD_PX) {
        if (interaction) interaction.current.suppressClick = true;
        el.style.cursor = 'grabbing';
      }
      // Screen axes in world space; ortho: 1 px = 1/zoom world units.
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      upS.setFromMatrixColumn(cam.matrixWorld, 1);
      const wpp = 1 / cam.zoom;
      const pan = viewRef.current.pan;
      pan.addScaledVector(right, -dx * wpp);
      pan.addScaledVector(upS, dy * wpp);
      pan.clampLength(0, maxPan);
      applyView();
    };
    const onPointerUp = () => {
      down = false;
      el.style.cursor = 'grab';
      // suppressClick stays set so the click event that follows this release
      // is ignored; the next pointerdown clears it.
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camRef.current;
      if (!cam) return;
      const v = viewRef.current;
      const oldZoom = v.fitZoom * v.zoomFactor;
      v.zoomFactor = THREE.MathUtils.clamp(
        v.zoomFactor * Math.exp(-e.deltaY * 0.0012),
        MIN_ZOOM_FACTOR,
        MAX_ZOOM_FACTOR,
      );
      const newZoom = v.fitZoom * v.zoomFactor;
      // Zoom toward the cursor: keep the world point under it fixed.
      const rect = el.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      const shift = 1 / oldZoom - 1 / newZoom;
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      upS.setFromMatrixColumn(cam.matrixWorld, 1);
      v.pan.addScaledVector(right, ndcX * (size.width / 2) * shift);
      v.pan.addScaledVector(upS, ndcY * (size.height / 2) * shift);
      v.pan.clampLength(0, maxPan);
      applyView();
    };

    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointerleave', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointerleave', onPointerUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [debugCam, fixedCam, gl, width, height, size.width, size.height, applyView, interaction]);

  return (
    <>
      <OrthographicCamera ref={camRef} makeDefault near={0.1} far={500} />
      {debugCam && <OrbitControls target={[cx, 0, cz]} />}
    </>
  );
}
