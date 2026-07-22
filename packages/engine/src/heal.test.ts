import { describe, it, expect } from 'vitest';
import { createGame, applyAction } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const mk = (id:number,t:string,o:number,x:number,y:number,hp:number):Unit => ({ id, typeId:t, owner:o, position:{x,y}, hp, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
const base = () => { const s = createGame(cfg(), registry, ['vanguard','hive'], 7); s.units=[]; s.unitHomeCity={}; s.currentPlayer=0;
  for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.owner=null; t.isCity=false; }
  return s; };
const u = (s:GameState,id:number)=> s.units.find(x=>x.id===id)!;

describe('Passive heal (no move & no attack)', () => {
  it('friendly territory +4, neutral +2, enemy +0; capped at maxHP', () => {
    const s = base();
    // warrior maxHP 10. Three warriors at 3 HP on friendly / neutral / enemy tiles.
    s.map.tiles[3][3].owner = 0; // friendly
    s.map.tiles[3][5].owner = null; // neutral
    s.map.tiles[3][7].owner = 1; // enemy
    s.units.push(mk(1,'warrior',0,3,3,3), mk(2,'warrior',0,5,3,3), mk(3,'warrior',0,7,3,3));
    const ns = applyAction(s, { type:'endTurn' }, registry);
    expect(u(ns,1).hp).toBe(7); // 3 + 4 friendly
    expect(u(ns,2).hp).toBe(5); // 3 + 2 neutral
    expect(u(ns,3).hp).toBe(3); // 3 + 0 enemy
  });

  it('a unit that MOVED or ATTACKED does not heal', () => {
    const s = base();
    s.map.tiles[3][3].owner = 0;
    s.units.push({ ...mk(1,'warrior',0,3,3,3), hasMoved: true });
    s.units.push({ ...mk(2,'warrior',0,4,3,3), hasAttacked: true });
    const ns = applyAction(s, { type:'endTurn' }, registry);
    expect(u(ns,1).hp).toBe(3);
    expect(u(ns,2).hp).toBe(3);
  });

  it('heal never exceeds maxHP', () => {
    const s = base();
    s.map.tiles[3][3].owner = 0;
    s.units.push(mk(1,'warrior',0,3,3,8)); // 8/10, +4 friendly would be 12 → capped 10
    const ns = applyAction(s, { type:'endTurn' }, registry);
    expect(u(ns,1).hp).toBe(10);
  });
});
