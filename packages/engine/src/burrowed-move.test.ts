import { describe, it, expect } from 'vitest';
import { createGame, getLegalActions } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: true, ...o });
const clear = (s: GameState) => { for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; } };
const mk = (id:number,t:string,o:number,x:number,y:number):Unit => ({ id, typeId:t, owner:o, position:{x,y}, hp:registry.unitTypes[t].maxHP, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
const base = () => { let s = createGame(cfg(), registry, ['hive','vanguard'], 7); s.units=[]; s.unitHomeCity={}; s.currentPlayer=0; clear(s); return s; };
const moves = (s: GameState) => getLegalActions(s, registry, 0).filter(a => a.type === 'move' && a.unitId === 1) as any[];
const canStop = (s: GameState, x: number, y: number) => moves(s).some(m => m.to.x===x && m.to.y===y && !m.bumpReveal);

describe('Burrowed Wyrm movement rules', () => {
  it('can move UNDER an enemy but NOT onto a friendly, city, ruin, or resource tile', () => {
    const s = base();
    s.units.push(mk(1,'wyrm_burrowed',0,4,4), mk(2,'warrior',1,5,4), mk(3,'reaper',0,3,4));
    expect(canStop(s, 5, 4)).toBe(true);   // enemy tile — allowed (co-occupy)
    expect(canStop(s, 3, 4)).toBe(false);  // friendly tile — blocked
    s.map.tiles[4][5+0]; // no-op
    // block by feature types (use empty tiles around)
    s.map.tiles[3][5].isCity = true;   // (5,3)
    s.map.tiles[5][5].isRuin = true;   // (5,5)
    s.map.tiles[5][3].isResourceTile = true; // (3,5)
    expect(canStop(s, 5, 3)).toBe(false); // city
    expect(canStop(s, 5, 5)).toBe(false); // ruin
    expect(canStop(s, 3, 5)).toBe(false); // resource
  });

  it('a burrowed Wyrm on an enemy/neutral city is never offered capture (it can\'t be there anyway)', () => {
    const s = base();
    // Force a burrowed wyrm onto a city tile and confirm no captureCity is offered.
    s.map.tiles[4][4].isCity = true;
    s.cities.push({ id: 99, owner: 1, position: { x: 4, y: 4 }, isCapital: false, level: 1, extraTerritory: [] } as any);
    s.units.push({ ...mk(1,'wyrm_burrowed',0,4,4), hasMoved: false });
    const caps = getLegalActions(s, registry, 0).filter(a => a.type === 'captureCity' && (a as any).unitId === 1);
    expect(caps.length).toBe(0);
  });
});
