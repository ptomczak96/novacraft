import { create } from 'zustand';
import type { GameState, GameConfig, Action, DataRegistry, VisibleState, Coord, CombatBreakdown } from '@tactica/engine';
import {
  createGame, createTestCombatGame, getLegalActions, applyAction, getVisibleState,
  getResult, replayGame, previewCombat, previewAttack,
} from '@tactica/engine';
import { buildRegistry, defaultConfig, defaultTerrain, defaultUnits, defaultFactions, defaultTechs } from '@tactica/data';
import type { TerrainType, UnitType, FactionDef, TechDef } from '@tactica/engine';
import type { TileTheme } from '../iso/tileSprites.js';
import { unitCode } from '../data/notation.js';
import { describeAction } from '../data/coach.js';
import type { CoachEntry, StrategyNote, CoachMeta } from '../data/coach.js';

export interface CombatLogEntry {
  attacker: { name: string; attack: number; defence: number; hpBefore: number; hpAfter: number; maxHP: number };
  defender: { name: string; attack: number; defence: number; hpBefore: number; hpAfter: number; maxHP: number };
  attackBreakdown: CombatBreakdown;
  retaliationBreakdown: CombatBreakdown | null;
  defenderKilled: boolean;
  attackerKilled: boolean;
}

/** One executed attack, published for the render layer's generic combat
 *  animations (lunge / hit flash / damage popups). Purely presentational. */
export interface CombatEvent {
  seq: number;                 // increments per attack so effects can detect new events
  at: number;                  // Date.now() when fired (staleness check)
  attackerId: number;
  defenderId: number;
  attackerPos: Coord;
  defenderPos: Coord;
  damage: number;              // dealt to defender
  retaliation: number;         // dealt back to attacker
  defenderKilled: boolean;
  attackerKilled: boolean;
}

// A multi-tile damage burst (Wyrm strike) — drives floating "-N" popups at each cell.
export interface AoeDamageEvent {
  seq: number;
  hits: { x: number; y: number; amount: number; killed: boolean }[];
}

/** Latest ability cast (incl. Wyrm strikes), for render-layer cast animations. */
export interface AbilityEvent {
  seq: number;
  at: number;
  abilityId: string;
  unitId: number;
  casterPos: { x: number; y: number };
  /** Target tiles (empty for self-casts / morphs). */
  targets: { x: number; y: number }[];
}

