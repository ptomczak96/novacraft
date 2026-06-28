import { describe, it, expect } from 'vitest';
import {
  createGame, getLegalActions, applyAction, getResult, replayGame,
  previewCombat, getReachableTiles, computeScores, createPRNG, nextRandom,
} from './index.js';
import { buildRegistry, defaultConfig, defaultTerrain, defaultUnits, defaultFactions, defaultTechs } from '@tactica/data';
import type { GameState, Action, DataRegistry, GameConfig } from './types.js';

function getRegistry(): DataRegistry {
  return buildRegistry();
}

function getConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...defaultConfig, fogOfWar: false, ...overrides };
}

describe('PRNG', () => {
  it('produces deterministic sequences', () => {
    const a = createPRNG(42);
    const b = createPRNG(42);
    let stateA = a, stateB = b;
    for (let i = 0; i < 100; i++) {
      const [valA, nextA] = nextRandom(stateA);
      const [valB, nextB] = nextRandom(stateB);
      expect(valA).toBe(valB);
      stateA = nextA;
      stateB = nextB;
    }
  });

  it('different seeds produce different sequences', () => {
    const [valA] = nextRandom(createPRNG(1));
    const [valB] = nextRandom(createPRNG(2));
    expect(valA).not.toBe(valB);
  });
});

describe('Game creation', () => {
  it('creates a valid initial game state', () => {
    const registry = getRegistry();
    const config = getConfig();
    const state = createGame(config, registry, ['ironclad', 'sylvan'], 42);

    expect(state.phase).toBe('playing');
    expect(state.turn).toBe(1);
    expect(state.currentPlayer).toBe(0);
    expect(state.players).toHaveLength(2);
    expect(state.units.length).toBeGreaterThanOrEqual(2);
    expect(state.map.width).toBe(12);
    expect(state.map.height).toBe(12);
  });

  it('creates deterministic maps with same seed', () => {
    const registry = getRegistry();
    const config = getConfig();
    const a = createGame(config, registry, ['ironclad', 'sylvan'], 123);
    const b = createGame(config, registry, ['ironclad', 'sylvan'], 123);
    expect(JSON.stringify(a.map)).toBe(JSON.stringify(b.map));
  });
});

describe('Legal actions', () => {
  it('always includes endTurn', () => {
    const registry = getRegistry();
    const config = getConfig();
    const state = createGame(config, registry, ['ironclad', 'sylvan'], 42);
    const actions = getLegalActions(state, registry, 0);
    expect(actions.some(a => a.type === 'endTurn')).toBe(true);
  });

  it('returns no actions for wrong player', () => {
    const registry = getRegistry();
    const config = getConfig();
    const state = createGame(config, registry, ['ironclad', 'sylvan'], 42);
    const actions = getLegalActions(state, registry, 1);
    expect(actions).toHaveLength(0);
  });

  it('returns move actions for units', () => {
    const registry = getRegistry();
    const config = getConfig();
    const state = createGame(config, registry, ['ironclad', 'sylvan'], 42);
    const actions = getLegalActions(state, registry, 0);
    const moveActions = actions.filter(a => a.type === 'move');
    expect(moveActions.length).toBeGreaterThan(0);
  });
});

describe('Combat', () => {
  it('deals minimum 1 damage', () => {
    const registry = getRegistry();
    // Create a weak attacker vs strong defender
    const preview = previewCombat(
      { id: 1, typeId: 'scout', owner: 0, position: { x: 0, y: 0 }, hp: 1, hasMoved: false, hasAttacked: false, abilityCooldowns: {} },
      registry.unitTypes['scout'],
      { id: 2, typeId: 'defender', owner: 1, position: { x: 1, y: 0 }, hp: 20, hasMoved: false, hasAttacked: false, abilityCooldowns: {} },
      registry.unitTypes['defender'],
      { width: 12, height: 12, tiles: Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ terrain: 'plains', owner: null, isCity: false, isResourceTile: false }))) },
      registry,
      defaultConfig.combatConfig,
    );
    expect(preview.attackerDamage).toBeGreaterThanOrEqual(1);
  });

  it('calculates damage deterministically when variance is 0', () => {
    const registry = getRegistry();
    const map = { width: 12, height: 12, tiles: Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ terrain: 'plains', owner: null, isCity: false, isResourceTile: false }))) };

    const a = previewCombat(
      { id: 1, typeId: 'warrior', owner: 0, position: { x: 0, y: 0 }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} },
      registry.unitTypes['warrior'],
      { id: 2, typeId: 'warrior', owner: 1, position: { x: 1, y: 0 }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} },
      registry.unitTypes['warrior'],
      map, registry, defaultConfig.combatConfig,
    );

    const b = previewCombat(
      { id: 1, typeId: 'warrior', owner: 0, position: { x: 0, y: 0 }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} },
      registry.unitTypes['warrior'],
      { id: 2, typeId: 'warrior', owner: 1, position: { x: 1, y: 0 }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} },
      registry.unitTypes['warrior'],
      map, registry, defaultConfig.combatConfig,
    );

    expect(a.attackerDamage).toBe(b.attackerDamage);
    expect(a.defenderRetaliation).toBe(b.defenderRetaliation);
  });

  it('a fortified city protects the defender more than a normal city', () => {
    const registry = getRegistry();
    const mkMap = (fortified: boolean) => {
      const tiles = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ terrain: 'plains', owner: null, isCity: false, isResourceTile: false })));
      tiles[0][1] = { terrain: 'plains', owner: null, isCity: true, isResourceTile: false, fortified } as typeof tiles[0][0];
      return { width: 12, height: 12, tiles };
    };
    const dmgTo = (fortified: boolean) => previewCombat(
      { id: 1, typeId: 'warrior', owner: 0, position: { x: 0, y: 0 }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} },
      registry.unitTypes['warrior'],
      { id: 2, typeId: 'warrior', owner: 1, position: { x: 1, y: 0 }, hp: 15, hasMoved: false, hasAttacked: false, abilityCooldowns: {} },
      registry.unitTypes['warrior'],
      mkMap(fortified), registry, defaultConfig.combatConfig,
    ).attackerDamage;
    // Both are on a city (base ×1.5); the fortified one stacks an extra ×1.5,
    // so the defender takes strictly less damage.
    expect(dmgTo(true)).toBeLessThan(dmgTo(false));
  });
});

