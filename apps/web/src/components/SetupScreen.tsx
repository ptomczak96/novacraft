import React, { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { EvoSelect, EvoCheckbox, EvoButton } from './evo/EvoControls.js';

const BOT_OPTIONS = [
  { value: 'human', label: 'Human' },
  { value: 'random', label: 'Random Bot' },
  { value: 'greedy', label: 'Greedy Bot' },
];

const BIOME_OPTIONS = [
  { value: 'grassland', label: 'Grassland' },
  { value: 'stone', label: 'Stone' },
  { value: 'desert', label: 'Desert' },
];

const THEME_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'gen2_volcanic', label: 'GEN 2 - Volcanic' },
  { value: 'grass_iso', label: 'Grassland (fantasy)' },
  { value: 'gen3_desert', label: 'GEN 3 - Desert' },
  { value: 'gen5_desert', label: 'GEN 5 - Desert' },
  { value: 'gen6_desert', label: 'GEN 6 - Desert (Scenario)' },
  { value: 'itb_desert', label: 'ITB - Desert' },
  { value: 'gen7_industrial', label: 'GEN 7 - Industrial' },
];

export function SetupScreen() {
  const { config, setConfig, factions, startGame, initMapEditor, loadGame, setBotSetting, tileTheme, setTileTheme, musicMuted, setMusicMuted } = useGameStore();
  // Seed is random per visit — deliberately no UI for it (Patrick, 2026-07-22).
  const [seed] = useState(Math.floor(Math.random() * 100000));
  const [faction0, setFaction0] = useState(factions[0]?.id || 'vanguard');
  const [faction1, setFaction1] = useState(factions[1]?.id || 'hive');
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

  const factionOptions = factions.map(f => ({ value: f.id, label: f.name }));

  return (
    <div className="setup-screen evo">
      <div className="setup-card">
        <img className="setup-logo" src="/rigbound-logo.png" alt="RIGBOUND" />

        <div className="evo-section">Battlefield</div>
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
        </div>

        <div className="setup-row">
          <div className="setup-field">
            <label>Map Type</label>
            <EvoSelect
              value={mapgen.biome ?? 'grassland'}
              options={BIOME_OPTIONS}
              onChange={v => setMapgen({ biome: v as NonNullable<typeof mapgen.biome> })}
            />
          </div>
          <div className="setup-field">
            <label>Map Generation</label>
            <EvoSelect
              value={tileTheme}
              options={THEME_OPTIONS}
              onChange={v => setTileTheme(v as typeof tileTheme)}
            />
          </div>
        </div>

        <div className="evo-section">Combatants</div>
        <div className="setup-row">
          <div className="setup-field">
            <label>Player 1 Faction</label>
            <EvoSelect value={faction0} options={factionOptions} onChange={setFaction0} />
          </div>
          <div className="setup-field">
            <label>Player 2 Faction</label>
            <EvoSelect value={faction1} options={factionOptions} onChange={setFaction1} />
          </div>
        </div>

        <div className="setup-row">
          <div className="setup-field">
            <label>Player 1 Control</label>
            <EvoSelect value={bot0} options={BOT_OPTIONS}
              onChange={v => setBot0(v as 'human' | 'random' | 'greedy')} />
          </div>
          <div className="setup-field">
            <label>Player 2 Control</label>
            <EvoSelect value={bot1} options={BOT_OPTIONS}
              onChange={v => setBot1(v as 'human' | 'random' | 'greedy')} />
          </div>
        </div>

        <div className="evo-section">Rules</div>
        <div className="setup-field">
          <label>Turn Limit</label>
          <input type="number" min={10} max={200} value={config.turnLimit}
            onChange={e => setConfig({ ...config, turnLimit: Number(e.target.value) })} />
        </div>

        <div className="evo-checkbox-grid">
          <EvoCheckbox id="fog" label="Fog of War" checked={config.fogOfWar}
            onChange={v => setConfig({ ...config, fogOfWar: v })} />
          <EvoCheckbox id="tech-tree" label="Tech Tree" checked={config.techTreeEnabled === true}
            onChange={v => setConfig({ ...config, techTreeEnabled: v })} />
          <EvoCheckbox id="wc-cities" label="Win: Capture All Cities"
            checked={config.winConditions.captureAllCities}
            onChange={v => setConfig({ ...config, winConditions: { ...config.winConditions, captureAllCities: v } })} />
          <EvoCheckbox id="wc-score" label="Win: Highest Score at Turn Limit"
            checked={config.winConditions.highestScoreAtLimit}
            onChange={v => setConfig({ ...config, winConditions: { ...config.winConditions, highestScoreAtLimit: v } })} />
          <EvoCheckbox id="double-res" label="Double Resources (For testing)"
            checked={mapgen.doubleResources ?? false}
            onChange={v => setMapgen({ doubleResources: v })} />
          <EvoCheckbox id="rich-start" label="Rich start - for testing"
            checked={config.richStart ?? false}
            onChange={v => setConfig({ ...config, richStart: v })} />
          <EvoCheckbox id="mute-audio" label="Mute audio" checked={musicMuted}
            onChange={setMusicMuted} />
        </div>

        <div className="setup-actions">
          <EvoButton primary onClick={handleStart}>Start Game</EvoButton>
          <EvoButton onClick={handleLoad}>Load Game</EvoButton>
          <EvoButton onClick={initMapEditor}>Map Editor</EvoButton>
        </div>
      </div>
    </div>
  );
}
