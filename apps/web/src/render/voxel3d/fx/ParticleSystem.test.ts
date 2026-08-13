import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ParticleSystem, RateEmitter } from './ParticleSystem.js';

const emitted = (system: ParticleSystem, attribute: string, index: number): number[] => {
  const values = system.geometry.getAttribute(attribute) as THREE.InstancedBufferAttribute;
  return Array.from(
    { length: values.itemSize },
    (_, component) => Number(values.array[index * values.itemSize + component]),
  );
};

describe('ParticleSystem', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bakes gravity and palette per spawn so overlapping recipes stay independent', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const system = new ParticleSystem({ name: 'test', capacity: 2 });
    const params = {
      position: new THREE.Vector3(),
      direction: new THREE.Vector3(0, 1, 0),
      spread: 0,
      speedVariance: 0,
      sizeVariance: 0,
      lifeVariance: 0,
      time: 1,
    };

    system.setGradient('#ff0000', '#aa0000', '#550000', '#110000');
    (system.uniforms.uGravity.value as THREE.Vector3).set(1, 2, 3);
    system.emit(1, params);

    system.setGradient('#00ff00', '#00aa00', '#005500', '#001100');
    (system.uniforms.uGravity.value as THREE.Vector3).set(4, 5, 6);
    system.emit(1, { ...params, time: 2 });

    expect(emitted(system, 'aGravity', 0)).toEqual([1, 2, 3]);
    expect(emitted(system, 'aGravity', 1)).toEqual([4, 5, 6]);
    expect(emitted(system, 'aColor0', 0)).toEqual([1, 0, 0]);
    expect(emitted(system, 'aColor0', 1)).toEqual([0, 1, 0]);
    system.dispose();
  });
});

describe('RateEmitter', () => {
  it('preserves fractional emissions and caps a stalled frame', () => {
    const emitter = new RateEmitter();
    expect(emitter.tick(1 / 60, 30)).toBe(0);
    expect(emitter.tick(1 / 60, 30)).toBe(1);
    expect(emitter.tick(10, 100)).toBe(120);
    emitter.reset();
    expect(emitter.tick(1 / 60, 30)).toBe(0);
  });
});
