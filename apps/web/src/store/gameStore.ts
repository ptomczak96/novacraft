import { create } from 'zustand';
import type { GameState, GameConfig, Action, DataRegistry, VisibleState, Coord } from '@tactica/engine';
import {
  createGame, getLegalActions, applyAction, getVisibleState,
  getResult, replayGame, previewCombat,
} from '@tactica/engine';
import { buildRegistry, defaultConfig, defaultTerrain, defaultUnits, defaultFactions, defaultTechs } from '@tactica/data';
import type { TerrainType, UnitType, FactionDef, TechDef } from '@tactica/engine';

export type AppScreen = 'setup' | 'game' | 'mapEditor';
export type BotSetting = 'human' | 'random' | 'greedy';

interface GameStore {
  // App state
  screen: AppScreen;
  setScreen: (s: AppScreen) => void;

  // Data (mutable for editor)
  terrain: TerrainType[];
  units: UnitType[];
  factions: FactionDef[];
  techs: TechDef[];
  config: GameConfig;
  registry: DataRegistry;
  rebuildRegistry: () => void;
  setTerrain: (t: TerrainType[]) => void;
  setUnits: (u: UnitType[]) => void;
  setFactions: (f: FactionDef[]) => void;
  setTechs: (t: TechDef[]) => void;
  setConfig: (c: GameConfig) => void;

  // Game state
  gameState: GameState | null;
  visibleState: VisibleState | null;
  stateHistory: GameState[]; // for undo
  selectedUnitId: number | null;
  hoveredTile: Coord | null;
  legalActions: Action[];

  // Bot settings
  botSettings: [BotSetting, BotSetting];
  setBotSetting: (player: 0 | 1, setting: BotSetting) => void;
  autoPlay: boolean;
  setAutoPlay: (v: boolean) => void;

  // Fog interstitial
  showInterstitial: boolean;
  dismissInterstitial: () => void;

  // Editor panel
  editorOpen: boolean;
  setEditorOpen: (v: boolean) => void;
  editorTab: string;
  setEditorTab: (t: string) => void;

  // Inspector
  inspectorOpen: boolean;
  setInspectorOpen: (v: boolean) => void;

  // Actions
  startGame: (factions: [string, string], seed: number) => void;
  selectUnit: (unitId: number | null) => void;
  setHoveredTile: (c: Coord | null) => void;
  executeAction: (action: Action) => void;
  undo: () => void;
  saveGame: () => string;
  loadGame: (json: string) => void;

  // Map editor
  mapEditorTerrain: string;
  setMapEditorTerrain: (t: string) => void;
  mapEditorTool: 'terrain' | 'city' | 'unit' | 'erase';
  setMapEditorTool: (t: 'terrain' | 'city' | 'unit' | 'erase') => void;
  mapEditorState: GameState | null;
  initMapEditor: () => void;
  mapEditorPaint: (x: number, y: number) => void;
  exportMap: () => string;
}