export type AppScreen = 'setup' | 'game' | 'mapEditor';
export type BotSetting = 'human' | 'random' | 'greedy' | 'odysseus' | 'achilles';

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
  // Tile art theme (pure render setting — not part of deterministic engine state).
  tileTheme: TileTheme;
  setTileTheme: (t: TileTheme) => void;
  // Soundtrack mute only — SFX are always audible (session-only setting; Patrick).
  musicMuted: boolean;
  setMusicMuted: (v: boolean) => void;
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
  selectedCity: Coord | null;
  hoveredTile: Coord | null;
  inspectedTile: Coord | null; // tile whose info box is shown (terrain/resource)
  setInspectedTile: (c: Coord | null) => void;
  // Active ability targeting: the unit + ability awaiting a target click (or null).
  abilityMode: { unitId: number; abilityId: string } | null;
  setAbilityMode: (m: { unitId: number; abilityId: string } | null) => void;
  legalActions: Action[];

  // Territory-expansion picker (L4 reward): active while the player ticks tiles.
  territorySelect: { cityId: number; picks: Coord[] } | null;
  setTerritorySelect: (v: { cityId: number; picks: Coord[] } | null) => void;

  // Ballistic Volley picker (Titan): active while the player ticks the 2×2 target square.
  volleySelect: { unitId: number; abilityId: string; picks: Coord[] } | null;
  setVolleySelect: (v: { unitId: number; abilityId: string; picks: Coord[] } | null) => void;

  // Wyrm strike picker: active while the player ticks the 2 touching target cells.
  strikeSelect: { unitId: number; picks: Coord[] } | null;
  setStrikeSelect: (v: { unitId: number; picks: Coord[] } | null) => void;

  // Multi-unit ability picker (Cure / Repair): tick up to maxTargets eligible ally tiles.
  targetSelect: { unitId: number; abilityId: string; name: string; maxTargets: number; picks: Coord[] } | null;
  setTargetSelect: (v: { unitId: number; abilityId: string; name: string; maxTargets: number; picks: Coord[] } | null) => void;

  // A move/action by an engineer mid node-build is deferred behind a confirm dialog.
  pendingNodeCancel: import('@tactica/engine').Action | null;
  setPendingNodeCancel: (a: import('@tactica/engine').Action | null) => void;

  // "Remove tracer round / explosives" prompt (a detecting ally clicked a marked friendly).
  markRemoval: { removerId: number; target: Coord; kind: 'tracer' | 'explosive' } | null;
  setMarkRemoval: (v: { removerId: number; target: Coord; kind: 'tracer' | 'explosive' } | null) => void;

  // ── Online 1v1 (PartyKit lockstep relay) ──
  // The local player's fixed seat (0 host / 1 guest) — null when playing locally. In a
  // network game, the local client always VIEWS and ACTS as this seat.
  mySeat: number | null;
  // Broadcast callback bound to the socket (set when a network game starts); null locally.
  netSend: ((action: Action) => void) | null;
  // Lobby status for the multiplayer UI.
  mpStatus: { room: string; seat: number | null; peers: number; error: string | null } | null;
  setMpStatus: (v: GameStore['mpStatus']) => void;
  // Start a network game with an agreed handshake (both clients replay identically).
  startNetworkGame: (opts: { seat: number; factions: [string, string]; seed: number; config: GameConfig; send: (a: Action) => void }) => void;
  // Apply an action received from the peer (no re-broadcast).
  receiveRemoteAction: (action: Action) => void;
  // Tear down network state (back to local play).
  leaveMultiplayer: () => void;

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

  // Combat log
  lastCombatResult: CombatLogEntry | null;
  // Latest attack, for render-layer combat animations.
  lastCombatEvent: CombatEvent | null;
  // Latest multi-tile damage burst (Wyrm strike), for floating damage popups.
  lastAoeDamage: AoeDamageEvent | null;
  // Latest ability cast, for render-layer cast animations (3D renderer).
  lastAbilityEvent: AbilityEvent | null;

  // Board notation (UI-only): stable per-unit short codes (WA1, xVIN2…) keyed by unit id,
  // plus the running per-(owner,code) counter. Assigned once and never renumbered.
  unitLabels: Record<number, string>;
  unitLabelSeq: Record<string, number>;
  ensureUnitLabels: () => void;

  // Coaching loop (UI-only): a move log with the AI's scored candidates + your annotations.
  coachEnabled: boolean;
  coachLog: CoachEntry[];
  strategyNotes: StrategyNote[];
  setCoachEnabled: (v: boolean) => void;
  addCoachComment: (seq: number, text: string) => void;
  addStrategyNote: (text: string) => void;
  clearCoach: () => void;

  // Actions
  startGame: (factions: [string, string], seed: number) => void;
  startTestCombat: (factions: [string, string], seed: number) => void;
  selectUnit: (unitId: number | null) => void;
  setSelectedCity: (c: Coord | null) => void;
  setHoveredTile: (c: Coord | null) => void;
  executeAction: (action: Action, coachMeta?: CoachMeta, opts?: { remote?: boolean }) => void;
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
  // Start-menu defaults: Tech Tree + Nodes + Fog on, Turn Limit OFF (0), Small (14×14) map,
  // Normal resources, Capture-all-cities win (from config.json).
  config: {
    ...defaultConfig,
    techTreeEnabled: true,
    nodesEnabled: true,
    fogOfWar: true,
    turnLimit: 0,
    mapWidth: 14,
    mapHeight: 14,
    richStart: false,
    unlimitedResources: false,
    winConditions: { captureAllCities: true, captureCapital: false, eliminateAllUnits: false, highestScoreAtLimit: false },
  },
  registry: buildRegistry(),
  tileTheme: 'default',
  setTileTheme: (t) => set({ tileTheme: t }),
  musicMuted: true, // default muted (Patrick's preference)
  setMusicMuted: (v) => set({ musicMuted: v }),

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
  selectedCity: null,
  inspectedTile: null,
  territorySelect: null,
  volleySelect: null,
  strikeSelect: null,
  targetSelect: null,
  pendingNodeCancel: null,
  markRemoval: null,
  mySeat: null,
  netSend: null,
  mpStatus: null,
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

  lastCombatResult: null,
  lastCombatEvent: null,
  lastAoeDamage: null,
  lastAbilityEvent: null,
  unitLabels: {},
  unitLabelSeq: {},

  coachEnabled: false,
  coachLog: [],
  strategyNotes: [],
  setCoachEnabled: (v) => set({ coachEnabled: v }),
  addCoachComment: (seq, text) => set({
    coachLog: get().coachLog.map(e => e.seq === seq ? { ...e, comment: text } : e),
  }),
  addStrategyNote: (text) => {
    const gs = get().gameState;
    if (!text.trim() || !gs) return;
    set({ strategyNotes: [...get().strategyNotes, { turn: gs.turn, player: gs.currentPlayer, text: text.trim() }] });
  },
  clearCoach: () => set({ coachLog: [], strategyNotes: [] }),

  ensureUnitLabels: () => {
    const { gameState, unitLabels, unitLabelSeq } = get();
    if (!gameState) return;
    const mirror = gameState.players[0]?.factionId != null
      && gameState.players[0]?.factionId === gameState.players[1]?.factionId;
    let labels = unitLabels;
    let seq = unitLabelSeq;
    // Assign in id order (= creation order) so codes reflect build order; only ever
    // assign to NEW ids, so a death never renumbers survivors.
    for (const u of [...gameState.units].sort((a, b) => a.id - b.id)) {
      if (labels[u.id]) continue;
      const code = unitCode(u.typeId);
      const prefix = mirror ? (u.owner === 0 ? 'x' : 'y') : '';
      const key = `${u.owner}:${prefix}${code}`;
      const n = (seq[key] ?? 0) + 1;
      if (labels === unitLabels) { labels = { ...unitLabels }; seq = { ...unitLabelSeq }; }
      seq[key] = n;
      labels[u.id] = `${prefix}${code}${n}`;
    }
    if (labels !== unitLabels) set({ unitLabels: labels, unitLabelSeq: seq });
  },

  startGame: (factions, seed) => {
    const { config, registry } = get();
    const state = createGame(config, registry, factions, seed);
    // In a network game the local client always views/acts as its own seat.
    const seat = get().mySeat ?? state.currentPlayer;
    const visible = getVisibleState(state, seat, registry);
    const legal = getLegalActions(state, registry, seat);
    set({
      gameState: state,
      visibleState: visible,
      legalActions: legal,
      stateHistory: [],
      selectedUnitId: null,
      selectedCity: null,
      inspectedTile: null,
      screen: 'game',
      showInterstitial: false,
      unitLabels: {},
      unitLabelSeq: {},
      coachLog: [],
      strategyNotes: [],
    });
    get().ensureUnitLabels();
  },

  startTestCombat: (factions, seed) => {
    const { config, registry } = get();
    const state = createTestCombatGame(config, registry, factions, seed);
    const visible = getVisibleState(state, state.currentPlayer, registry);
    const legal = getLegalActions(state, registry, state.currentPlayer);
    set({
      gameState: state,
      visibleState: visible,
      legalActions: legal,
      botSettings: ['human', 'human'], // both human for a combat sandbox
      stateHistory: [],
      selectedUnitId: null,
      selectedCity: null,
      inspectedTile: null,
      screen: 'game',
      showInterstitial: false,
      unitLabels: {},
      unitLabelSeq: {},
      coachLog: [],
      strategyNotes: [],
    });
    get().ensureUnitLabels();
  },

  selectUnit: (unitId) => set({ selectedUnitId: unitId, selectedCity: null, inspectedTile: null, abilityMode: null, volleySelect: null, strikeSelect: null, targetSelect: null }),
  setSelectedCity: (c) => set({ selectedCity: c, selectedUnitId: null, inspectedTile: null, abilityMode: null, volleySelect: null, strikeSelect: null, targetSelect: null }),
  setHoveredTile: (c) => set({ hoveredTile: c }),
  setInspectedTile: (c) => set({ inspectedTile: c }),
  abilityMode: null,
  setAbilityMode: (m) => set({ abilityMode: m, volleySelect: null, strikeSelect: null, targetSelect: null }),
  setTerritorySelect: (v) => set({ territorySelect: v, volleySelect: null, strikeSelect: null, targetSelect: null, selectedUnitId: null, selectedCity: null, inspectedTile: null }),
  setVolleySelect: (v) => set({ volleySelect: v, strikeSelect: null, territorySelect: null, targetSelect: null, abilityMode: null, selectedUnitId: null, selectedCity: null, inspectedTile: null }),
  setStrikeSelect: (v) => set({ strikeSelect: v, volleySelect: null, territorySelect: null, targetSelect: null, abilityMode: null, selectedUnitId: null, selectedCity: null, inspectedTile: null }),
  setTargetSelect: (v) => set({ targetSelect: v, volleySelect: null, strikeSelect: null, territorySelect: null, abilityMode: null, selectedUnitId: null, selectedCity: null, inspectedTile: null }),
  setPendingNodeCancel: (a) => set({ pendingNodeCancel: a }),
  setMarkRemoval: (v) => set({ markRemoval: v }),

  setMpStatus: (v) => set({ mpStatus: v }),
  startNetworkGame: ({ seat, factions, seed, config, send }) => {
    // Adopt the agreed config + our seat, then start deterministically. Both clients run the
    // same createGame(config, factions, seed) and stay in sync by relaying actions.
    set({ config, mySeat: seat, netSend: send, botSettings: ['human', 'human'], coachEnabled: false });
    get().startGame(factions, seed);
  },
  receiveRemoteAction: (action) => get().executeAction(action, undefined, { remote: true }),
  leaveMultiplayer: () => set({ mySeat: null, netSend: null, mpStatus: null }),

  executeAction: (action, coachMeta, opts) => {
    const { gameState, registry, config } = get();
    if (!gameState) return;

    // Coaching loop: record every move (with its human-readable description + any AI
    // candidate scores) BEFORE applying, so descriptions use pre-action positions.
    let coachLog = get().coachLog;
    if (get().coachEnabled) {
      const entry: CoachEntry = {
        seq: (coachLog[coachLog.length - 1]?.seq ?? 0) + 1,
        turn: gameState.turn,
        player: gameState.currentPlayer,
        actor: coachMeta?.actor ?? 'human',
        desc: describeAction(action, gameState, get().unitLabels, registry),
        candidates: coachMeta?.candidates,
        comment: '',
      };
      coachLog = [...coachLog, entry];
    }

    // Capture combat info before applying the action
    let combatLogEntry: CombatLogEntry | null = null;
    let combatEvent: CombatEvent | null = null;
    if (action.type === 'attack') {
      const attacker = gameState.units.find(u => u.id === action.unitId);
      const defender = gameState.units.find(u => u.id === action.targetId);
      if (attacker && defender) {
        const attackerType = registry.unitTypes[attacker.typeId];
        const defenderType = registry.unitTypes[defender.typeId];
        if (attackerType && defenderType) {
          // previewAttack mirrors the actual resolution (incl. the Combined Arms ×1.2 on a
          // repeat hit) so the log/popups match the HP the defender really loses.
          const result = previewAttack(gameState, action.unitId, action.targetId, registry)
            ?? previewCombat(attacker, attackerType, defender, defenderType, gameState.map, registry, gameState.config.combatConfig);
          combatLogEntry = {
            attacker: {
              name: attackerType.name,
              attack: attackerType.attack,
              defence: attackerType.defence,
              hpBefore: attacker.hp,
              hpAfter: Math.max(0, attacker.hp - result.defenderRetaliation),
              maxHP: attackerType.maxHP,
            },
            defender: {
              name: defenderType.name,
              attack: defenderType.attack,
              defence: defenderType.defence,
              hpBefore: defender.hp,
              hpAfter: Math.max(0, defender.hp - result.attackerDamage),
              maxHP: defenderType.maxHP,
            },
            attackBreakdown: result.attackBreakdown,
            retaliationBreakdown: result.retaliationBreakdown,
            defenderKilled: result.defenderKilled,
            attackerKilled: result.attackerKilled,
          };
          combatEvent = {
            seq: (get().lastCombatEvent?.seq ?? 0) + 1,
            at: Date.now(),
            attackerId: attacker.id,
            defenderId: defender.id,
            attackerPos: attacker.position,
            defenderPos: defender.position,
            damage: result.attackerDamage,
            retaliation: result.defenderRetaliation,
            defenderKilled: result.defenderKilled,
            attackerKilled: result.attackerKilled,
          };
        }
      }
    }

    // Wyrm strike: floating damage numbers on the two struck cells (primary 100%,
    // secondary 50%). Computed from the true state so it works even into fog.
    let aoeDamage: AoeDamageEvent | null = null;
    if (action.type === 'wyrmStrike' && action.tiles.length === 2) {
      const attacker = gameState.units.find(u => u.id === action.unitId);
      const attackerType = attacker && registry.unitTypes[attacker.typeId];
      if (attacker && attackerType) {
        const minDmg = gameState.config.combatConfig.minimumDamage;
        const hits = action.tiles.map((c, i) => {
          const victim = gameState.units.find(u => u.id !== attacker.id && u.position.x === c.x && u.position.y === c.y);
          const vt = victim && registry.unitTypes[victim.typeId];
          if (!victim || !vt) return null;
          const result = previewCombat(attacker, attackerType, victim, vt, gameState.map, registry, gameState.config.combatConfig);
          const amount = i === 0 ? result.attackerDamage : Math.max(minDmg, Math.round(result.attackerDamage * 0.5));
          return { x: c.x, y: c.y, amount, killed: victim.hp - amount <= 0 };
        }).filter((h): h is NonNullable<typeof h> => h !== null);
        if (hits.length) aoeDamage = { seq: (get().lastAoeDamage?.seq ?? 0) + 1, hits };
      }
    }

    // Ability cast event (incl. Wyrm strikes) → render-layer cast animations.
    let abilityEvent: AbilityEvent | null = null;
    if (action.type === 'useAbility' || action.type === 'wyrmStrike') {
      const caster = gameState.units.find(u => u.id === action.unitId);
      if (caster) {
        const targets = action.type === 'wyrmStrike'
          ? action.tiles
          : (action.tiles ?? action.targets ?? (action.target ? [action.target] : []));
        abilityEvent = {
          seq: (get().lastAbilityEvent?.seq ?? 0) + 1,
          at: Date.now(),
          abilityId: action.type === 'wyrmStrike' ? 'wyrm_strike' : action.abilityId,
          unitId: caster.id,
          casterPos: { ...caster.position },
          targets: targets.map(t => ({ x: t.x, y: t.y })),
        };
      }
    }

    const prevPlayer = gameState.currentPlayer;
    const newState = applyAction(gameState, action, registry);
    // Network game → always view/act as our own seat; local → the current player.
    const seat = get().mySeat ?? newState.currentPlayer;
    const visible = getVisibleState(newState, seat, registry);
    const legal = getLegalActions(newState, registry, seat);

    // Fog "pass the device" interstitial — only in local hot-seat, never online.
    const showInterstitial = get().mySeat === null && config.fogOfWar && action.type === 'endTurn' && newState.currentPlayer !== prevPlayer && newState.phase === 'playing';

    set({
      gameState: newState,
      visibleState: visible,
      legalActions: legal,
      stateHistory: [...get().stateHistory, gameState],
      selectedUnitId: null,
      territorySelect: null,
      volleySelect: null,
      strikeSelect: null,
      inspectedTile: null,
      abilityMode: null,
      showInterstitial,
      lastCombatResult: combatLogEntry ?? get().lastCombatResult,
      lastCombatEvent: combatEvent ?? get().lastCombatEvent,
      lastAoeDamage: aoeDamage ?? get().lastAoeDamage,
      lastAbilityEvent: abilityEvent ?? get().lastAbilityEvent,
      coachLog,
    });
    get().ensureUnitLabels(); // label any newly-spawned units (stable, never renumbered)
    // Broadcast LOCAL actions to the peer (remote-applied actions don't echo back).
    if (!opts?.remote) get().netSend?.(action);
  },

  undo: () => {
    const { stateHistory, registry } = get();
    if (get().mySeat !== null) return; // undo would desync an online game — disabled in MP
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
      inspectedTile: null,
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
    const state = createGame(config, registry, ['vanguard', 'hive'], 1);
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

// Dev console access to the store (vite dev builds only) — lets you drive
// actions directly while debugging: __game.getState().executeAction({...}).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__game = useGameStore;
}
