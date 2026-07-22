import { describe, it, expect } from 'vitest';
import { createGame, getVisibleState } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const mk = (id:number,t:string,o:number,x:number,y:number):Unit => ({ id, typeId:t, owner:o, position:{x,y}, hp:registry.unitTypes[t].maxHP, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
const base = () => { let s = createGame(cfg(), registry, ['vanguard','hive'], 7); s.units=[]; s.unitHomeCity={};
  for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; }
  return s; };
// Is the player-0 wraith visible to the enemy (player 1)?
const enemySees = (s:GameState)=> getVisibleState(s, 1, registry).units.some(u=>u.id===1);

describe('Wraith uncloaks on ruins / enemy cities', () => {
  it('stays cloaked on open ground', () => {
    const s = base(); s.units.push(mk(1,'wraith',0,4,4));
    expect(enemySees(s)).toBe(false);
  });

  it('uncloaks while standing on a ruin', () => {
    const s = base(); s.map.tiles[4][4].isRuin = true; s.units.push(mk(1,'wraith',0,4,4));
    expect(enemySees(s)).toBe(true);
  });

  it('uncloaks on an ENEMY city, but NOT on its own city or a neutral one', () => {
    // Enemy (player 1) city at (4,4)
    let s = base(); s.map.tiles[4][4].isCity = true;
    s.cities.push({ id: 90, owner: 1, position: {x:4,y:4}, isCapital:false, level:1, supply:0, incomeBonus:0, popBonus:0, bonusSupply:0, fortified:false, extraTerritory:[] } as any);
    s.units.push(mk(1,'wraith',0,4,4));
    expect(enemySees(s)).toBe(true);

    // Own city → still cloaked
    let s2 = base(); s2.map.tiles[4][4].isCity = true;
    s2.cities.push({ id: 91, owner: 0, position: {x:4,y:4}, isCapital:false, level:1, supply:0, incomeBonus:0, popBonus:0, bonusSupply:0, fortified:false, extraTerritory:[] } as any);
    s2.units.push(mk(1,'wraith',0,4,4));
    expect(enemySees(s2)).toBe(false);

    // Neutral city (owner null) → still cloaked (not an "enemy" city)
    let s3 = base(); s3.map.tiles[4][4].isCity = true;
    s3.cities.push({ id: 92, owner: null, position: {x:4,y:4}, isCapital:false, level:1, supply:0, incomeBonus:0, popBonus:0, bonusSupply:0, fortified:false, extraTerritory:[] } as any);
    s3.units.push(mk(1,'wraith',0,4,4));
    expect(enemySees(s3)).toBe(false);
  });
});
