import React from 'react';
import { useGameStore } from '../store/gameStore.js';
import type { UnitType, TerrainType, GameConfig } from '@tactica/engine';

export function EditorPanel() {
  const {
    editorTab, setEditorTab,
    units, setUnits,
    terrain, setTerrain,
    config, setConfig,
    registry,
  } = useGameStore();

  const handleExport = () => {
    const data = { terrain, units, config };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tactica-balance.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const text = await file.text();
        try {
          const data = JSON.parse(text);
          if (data.terrain) setTerrain(data.terrain);
          if (data.units) setUnits(data.units);
          if (data.config) setConfig(data.config);
        } catch (err) {
          console.error('Invalid JSON:', err);
        }
      }
    };
    input.click();
  };

  return (
    <div className="side-panel">
      <h3>Editor Panel</h3>

      <div className="tab-bar">
        {['units', 'terrain', 'config', 'export'].map(tab => (
          <button
            key={tab}
            className={editorTab === tab ? 'active' : ''}
            onClick={() => setEditorTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {editorTab === 'units' && <UnitEditor units={units} onChange={setUnits} />}
      {editorTab === 'terrain' && <TerrainEditor terrain={terrain} onChange={setTerrain} />}
      {editorTab === 'config' && <ConfigEditor config={config} onChange={setConfig} />}
      {editorTab === 'export' && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            Export or import balance data (units, terrain, config) as JSON.
          </p>
          <button className="primary" onClick={handleExport} style={{ width: '100%', marginBottom: 8 }}>
            Export JSON
          </button>
          <button className="ghost" onClick={handleImport} style={{ width: '100%', marginBottom: 8 }}>
            Import JSON
          </button>
          <button className="danger" onClick={() => {
            // Reset to defaults
            import('@tactica/data').then(mod => {
              setUnits([...mod.defaultUnits] as UnitType[]);
              setTerrain([...mod.defaultTerrain] as TerrainType[]);
              setConfig({ ...mod.defaultConfig } as GameConfig);
            });
          }} style={{ width: '100%' }}>
            Reset to Defaults
          </button>
        </div>
      )}
    </div>
  );
}

function UnitEditor({ units, onChange }: { units: UnitType[]; onChange: (u: UnitType[]) => void }) {
  const updateUnit = (idx: number, field: keyof UnitType, value: number) => {
    const updated = [...units];
    updated[idx] = { ...updated[idx], [field]: value };
    onChange(updated);
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Cost</th>
            <th>HP</th>
            <th>ATK</th>
            <th>DEF</th>
            <th>MOV</th>
            <th>RNG</th>
            <th>Vis</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u, i) => (
            <tr key={u.id}>
              <td style={{ fontSize: 11, fontWeight: 600 }}>{u.name}</td>
              <td><input type="number" value={u.cost} onChange={e => updateUnit(i, 'cost', Number(e.target.value))} /></td>
              <td><input type="number" value={u.maxHP} onChange={e => updateUnit(i, 'maxHP', Number(e.target.value))} /></td>
              <td><input type="number" value={u.attack} onChange={e => updateUnit(i, 'attack', Number(e.target.value))} /></td>
              <td><input type="number" value={u.defence} onChange={e => updateUnit(i, 'defence', Number(e.target.value))} /></td>
              <td><input type="number" value={u.movement} onChange={e => updateUnit(i, 'movement', Number(e.target.value))} /></td>
              <td><input type="number" value={u.attackRange} onChange={e => updateUnit(i, 'attackRange', Number(e.target.value))} /></td>
              <td><input type="number" value={u.visibility} onChange={e => updateUnit(i, 'visibility', Number(e.target.value))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TerrainEditor({ terrain, onChange }: { terrain: TerrainType[]; onChange: (t: TerrainType[]) => void }) {
  const updateTerrain = (idx: number, field: string, value: number | boolean) => {
    const updated = [...terrain];
    updated[idx] = { ...updated[idx], [field]: value };
    onChange(updated);
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Move Cost</th>
            <th>Def Bonus</th>
            <th>Blocks Sight</th>
            <th>Passable</th>
            <th>Resource</th>
          </tr>
        </thead>
        <tbody>
          {terrain.map((t, i) => (
            <tr key={t.id}>
              <td style={{ fontSize: 11, fontWeight: 600 }}>{t.name}</td>
              <td><input type="number" value={t.movementCost} onChange={e => updateTerrain(i, 'movementCost', Number(e.target.value))} /></td>
              <td><input type="number" step="0.1" value={t.defenceBonus} onChange={e => updateTerrain(i, 'defenceBonus', Number(e.target.value))} /></td>
              <td><input type="checkbox" checked={t.blocksSight} onChange={e => updateTerrain(i, 'blocksSight', e.target.checked)} /></td>
              <td><input type="checkbox" checked={t.passable} onChange={e => updateTerrain(i, 'passable', e.target.checked)} /></td>
              <td><input type="number" value={t.resourceYield} onChange={e => updateTerrain(i, 'resourceYield', Number(e.target.value))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfigEditor({ config, onChange }: { config: GameConfig; onChange: (c: GameConfig) => void }) {
  const update = (path: string, value: number | boolean) => {
    const parts = path.split('.');
    const newConfig = JSON.parse(JSON.stringify(config));
    let obj: Record<string, unknown> = newConfig;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]] as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]] = value;
    onChange(newConfig);
  };

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Combat</h3>
      <div className="stat-row">
        <label>HP Scaling</label>
        <input type="checkbox" checked={config.combatConfig.hpScaling}
          onChange={e => update('combatConfig.hpScaling', e.target.checked)} />
      </div>
      <div className="stat-row">
        <label>Retaliation Mult</label>
        <input type="number" step="0.1" value={config.combatConfig.retaliationMultiplier}
          onChange={e => update('combatConfig.retaliationMultiplier', Number(e.target.value))} />
      </div>
      <div className="stat-row">
        <label>Min Damage</label>
        <input type="number" value={config.combatConfig.minimumDamage}
          onChange={e => update('combatConfig.minimumDamage', Number(e.target.value))} />
      </div>
      <div className="stat-row">
        <label>Damage Variance</label>
        <input type="number" step="0.05" min="0" max="1" value={config.combatConfig.damageVariance}
          onChange={e => update('combatConfig.damageVariance', Number(e.target.value))} />
      </div>

      <h3 style={{ marginTop: 16 }}>Scoring</h3>
      <div className="stat-row">
        <label>City Value</label>
        <input type="number" value={config.scoreWeights.cityValue}
          onChange={e => update('scoreWeights.cityValue', Number(e.target.value))} />
      </div>
      <div className="stat-row">
        <label>Unit Cost Value</label>
        <input type="number" value={config.scoreWeights.unitCostValue}
          onChange={e => update('scoreWeights.unitCostValue', Number(e.target.value))} />
      </div>
      <div className="stat-row">
        <label>Income Value</label>
        <input type="number" value={config.scoreWeights.incomeValue}
          onChange={e => update('scoreWeights.incomeValue', Number(e.target.value))} />
      </div>
    </div>
  );
}
