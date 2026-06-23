import React, { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';

export function SetupScreen() {
  const { config, setConfig, factions, startGame, initMapEditor, loadGame, setBotSetting } = useGameStore();
  const [seed, setSeed] = useState(Math.floor(Math.random() * 100000));
  const [faction0, setFaction0] = useState(factions[0]?.id || 'ironclad');
  const [faction1, setFaction1] = useState(factions[1]?.id || 'sylvan');
  const [bot0, setBot0] = useState<'human' | 'random' | 'greedy'>('human');
  const [bot1, setBot1] = useState<'human' | 'random' | 'greedy'>('human');

  const handleStart = () => {
    setBotSetting(0, bot0);
    setBotSetting(1, bot1);
    startGame([faction0, faction1], seed);
  };

  // Map generation options (all optional; sensible defaults applied in the engine).
  const mapgen = config.mapgen ?? {};
  const setMapgen = (patch: Partial<NonNullable<typeof config.mapgen>>) =>
    setConfig({ ...config, mapgen: { ...mapgen, ...patch } });

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
        <h1>TACTICA</h1>
        <p className="subtitle">Turn-based tactical strategy prototype</p>

        <div className="setup-row">
          <div className="setup-field">
            <label>Map Width</label>
            <input type="number" min={8} max={24} value={config.mapWidth}
              onChange={e => setConfig({ ...config, mapWidth: Number(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label>Map Height</label>
            <input type="number" min={8} max={24} value={config.mapHeight}
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

        <div className="checkbox-row">
          <input type="checkbox" id="fog" checked={config.fogOfWar}
            onChange={e => setConfig({ ...config, fogOfWar: e.target.checked })} />
          <label htmlFor="fog">Fog of War</label>
        </div>

        <div className="checkbox-row">
          <input type="checkbox" id="wc-cities" checked={config.winConditions.captureAllCities}
            onChange={e => setConfig({ ...config, winConditions: { ...config.winConditions, captureAllCities: e.target.checked } })} />
          <label htmlFor="wc-cities">Win: Capture All Cities</label>
        </div>
        <div className="checkbox-row">
          <input type="checkbox" id="wc-elim" checked={config.winConditions.eliminateAllUnits}
            onChange={e => setConfig({ ...config, winConditions: { ...config.winConditions, eliminateAllUnits: e.target.checked } })} />
          <label htmlFor="wc-elim">Win: Eliminate All Units</label>
        </div>
        <div className="checkbox-row">
          <input type="checkbox" id="wc-score" checked={config.winConditions.highestScoreAtLimit}
            onChange={e => setConfig({ ...config, winConditions: { ...config.winConditions, highestScoreAtLimit: e.target.checked } })} />
          <label htmlFor="wc-score">Win: Highest Score at Turn Limit</label>
        </div>

        <div className="setup-actions">
          <button className="primary" onClick={handleStart}>Start Game</button>
          <button className="ghost" onClick={handleLoad}>Load Game</button>
          <button className="ghost" onClick={initMapEditor}>Map Editor</button>
        </div>
      </div>
    </div>
  );
}
