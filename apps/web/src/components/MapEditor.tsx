import React from 'react';
import { useGameStore } from '../store/gameStore.js';
import { IsoCanvas } from '../iso/IsoCanvas.js';

export function MapEditor() {
  const {
    mapEditorState, mapEditorTerrain, mapEditorTool,
    setMapEditorTerrain, setMapEditorTool, mapEditorPaint,
    exportMap, setScreen, registry,
  } = useGameStore();

  if (!mapEditorState) return null;

  const handleExport = () => {
    const json = exportMap();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tactica-map.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div className="map-editor-toolbar">
        <label>Tool:</label>
        {(['terrain', 'city', 'erase'] as const).map(t => (
          <button key={t} className={mapEditorTool === t ? 'primary' : 'ghost'}
            onClick={() => setMapEditorTool(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}

        {mapEditorTool === 'terrain' && (
          <>
            <label style={{ marginLeft: 16 }}>Terrain:</label>
            <select value={mapEditorTerrain} onChange={e => setMapEditorTerrain(e.target.value)}>
              {Object.values(registry.terrainTypes).map(t => (
                <option key={t.id} value={t.id}>{t.icon} {t.name}</option>
              ))}
            </select>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="primary" onClick={handleExport}>Export Map</button>
          <button className="ghost" onClick={() => setScreen('setup')}>Back</button>
        </div>
      </div>

      <div className="map-container">
        <IsoCanvas mode="editor" onPaint={(x, y) => mapEditorPaint(x, y)} />
      </div>
    </div>
  );
}
