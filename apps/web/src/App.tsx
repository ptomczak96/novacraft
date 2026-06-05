import React from 'react';
import { useGameStore } from './store/gameStore.js';
import { SetupScreen } from './components/SetupScreen.js';
import { GameScreen } from './components/GameScreen.js';
import { MapEditor } from './components/MapEditor.js';

export function App() {
  const screen = useGameStore(s => s.screen);

  return (
    <div className="app">
      {screen === 'setup' && <SetupScreen />}
      {screen === 'game' && <GameScreen />}
      {screen === 'mapEditor' && <MapEditor />}
    </div>
  );
}