describe('Determinism', () => {
  it('replaying a game produces identical final state', () => {
    const seeds = [1, 42, 100, 999, 7777];

    for (const seed of seeds) {
      const registry = getRegistry();
      const config = getConfig({ turnLimit: 20 });

      // Play a game with random-ish actions
      let state = createGame(config, registry, ['ironclad', 'sylvan'], seed);
      const allActions: Action[] = [];
      let prng = createPRNG(seed + 1000);

      for (let i = 0; i < 200 && state.phase === 'playing'; i++) {
        const actions = getLegalActions(state, registry, state.currentPlayer);
        if (actions.length === 0) break;

        // Pick a pseudo-random action
        const [val, nextPrng] = nextRandom(prng);
        prng = nextPrng;
        const action = actions[Math.floor(val * actions.length)];
        allActions.push(action);
        state = applyAction(state, action, registry);
      }

      // Replay
      const replayed = replayGame(config, registry, ['ironclad', 'sylvan'], seed, allActions);

      // Compare final states (excluding action log which is built differently)
      expect(replayed.turn).toBe(state.turn);
      expect(replayed.phase).toBe(state.phase);
      expect(replayed.winner).toBe(state.winner);
      expect(replayed.units.length).toBe(state.units.length);
      expect(JSON.stringify(replayed.map)).toBe(JSON.stringify(state.map));
      expect(JSON.stringify(replayed.players)).toBe(JSON.stringify(state.players));
    }
  });
});

describe('Fuzz test', () => {
  it('100 random games complete without errors', () => {
    const registry = getRegistry();
    const config = getConfig({ turnLimit: 30 });

    for (let game = 0; game < 100; game++) {
      let state = createGame(config, registry, ['ironclad', 'sylvan'], game);
      let prng = createPRNG(game + 5000);

      for (let step = 0; step < 500 && state.phase === 'playing'; step++) {
        const actions = getLegalActions(state, registry, state.currentPlayer);
        expect(actions.length).toBeGreaterThan(0); // always at least endTurn

        const [val, nextPrng] = nextRandom(prng);
        prng = nextPrng;
        const action = actions[Math.floor(val * actions.length)];

        // Validate the action is legal
        const isLegal = actions.some(a => JSON.stringify(a) === JSON.stringify(action));
        expect(isLegal).toBe(true);

        state = applyAction(state, action, registry);
      }

      // Game should have ended or reached turn limit
      if (state.phase === 'playing') {
        expect(state.turn).toBeLessThanOrEqual(config.turnLimit + 1);
      }
    }
  });
});

describe('Win conditions', () => {
  it('detects elimination win', () => {
    const registry = getRegistry();
    const config = getConfig({
      winConditions: { captureAllCities: false, eliminateAllUnits: true, highestScoreAtLimit: false },
      turnLimit: 100,
    });
    let state = createGame(config, registry, ['ironclad', 'sylvan'], 42);

    // Kill all player 1's units by removing them (simulate)
    state.units = state.units.filter(u => u.owner !== 1);
    // Need to trigger win check — apply endTurn
    state = applyAction(state, { type: 'endTurn' }, registry);

    expect(state.phase).toBe('finished');
    expect(state.winner).toBe(0);
    expect(state.winConditionMet).toBe('eliminateAllUnits');
  });
});

describe('Scoring', () => {
  it('computes scores based on cities, units, and income', () => {
    const registry = getRegistry();
    const config = getConfig();
    const state = createGame(config, registry, ['ironclad', 'sylvan'], 42);
    const scores = computeScores(state, registry);
    expect(scores[0]).toBeGreaterThan(0);
    expect(scores[1]).toBeGreaterThan(0);
  });
});
