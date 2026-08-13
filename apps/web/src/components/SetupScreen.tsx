import React, { useState } from 'react';
import { useGameStore, type BotSetting } from '../store/gameStore.js';
import { EvoSelect, EvoCheckbox, EvoButton } from './evo/EvoControls.js';
import { MultiplayerLobby } from './MultiplayerLobby.js';

const BOT_OPTIONS = [
  { value: 'human', label: 'Human' },
  { value: 'random', label: 'Random Bot' },
  { value: 'greedy', label: 'Greedy Bot' },
  { value: 'odysseus', label: 'Odysseus' },
  { value: 'achilles', label: 'Achilles' },
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
  { value: 'gen8_tileset3d', label: 'GEN 8 - 3D Tileset' },
];

// Win condition & resource choices are single-select (David, 2026-07-22).
const WIN_OPTIONS = [
  { value: 'captureAllCities', label: 'Capture all cities' },
  { value: 'captureCapital', label: 'Capture capital' },
  { value: 'highestScoreAtLimit', label: 'Highest score at turn limit' },
];
const RES_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'rich', label: 'Rich (2000 ore + plasma)' },
  { value: 'unlimited', label: 'Unlimited resources' },
];
// Preset map sizes (square). Selecting one sets both width & height.
const MAP_SIZE_OPTIONS = [
  { value: '11', label: 'Tiny (11×11)' },
  { value: '14', label: 'Small (14×14)' },
  { value: '16', label: 'Normal (16×16)' },
  { value: '18', label: 'Large (18×18)' },
  { value: '20', label: 'Huge (20×20)' },
];

export function SetupScreen() {
  const { config, setConfig, factions, startGame, initMapEditor, loadGame, setBotSetting, setCoachEnabled, tileTheme, setTileTheme, musicMuted, setMusicMuted } = useGameStore();
  // Seed is random per visit — deliberately no UI for it (Patrick, 2026-07-22).
  const [seed] = useState(Math.floor(Math.random() * 100000));
  const [faction0, setFaction0] = useState(factions[0]?.id || 'vanguard');
  const [faction1, setFaction1] = useState(factions[1]?.id || 'hive');
  const [bot0, setBot0] = useState<BotSetting>('human');
  const [bot1, setBot1] = useState<BotSetting>('human');
  const [showLobby, setShowLobby] = useState(false);

  const handleStart = () => {
    setBotSetting(0, bot0);
    setBotSetting(1, bot1);
    setCoachEnabled(false);
    startGame([faction0, faction1], seed);
  };

  // Play you (P1, human) vs a named AI (P2). Odysseus = the handcrafted bot; Achilles =
  // Patrick's slot (greedy placeholder until his AI lands).
  const handleVsBot = (bot: 'odysseus' | 'achilles') => {
    setBotSetting(0, 'human');
    setBotSetting(1, bot);
    setCoachEnabled(false);
    startGame([faction0, faction1], seed);
  };

  // Map generation options (all optional; sensible defaults applied in the engine).
  const mapgen = config.mapgen ?? {};
  const setMapgen = (patch: Partial<NonNullable<typeof config.mapgen>>) =>
    setConfig({ ...config, mapgen: { ...mapgen, ...patch } });

  // ── Win condition (single choice) ──
  const winKey = config.winConditions.captureCapital ? 'captureCapital'
    : config.winConditions.highestScoreAtLimit ? 'highestScoreAtLimit'
    : 'captureAllCities';
  const setWin = (k: string) => setConfig({
    ...config,
    winConditions: {
      ...config.winConditions,
      captureAllCities: k === 'captureAllCities',
      captureCapital: k === 'captureCapital',
      highestScoreAtLimit: k === 'highestScoreAtLimit',
    },
  });

  // ── Resources (single choice): Normal / Rich (rich start) / Unlimited ──
  const resKey = config.unlimitedResources ? 'unlimited' : (config.richStart ? 'rich' : 'normal');
  const setRes = (k: string) => setConfig({
    ...config,
    unlimitedResources: k === 'unlimited',
    richStart: k === 'rich',
    mapgen: { ...mapgen, doubleResources: false }, // "Double" retired in favour of Rich
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

  const factionOptions = factions.map(f => ({ value: f.id, label: f.name }));

  return (
    <div className="setup-screen evo">
      <div className="setup-card">
        <img className="setup-logo" src="/rigbound-logo.png" alt="RIGBOUND" />

        <div className="evo-section">Battlefield</div>
        <div className="setup-row">
          <div className="setup-field">
            <label>Map Size</label>
            <EvoSelect
              value={String(config.mapWidth)}
              options={MAP_SIZE_OPTIONS}
              onChange={v => setConfig({ ...config, mapWidth: Number(v), mapHeight: Number(v) })}
            />
          </div>
          <div className="setup-field">
            <label>Width</label>
            <input type="number" min={8} max={24} value={config.mapWidth}
              onChange={e => setConfig({ ...config, mapWidth: Number(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label>Height</label>
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
              onChange={v => setBot0(v as BotSetting)} />
          </div>
          <div className="setup-field">
            <label>Player 2 Control</label>
            <EvoSelect value={bot1} options={BOT_OPTIONS}
              onChange={v => setBot1(v as BotSetting)} />
          </div>
        </div>

        <div className="evo-section">Rules</div>
        <div className="setup-field">
          <label>Turn Limit (blank = Off)</label>
          <input type="number" min={0} max={200} placeholder="Off"
            value={config.turnLimit > 0 ? config.turnLimit : ''}
            onChange={e => setConfig({ ...config, turnLimit: Number(e.target.value) || 0 })} />
        </div>

        {/* Win Conditions & Resources — pick exactly one each (David's 3/3/3 options). */}
        <div className="setup-row">
          <div className="setup-field">
            <label>Win Condition</label>
            <EvoSelect value={winKey} options={WIN_OPTIONS} onChange={setWin} />
          </div>
          <div className="setup-field">
            <label>Resources</label>
            <EvoSelect value={resKey} options={RES_OPTIONS} onChange={setRes} />
          </div>
        </div>

        {/* Mechanics — toggle any subset. */}
        <div className="evo-checkbox-grid">
          <EvoCheckbox id="tech-tree" label="Tech Tree" checked={config.techTreeEnabled === true}
            onChange={v => setConfig({ ...config, techTreeEnabled: v })} />
          <EvoCheckbox id="fog" label="Fog of War" checked={config.fogOfWar}
            onChange={v => setConfig({ ...config, fogOfWar: v })} />
          <EvoCheckbox id="nodes" label="Nodes" checked={config.nodesEnabled === true}
            onChange={v => setConfig({ ...config, nodesEnabled: v })} />
          <EvoCheckbox id="mute-audio" label="Mute soundtrack" checked={musicMuted}
            onChange={setMusicMuted} />
        </div>

        <div className="setup-actions">
          <EvoButton primary onClick={handleStart}>Start Game</EvoButton>
          <EvoButton onClick={() => setShowLobby(true)}>Online 1v1</EvoButton>
          <EvoButton onClick={() => handleVsBot('odysseus')}>Odysseus</EvoButton>
          <EvoButton onClick={() => handleVsBot('achilles')}>Achilles</EvoButton>
          <EvoButton onClick={handleLoad}>Load Game</EvoButton>
          <EvoButton onClick={initMapEditor}>Map Editor</EvoButton>
        </div>
      </div>

      {showLobby && (
        <MultiplayerLobby factions={[faction0, faction1]} seed={seed} onClose={() => setShowLobby(false)} />
      )}
    </div>
  );
}