export const useGameStore = create<GameStore>((set, get) => ({
  screen: 'setup',
  setScreen: (s) => set({ screen: s }),

  terrain: [...defaultTerrain] as TerrainType[],
  units: [...defaultUnits] as UnitType[],
  factions: [...defaultFactions] as FactionDef[],
  techs: [...defaultTechs] as TechDef[],
  config: { ...defaultConfig },
  registry: buildRegistry(),

  rebuildRegistry: () => {
    const { terrain, units, factions, techs } = get();
    set({ registry: buildRegistry(terrain, units, factions, techs) });
  },
  setTerrain: (t) => { set({ terrain: t }); get().rebuildRegistry(); },
  setUnits: (u) => { set({ units: u }); get().rebuildRegistry(); },
  setFactions: (f) => { set({ factions: f }); get().rebuildRegistry(); },
  setTechs: (t) => { set({ techs: t }); get().rebuildRegistry(); },
  setConfig: (c) => set({ config: c }),

  gameState: null,
  visibleState: null,
  stateHistory: [],
  selectedUnitId: null,
  hoveredTile: null,
  legalActions: [],

  botSettings: ['human', 'human'],
  setBotSetting: (player, setting) => {
    const bs = [...get().botSettings] as [BotSetting, BotSetting];
    bs[player] = setting;
    set({ botSettings: bs });
  },
  autoPlay: false,
  setAutoPlay: (v) => set({ autoPlay: v }),

  showInterstitial: false,
  dismissInterstitial: () => set({ showInterstitial: false }),

  editorOpen: false,
  setEditorOpen: (v) => set({ editorOpen: v }),
  editorTab: 'units',
  setEditorTab: (t) => set({ editorTab: t }),

  inspectorOpen: false,
  setInspectorOpen: (v) => set({ inspectorOpen: v }),

  startGame: (factions, seed) => {
    const { config, registry } = get();
    const state = createGame(config, registry, factions, seed);
    const visible = getVisibleState(state, state.currentPlayer, registry);
    const legal = getLegalActions(state, registry, state.currentPlayer);
    set({
      gameState: state,
      visibleState: visible,
      legalActions: legal,
      stateHistory: [],
      selectedUnitId: null,
      screen: 'game',
      showInterstitial: false,
    });
  },

  selectUnit: (unitId) => set({ selectedUnitId: unitId }),
  setHoveredTile: (c) => set({ hoveredTile: c }),

  executeAction: (action) => {
    const { gameState, registry, config } = get();
    if (!gameState) return;

    const prevPlayer = gameState.currentPlayer;
    const newState = applyAction(gameState, action, registry);
    const visible = getVisibleState(newState, newState.currentPlayer, registry);
    const legal = getLegalActions(newState, registry, newState.currentPlayer);

    // Show interstitial on turn change with fog
    const showInterstitial = config.fogOfWar && action.type === 'endTurn' && newState.currentPlayer !== prevPlayer && newState.phase === 'playing';

    set({
      gameState: newState,
      visibleState: visible,
      legalActions: legal,
      stateHistory: [...get().stateHistory, gameState],
      selectedUnitId: null,
      showInterstitial,
    });
  },

  undo: () => {
    const { stateHistory, registry } = get();
    if (stateHistory.length === 0) return;
    const prev = stateHistory[stateHistory.length - 1];
    const visible = getVisibleState(prev, prev.currentPlayer, registry);
    const legal = getLegalActions(prev, registry, prev.currentPlayer);
    set({
      gameState: prev,
      visibleState: visible,
      legalActions: legal,
      stateHistory: stateHistory.slice(0, -1),
      selectedUnitId: null,
    });
  },

  saveGame: () => {
    const { gameState, config } = get();
    if (!gameState) return '{}';
    const save = {
      config,
      seed: gameState.prng.seed,
      factions: gameState.players.map(p => p.factionId),
      actions: gameState.actionLog,
    };
    return JSON.stringify(save, null, 2);
  },

  loadGame: (json) => {
    try {
      const save = JSON.parse(json);
      const { registry } = get();
      const config = save.config as GameConfig;
      const state = replayGame(config, registry, save.factions, save.seed, save.actions);
      const visible = getVisibleState(state, state.currentPlayer, registry);
      const legal = getLegalActions(state, registry, state.currentPlayer);
      set({
        config,
        gameState: state,
        visibleState: visible,
        legalActions: legal,
        stateHistory: [],
        selectedUnitId: null,
        screen: 'game',
      });
    } catch (e) {
      console.error('Failed to load game:', e);
    }
  },

  // Map editor
  mapEditorTerrain: 'plains',
  setMapEditorTerrain: (t) => set({ mapEditorTerrain: t }),
  mapEditorTool: 'terrain',
  setMapEditorTool: (t) => set({ mapEditorTool: t }),
  mapEditorState: null,

  initMapEditor: () => {
    const { config, registry } = get();
    const state = createGame(config, registry, ['ironclad', 'sylvan'], 1);
    set({ mapEditorState: state, screen: 'mapEditor' });
  },

  mapEditorPaint: (x, y) => {
    const { mapEditorState, mapEditorTerrain, mapEditorTool } = get();
    if (!mapEditorState) return;
    const newState = JSON.parse(JSON.stringify(mapEditorState)) as GameState;
    const tile = newState.map.tiles[y][x];

    if (mapEditorTool === 'terrain') {
      tile.terrain = mapEditorTerrain;
      tile.isResourceTile = mapEditorTerrain === 'resource';
    } else if (mapEditorTool === 'city') {
      tile.isCity = true;
      tile.terrain = 'plains';
      tile.owner = 0;
    } else if (mapEditorTool === 'erase') {
      tile.terrain = 'plains';
      tile.isCity = false;
      tile.isResourceTile = false;
      tile.owner = null;
    }

    set({ mapEditorState: newState });
  },

  exportMap: () => {
    const { mapEditorState } = get();
    if (!mapEditorState) return '{}';
    return JSON.stringify(mapEditorState.map, null, 2);
  },
}));
