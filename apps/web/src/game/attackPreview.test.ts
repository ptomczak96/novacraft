import { describe, expect, it } from 'vitest';
import { buildRegistry, defaultConfig } from '@tactica/data';
import { createGame } from '@tactica/engine';
import type { GameState, Unit } from '@tactica/engine';
import { PREVIEW_COLLIDE_DAMAGE, predictPush, previewPercussive, previewRam } from './attackPreview.js';

const registry = buildRegistry();

const unit = (id: number, typeId: string, owner: number, x: number, y: number): Unit => ({
  id,
  typeId,
  owner,
  position: { x, y },
  hp: registry.unitTypes[typeId].maxHP,
  hasMoved: false,
  hasAttacked: false,
  abilityCooldowns: {},
});

function battlefield(): GameState {
  const state = createGame(
    { ...defaultConfig, fogOfWar: false },
    registry,
    ['vanguard', 'hive'],
    7,
  );
  state.units = [];
  state.buildings = [];
  for (const row of state.map.tiles) {
    for (const tile of row) tile.terrain = 'plains';
  }
  return state;
}

describe('attack outcome previews', () => {
  it('marks zero-distance and non-light pushes as immune', () => {
    const state = battlefield();
    const scout = unit(1, 'scout', 1, 4, 4);
    const tank = unit(2, 'tank', 1, 5, 4);

    expect(predictPush(state, registry, scout, 0, 0)).toMatchObject({
      outcome: 'immune', dest: { x: 4, y: 4 }, damage: 0,
    });
    expect(predictPush(state, registry, tank, 1, 0)).toMatchObject({
      outcome: 'immune', dest: { x: 6, y: 4 }, damage: 0,
    });
  });

  it('previews a clear push as a one-tile slide', () => {
    const state = battlefield();
    const scout = unit(1, 'scout', 1, 4, 4);

    expect(predictPush(state, registry, scout, 1, 0)).toEqual({
      unitId: 1,
      from: { x: 4, y: 4 },
      dir: { dx: 1, dy: 0 },
      outcome: 'slide',
      dest: { x: 5, y: 4 },
      damage: 0,
    });
  });

  it('previews map edges as collision damage without moving', () => {
    const state = battlefield();
    const scout = unit(1, 'scout', 1, 0, 3);

    expect(predictPush(state, registry, scout, -1, 0)).toMatchObject({
      outcome: 'collide',
      dest: { x: 0, y: 3 },
      damage: PREVIEW_COLLIDE_DAMAGE,
    });
  });

  it('previews impassable terrain as lethal void damage', () => {
    const state = battlefield();
    const scout = unit(1, 'scout', 1, 4, 4);
    state.map.tiles[4][5].terrain = 'water';

    expect(predictPush(state, registry, scout, 1, 0)).toMatchObject({
      outcome: 'void', dest: { x: 5, y: 4 }, damage: Infinity,
    });
  });

  it('previews light-unit collision damage on both units', () => {
    const state = battlefield();
    const scout = unit(1, 'scout', 1, 4, 4);
    state.units = [scout, unit(2, 'warrior', 0, 5, 4)];

    expect(predictPush(state, registry, scout, 1, 0)).toMatchObject({
      outcome: 'collide',
      dest: { x: 5, y: 4 },
      damage: PREVIEW_COLLIDE_DAMAGE,
      obstacle: { unitId: 2, damage: PREVIEW_COLLIDE_DAMAGE },
    });
  });

  it('does not forecast obstacle damage for a heavy unit', () => {
    const state = battlefield();
    const scout = unit(1, 'scout', 1, 4, 4);
    state.units = [scout, unit(2, 'tank', 0, 5, 4)];

    const preview = predictPush(state, registry, scout, 1, 0);
    expect(preview).toMatchObject({ outcome: 'collide', damage: PREVIEW_COLLIDE_DAMAGE });
    expect(preview.obstacle).toBeUndefined();
  });

  it.each([
    ['building', (state: GameState) => state.buildings.push({ id: 1, kind: 'mine', position: { x: 5, y: 4 }, level: 1, cityId: null })],
    ['mountain', (state: GameState) => { state.map.tiles[4][5].terrain = 'mountain'; }],
  ])('previews a %s as a solid collision', (_name, addObstacle) => {
    const state = battlefield();
    const scout = unit(1, 'scout', 1, 4, 4);
    addObstacle(state);

    expect(predictPush(state, registry, scout, 1, 0)).toMatchObject({
      outcome: 'collide', dest: { x: 5, y: 4 }, damage: PREVIEW_COLLIDE_DAMAGE,
    });
  });

  it('previews Percussive Shells center damage and all eight outward pushes', () => {
    const state = battlefield();
    const titan = unit(1, 'titan', 0, 3, 3);
    const center = unit(2, 'defender', 1, 5, 5);
    state.units = [titan, center];
    let id = 3;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx !== 0 || dy !== 0) state.units.push(unit(id++, 'scout', 1, 5 + dx, 5 + dy));
      }
    }

    const preview = previewPercussive(state, registry, titan, { x: 5, y: 5 });
    expect(preview.centerUnitId).toBe(center.id);
    expect(preview.centerDamage).toBeGreaterThan(0);
    expect(preview.pushes).toHaveLength(8);
    expect(preview.pushes.filter(push => push.outcome === 'slide')).toHaveLength(7);
    expect(preview.pushes.filter(push => push.outcome === 'collide')).toHaveLength(1);
  });

  it('does not forecast center damage when Percussive Shells lands on empty ground', () => {
    const state = battlefield();
    const titan = unit(1, 'titan', 0, 3, 3);
    state.units = [titan];

    expect(previewPercussive(state, registry, titan, { x: 5, y: 5 })).toEqual({
      centerDamage: null, centerUnitId: null, pushes: [],
    });
  });

  it('previews Ram away from the caster and ignores empty/friendly targets', () => {
    const state = battlefield();
    const vindrace = unit(1, 'vindrace', 0, 3, 3);
    const enemy = unit(2, 'scout', 1, 4, 3);
    const ally = unit(3, 'scout', 0, 3, 4);
    state.units = [vindrace, enemy, ally];

    expect(previewRam(state, registry, vindrace, enemy.position)).toMatchObject({
      unitId: enemy.id, dir: { dx: 1, dy: 0 }, dest: { x: 5, y: 3 }, outcome: 'slide',
    });
    expect(previewRam(state, registry, vindrace, ally.position)).toBeNull();
    expect(previewRam(state, registry, vindrace, { x: 2, y: 2 })).toBeNull();
  });
});
