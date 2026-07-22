import React, { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore.js';

// Preset map sizes (square). "custom" lets the width/height fields be edited freely.
const MAP_PRESETS = { tiny: 11, small: 14, medium: 16, large: 18, huge: 20, massive: 30 } as const;
type MapPreset = keyof typeof MAP_PRESETS | 'custom';
const PRESET_LABELS: Record<MapPreset, string> = {
  tiny: 'Tiny (11×11)', small: 'Small (14×14)', medium: 'Medium (16×16)',
  large: 'Large (18×18)', huge: 'Huge (20×20)', massive: 'Massive (30×30)', custom: 'Custom',
};

// Win condition & resource choices are single-select (radio).
type WinKey = 'captureAllCities' | 'captureCapital' | 'highestScoreAtLimit';
const WIN_OPTIONS: { key: WinKey; label: string }[] = [
  { key: 'captureAllCities', label: 'Capture all cities' },
  { key: 'captureCapital', label: 'Capture capital' },
  { key: 'highestScoreAtLimit', label: 'Highest score at turn limit' },
];
type ResKey = 'normal' | 'double' | 'unlimited';
const RES_OPTIONS: { key: ResKey; label: string }[] = [
  { key: 'normal', label: 'Normal' },
  { key: 'double', label: 'Double resources' },
  { key: 'unlimited', label: 'Unlimited resources' },
];

export function SetupScreen() {
  const { config, setConfig, factions, startGame, startTestCombat, initMapEditor, loadGame, setBotSetting, setCoachEnabled, tileTheme, setTileTheme } = useGameStore();
  const [seed, setSeed] = useState(Math.floor(Math.random() * 100000));
  const [mapPreset, setMapPreset] = useState<MapPreset>('tiny');

  // Apply the chosen preset's dimensions (default Tiny on mount). "Custom" leaves the
  // width/height as-is so they can be edited. Reads fresh config from the store to
  // avoid clobbering other config fields.
  useEffect(() => {
    if (mapPreset === 'custom') return;
    const size = MAP_PRESETS[mapPreset];
    const cfg = useGameStore.getState().config;
    useGameStore.getState().setConfig({ ...cfg, mapWidth: size, mapHeight: size });
  }, [mapPreset]);
  const [faction0, setFaction0] = useState(factions[0]?.id || 'vanguard');
  const [faction1, setFaction1] = useState(factions[1]?.id || 'hive');
  const [bot0, setBot0] = useState<'human' | 'random' | 'greedy'>('human');
  const [bot1, setBot1] = useState<'human' | 'random' | 'greedy'>('human');
  // Test Combat Mode team selection (independent of the normal-game factions above).
  const [tcTeam0, setTcTeam0] = useState(factions[0]?.id || 'vanguard');
  const [tcTeam1, setTcTeam1] = useState(factions[1]?.id || 'hive');

  const handleStart = () => {
    setBotSetting(0, bot0);
    setBotSetting(1, bot1);
    setCoachEnabled(false);
    startGame([faction0, faction1], seed);
  };

  // Train: you (P1) vs the greedy AI (P2), with the coaching sidebar on from the start.
  const handleTrain = () => {
    setBotSetting(0, 'human');
    setBotSetting(1, 'greedy');
    setCoachEnabled(true);
    startGame([faction0, faction1], seed);
  };

  // Map generation options (all optional; sensible defaults applied in the engine).
  const mapgen = config.mapgen ?? {};
  const setMapgen = (patch: Partial<NonNullable<typeof config.mapgen>>) =>
    setConfig({ ...config, mapgen: { ...mapgen, ...patch } });

  // ── Win condition (single choice) ──
  const winKey: WinKey =
    config.winConditions.captureCapital ? 'captureCapital'
    : config.winConditions.highestScoreAtLimit ? 'highestScoreAtLimit'
    : 'captureAllCities';
  const setWin = (k: WinKey) => setConfig({
    ...config,
    winConditions: {
      ...config.winConditions,
      captureAllCities: k === 'captureAllCities',
      captureCapital: k === 'captureCapital',
      highestScoreAtLimit: k === 'highestScoreAtLimit',
    },
  });

  // ── Resources (single choice) ──
  const resKey: ResKey = config.unlimitedResources ? 'unlimited' : (mapgen.doubleResources ? 'double' : 'normal');
  const setRes = (k: ResKey) => setConfig({
    ...config,
    unlimitedResources: k === 'unlimited',
    mapgen: { ...mapgen, doubleResources: k === 'double' },
  });

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const text = await file.text();
        loadGame(text);
      }
    };
    input.click();
  };

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <h1>RIGBOUND</h1>
        <p className="subtitle">Turn-based tactical strategy prototype</p>

        <div className="setup-row">
          <div className="setup-field">
            <label>Map Size</label>
            <select value={mapPreset} onChange={e => setMapPreset(e.target.value as MapPreset)}>
              {(Object.keys(PRESET_LABELS) as MapPreset[]).map(p => (
                <option key={p} value={p}>{PRESET_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div className="setup-field">
            <label>Width</label>
            <input type="number" min={8} max={40} value={config.mapWidth} disabled={mapPreset !== 'custom'}
              onChange={e => setConfig({ ...config, mapWidth: Number(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label>Height</label>
            <input type="number" min={8} max={40} value={config.mapHeight} disabled={mapPreset !== 'custom'}
              onChange={e => setConfig({ ...config, mapHeight: Number(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label>Seed</label>
            <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} />
          </div>
        </div>

        <div className="setup-row">
          <div className="setup-field">
            <label>Map Type</label>
            <select
              value={mapgen.biome ?? 'grassland'}
              onChange={e => setMapgen({ biome: e.target.value as NonNullable<typeof mapgen.biome> })}
            >
              <option value="grassland">Grassland</option>
              <option value="stone">Stone</option>
            </select>
          </div>
          <div className="setup-field">
            <label>Map Generation</label>
            <select value={tileTheme} onChange={e => setTileTheme(e.target.value as typeof tileTheme)}>
              <option value="default">Default</option>
              <option value="gen2_volcanic">GEN 2 - Volcanic</option>
              <option value="grass_iso">Grassland (fantasy)</option>
              <option value="gen3_desert">GEN 3 - Desert</option>
              <option value="gen5_desert">GEN 5 - Desert</option>
            </select>
          </div>
        </div>

        <div className="setup-row">
          <div className="setup-field">
            <label>Player 1 Faction</label>
            <select value={faction0} onChange={e => setFaction0(e.target.value)}>
              {factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="setup-field">
            <label>Player 2 Faction</label>
            <select value={faction1} onChange={e => setFaction1(e.target.value)}>
              {factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>

        <div className="setup-row">
          <div className="setup-field">
            <label>Player 1 Control</label>
            <select value={bot0} onChange={e => setBot0(e.target.value as 'human' | 'random' | 'greedy')}>
              <option value="human">Human</option>
              <option value="random">Random Bot</option>
              <option value="greedy">Greedy Bot</option>
            </select>
          </div>
          <div className="setup-field">
            <label>Player 2 Control</label>
            <select value={bot1} onChange={e => setBot1(e.target.value as 'human' | 'random' | 'greedy')}>
              <option value="human">Human</option>
              <option value="random">Random Bot</option>
              <option value="greedy">Greedy Bot</option>
            </select>
          </div>
        </div>

        <div className="setup-field">
          <label>Turn Limit</label>
          <input type="number" min={10} max={200} value={config.turnLimit}
            onChange={e => setConfig({ ...config, turnLimit: Number(e.target.value) })} />
        </div>

        {/* ── Win condition (pick exactly one) ── */}
        <div className="setup-section">
          <div className="setup-section-title">Win Conditions</div>
          {WIN_OPTIONS.map(o => (
            <label key={o.key} className="radio-row">
              <input type="radio" name="winCondition" checked={winKey === o.key}
                onChange={() => setWin(o.key)} />
              {o.label}
            </label>
          ))}
        </div>

        {/* ── Resources (pick exactly one) ── */}
        <div className="setup-section">
          <div className="setup-section-title">Resources</div>
          {RES_OPTIONS.map(o => (
            <label key={o.key} className="radio-row">
              <input type="radio" name="resources" checked={resKey === o.key}
                onChange={() => setRes(o.key)} />
              {o.label}
            </label>
          ))}
        </div>

        {/* ── Mechanics (toggle any subset) ── */}
        <div className="setup-section">
          <div className="setup-section-title">Mechanics</div>
          <label className="checkbox-row">
            <input type="checkbox" checked={config.techTreeEnabled === true}
              onChange={e => setConfig({ ...config, techTreeEnabled: e.target.checked })} />
            Tech Tree
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={config.fogOfWar}
              onChange={e => setConfig({ ...config, fogOfWar: e.target.checked })} />
            Fog of War
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={config.nodesEnabled === true}
              onChange={e => setConfig({ ...config, nodesEnabled: e.target.checked })} />
            Nodes
          </label>
        </div>

        <div className="setup-actions">
          <button className="primary" onClick={handleStart}>Start Game</button>
          <button className="ghost" onClick={handleTrain} title="Play vs the AI with the coaching sidebar on">Train vs AI</button>
          <button className="ghost" onClick={handleLoad}>Load Game</button>
          <button className="ghost" onClick={initMapEditor}>Map Editor</button>
        </div>
      </div>

      {/* ── Test Combat Mode: a 14×14 sandbox with 3 cities & 2 of every unit per team ── */}
      <div className="setup-card">
        <h2 style={{ margin: '0 0 4px' }}>Test Combat Mode</h2>
        <p className="subtitle">
          14×14 arena — 3 cities each (rows 4 &amp; 11), a clean battlefield between them, and
          <b> 2 of every unit</b> each team can build. Uses the settings above (fog, tech tree,
          resources, map type…).
        </p>

        <div className="setup-row">
          <div className="setup-field">
            <label>Team 1</label>
            <select value={tcTeam0} onChange={e => setTcTeam0(e.target.value)}>
              {factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="setup-field">
            <label>Team 2</label>
            <select value={tcTeam1} onChange={e => setTcTeam1(e.target.value)}>
              {factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>

        <div className="setup-actions">
          <button className="primary" onClick={() => startTestCombat([tcTeam0, tcTeam1], seed)}>
            Start Test Combat
          </button>
        </div>
      </div>
    </div>
  );
}
