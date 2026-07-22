import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, getVisibleState } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit, MoveAction } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: true, ...o });
const mk = (id:number,t:string,o:number,x:number,y:number):Unit => ({ id, typeId:t, owner:o, position:{x,y}, hp:registry.unitTypes[t].maxHP, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
const u = (s:GameState,id:number)=> s.units.find(x=>x.id===id);
const wipeMem = (s:GameState) => { for (const m of s.memory ?? []) m.tiles = m.tiles.map(r=>r.map(()=>null)); };
const base = () => {
  let s = createGame(cfg(), registry, ['hive','vanguard'], 7);
  s.units=[]; s.unitHomeCity={}; s.currentPlayer=0;
  for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; }
  return s;
};
const moves = (s:GameState,id:number)=> getLegalActions(s,registry,0).filter(a=>a.type==='move'&&a.unitId===id) as MoveAction[];
const sees = (s:GameState,viewer:0|1,id:number)=> getVisibleState(s,viewer,registry).units.some(x=>x.id===id);

describe('Blind death on lethal (void) terrain', () => {
  it('a blind unit walks onto a HIDDEN lava tile and dies (the tile is revealed)', () => {
    let s = base();
    s.map.tiles[3][4].terrain = 'lava';    // (4,3) lava
    wipeMem(s);                            // nothing known → the lava is hidden under cloud
    s.units.push(mk(1,'scuttling',0,3,3)); // blind
    const mv = moves(s,1).find(m=>m.to.x===4&&m.to.y===3&&!m.bumpReveal);
    expect(mv).toBeDefined();              // offered as a normal (fatal) move, not a bump
    s = applyAction(s, mv!, registry);
    expect(u(s,1)).toBeUndefined();        // fell in and died
    expect(s.revealedTiles[0].some(t=>t.x===4&&t.y===3)).toBe(true); // lava revealed
  });

  it('a blind unit will NOT walk onto an already-REVEALED lava tile (blocked, no death)', () => {
    let s = base();
    s.map.tiles[3][4].terrain = 'lava';
    wipeMem(s);
    s.memory![0].tiles[3][4] = JSON.parse(JSON.stringify(s.map.tiles[3][4])); // known lava
    s.units.push(mk(1,'scuttling',0,3,3));
    expect(moves(s,1).some(m=>m.to.x===4&&m.to.y===3)).toBe(false); // not offered at all
  });
});

describe('Cloak bump', () => {
  it('a NON-blind unit bumps a cloaked enemy: reveals it this turn and does NOT move', () => {
    let s = base();
    const reaper = mk(1,'reaper',0,3,3);   // hive, not blind, MOV 2
    const wraith = mk(2,'wraith',1,4,3);   // vanguard, cloaked
    s.units.push(reaper, wraith);
    expect(sees(s,0,2)).toBe(false);       // cloaked → hidden from player 0 before the bump
    const mv = moves(s,1).find(m=>m.to.x===4&&m.to.y===3);
    expect(mv).toBeDefined();              // offered as a bump target (was a silent blocker before)
    s = applyAction(s, mv!, registry);
    expect(u(s,1)!.position).toEqual({x:3,y:3}); // reaper stayed put (bump cancels the move)
    expect(u(s,1)!.hasMoved).toBe(true);
    expect(sees(s,0,2)).toBe(true);        // wraith revealed for the turn
    // Reveal clears when the player's turn ends.
    s = applyAction(s, { type:'endTurn' }, registry);
    expect(sees(s,0,2)).toBe(false);       // cloaked again
  });

  it('a BLIND unit bumps a cloaked enemy but CANNOT reveal it', () => {
    let s = base();
    s.units.push(mk(1,'scuttling',0,3,3), mk(2,'wraith',1,4,3));
    const mv = moves(s,1).find(m=>m.to.x===4&&m.to.y===3);
    expect(mv).toBeDefined();
    s = applyAction(s, mv!, registry);
    expect(u(s,1)!.position).toEqual({x:3,y:3}); // stayed (bump)
    expect(u(s,1)!.hasMoved).toBe(true);
    expect(sees(s,0,2)).toBe(false);       // NOT revealed — blind can't pierce cloak
  });
});
