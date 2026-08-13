import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, getVisibleState } from '@tactica/engine';
import type { GameState, Unit, UseAbilityAction } from '@tactica/engine';
import { buildRegistry, defaultConfig } from '@tactica/data';
import { useGameStore } from './gameStore.js';

const registry = buildRegistry();

const unit = (id: number, typeId: string, owner: number, x: number, y: number, hp?: number): Unit => ({
  id,
  typeId,
  owner,
  position: { x, y },
  hp: hp ?? registry.unitTypes[typeId].maxHP,
  hasMoved: false,
  hasAttacked: false,
  abilityCooldowns: {},
});

function fogBattlefield(): GameState {
  const state = createGame(
    { ...defaultConfig, fogOfWar: true },
    registry,
    ['vanguard', 'hive'],
    7,
  );
  state.units = [];
  state.cities = [];
  state.buildings = [];
  state.nodes = [];
  state.unitHomeCity = {};
  state.currentPlayer = 0;
  for (const row of state.map.tiles) {
    for (const tile of row) tile.terrain = 'plains';
  }
  return state;
}

describe('gameStore fog-safe presentation events', () => {
  beforeEach(() => {
    useGameStore.setState({
      lastAbilityEvent: null,
      lastAoeDamage: null,
      lastCombatEvent: null,
      lastCombatResult: null,
      mySeat: null,
      netSend: null,
    });
  });

  it('does not publish a hidden Ballistic Volley casualty to death VFX', () => {
    const state = fogBattlefield();
    const titan = unit(1, 'titan', 0, 6, 6);
    const hiddenVictim = unit(2, 'warrior', 1, 9, 9, 1);
    state.units = [titan, hiddenVictim];
    const visible = getVisibleState(state, 0, registry);
    expect(visible.units.some(candidate => candidate.id === hiddenVictim.id)).toBe(false);
    useGameStore.setState({
      gameState: state,
      visibleState: visible,
      registry,
      config: state.config,
      legalActions: [],
    });

    const volley: UseAbilityAction = {
      type: 'useAbility',
      unitId: titan.id,
      abilityId: 'ballistic_volley',
      target: { x: 8, y: 8 },
      tiles: [{ x: 8, y: 8 }, { x: 9, y: 8 }, { x: 8, y: 9 }, { x: 9, y: 9 }],
    };
    useGameStore.getState().executeAction(volley);

    expect(useGameStore.getState().gameState?.units.some(candidate => candidate.id === hiddenVictim.id)).toBe(false);
    expect(useGameStore.getState().lastAbilityEvent?.killed).toEqual([]);
    expect(useGameStore.getState().lastAoeDamage).toBeNull();
  });
});
