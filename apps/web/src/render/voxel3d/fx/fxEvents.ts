export interface FxPreviewEvent {
  id: string;
  position: { x: number; y: number };
  direction?: { x: number; y: number };
}

export interface CameraShakeEvent {
  magnitude: number;
  duration: number;
}

const fxListeners = new Set<(event: FxPreviewEvent) => void>();
const shakeListeners = new Set<(event: CameraShakeEvent) => void>();

export function playFxPreview(event: FxPreviewEvent): void {
  for (const listener of fxListeners) listener(event);
}

export function subscribeFxPreview(listener: (event: FxPreviewEvent) => void): () => void {
  fxListeners.add(listener);
  return () => fxListeners.delete(listener);
}

export function requestCameraShake(magnitude: number, duration: number): void {
  for (const listener of shakeListeners) listener({ magnitude, duration });
}

export function subscribeCameraShake(listener: (event: CameraShakeEvent) => void): () => void {
  shakeListeners.add(listener);
  return () => shakeListeners.delete(listener);
}
