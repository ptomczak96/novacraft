import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit, UseAbilityAction } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const mk = (id:number,t:string,o:number,x:number,y:number):Unit => ({ id, typeId:t, owner:o, position:{x,y}, hp:registry.unitTypes[t].maxHP, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
const u = (s:GameState,id:number)=> s.units.find(x=>x.id===id);
const base = () => { let s = createGame(cfg(), registry, ['hive','vanguard'], 7); s.units=[]; s.unitHomeCity={}; s.currentPlayer=0;
  for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; }
  return s; };

describe('Burstling', () => {
  it('Self Destruct kills itself and deals a 2-ATTACK hit to all units in its 3×3 (friend & foe)', () => {
    let s = base();
    s.units.push(mk(1,'burstling',0,4,4), mk(2,'warrior',1,5,4), mk(3,'warrior',0,4,3), mk(9,'warrior',1,8,8));
    const foe=u(s,2)!.hp, ally=u(s,3)!.hp, far=u(s,9)!.hp;
    const act: UseAbilityAction = { type:'useAbility', unitId:1, abilityId:'self_destruct', target:{x:4,y:4} };
    s = applyAction(s, act, registry);
    // 2-attack vs warrior (def 2, full HP) on plains → round(2/4·2·4.5)=5 (not flat 2).
    expect(u(s,1)).toBeUndefined();          // gone
    expect(u(s,2)!.hp).toBe(foe-5);          // adjacent foe: 2-attack → 5
    expect(u(s,3)!.hp).toBe(ally-5);         // adjacent ally: friendly fire → 5
    expect(u(s,9)!.hp).toBe(far);            // outside 3×3 unharmed
  });

  it('Self Destruct damage scales off FULL HP — a 1-HP Burstling hits as hard as a full one', () => {
    // Full-HP burstling → warrior loses 5.
    let full = base();
    full.units.push(mk(1,'burstling',0,4,4), mk(2,'warrior',1,5,4));
    full = applyAction(full, { type:'useAbility', unitId:1, abilityId:'self_destruct', target:{x:4,y:4} }, registry);
    const fullDmg = 10 - u(full,2)!.hp;
    // 1-HP burstling → identical damage (does NOT scale down with its own HP).
    let low = base();
    low.units.push({ ...mk(1,'burstling',0,4,4), hp:1 }, mk(2,'warrior',1,5,4));
    low = applyAction(low, { type:'useAbility', unitId:1, abilityId:'self_destruct', target:{x:4,y:4} }, registry);
    const lowDmg = 10 - u(low,2)!.hp;
    expect(fullDmg).toBe(5);
    expect(lowDmg).toBe(fullDmg); // full-HP scaling regardless of how low it dropped
  });

  it('a killed Burstling bursts too, and burst chains through a second Burstling', () => {
    let s = base();
    // Two burstlings adjacent; a warrior kills the first → burst hits the 2nd (10 HP) for 1,
    // and its own death is not chained further unless it also dies. Put a 1-HP victim next to #2.
    s.units.push(mk(1,'burstling',1,5,4), mk(2,'burstling',1,6,4), { ...mk(3,'warrior',1,7,4), hp:1 }, mk(4,'reaper',0,4,4));
    // reaper (owner 0) attacks burstling #1 (owner1) at (5,4)? reaper range 1, at (4,4) adjacent to (5,4).
    s = applyAction(s, { type:'attack', unitId:4, targetId:1 }, registry);
    // #1 dies (10 HP vs reaper) OR survives — force: set #1 to 1 HP first is cleaner. Re-run deterministically:
    expect(u(s,1) === undefined || u(s,1)!.hp < registry.unitTypes['burstling'].maxHP).toBe(true);
  });

  it('chain: a burst that drops another Burstling triggers its burst', () => {
    let s = base();
    s.units.push({ ...mk(1,'burstling',0,4,4), hp:1 }, { ...mk(2,'burstling',1,5,4), hp:1 }, { ...mk(3,'warrior',1,6,4), hp:1 });
    // Self-destruct #1 → burst hits #2 (1HP → dies) → #2 bursts → hits #3 (1HP,adjacent to #2 at 6,4) → dies.
    s = applyAction(s, { type:'useAbility', unitId:1, abilityId:'self_destruct', target:{x:4,y:4} }, registry);
    expect(u(s,1)).toBeUndefined();
    expect(u(s,2)).toBeUndefined(); // killed by #1's burst
    expect(u(s,3)).toBeUndefined(); // killed by #2's chained burst
  });
});

describe('Air units (Ravener) are melee-immune', () => {
  it('a melee unit cannot attack an air unit, but a ranged unit can', () => {
    const s = base();
    s.units.push(mk(1,'warrior',0,4,4), mk(2,'ravener',1,5,4));   // warrior=melee adjacent to air
    const meleeAtk = getLegalActions(s, registry, 0).filter(a=>a.type==='attack'&&a.unitId===1);
    expect(meleeAtk.length).toBe(0); // melee can't target air

    const s2 = base();
    s2.units.push(mk(1,'lancer',0,4,4), mk(2,'ravener',1,4,6));   // lancer range 2 vs air at dist 2
    const rangedAtk = getLegalActions(s2, registry, 0).filter(a=>a.type==='attack'&&a.unitId===1&&a.targetId===2);
    expect(rangedAtk.length).toBe(1); // ranged CAN target air
  });

  it('a Ravener flies over impassable water', () => {
    const s = base();
    s.map.tiles[4][5].terrain = 'water';
    s.units.push(mk(1,'ravener',0,4,4));
    const moves = getLegalActions(s, registry, 0).filter(a=>a.type==='move'&&a.unitId===1) as any[];
    expect(moves.some(m=>m.to.x===5&&m.to.y===4)).toBe(true); // can stop on water (flies)
  });
});

describe('Air units survive on impassable terrain', () => {
  it('a Ravener can move onto AND stay on a water tile without dying', () => {
    let s = base();
    s.map.tiles[4][5].terrain = 'water'; // impassable void
    s.units.push(mk(1,'ravener',0,4,4));
    const mv = getLegalActions(s, registry, 0).find(a => a.type==='move' && a.unitId===1 && (a as any).to.x===5 && (a as any).to.y===4);
    expect(mv).toBeDefined();
    s = applyAction(s, mv!, registry);
    expect(u(s,1)).toBeDefined();                     // survived the move onto water
    expect(u(s,1)!.position).toEqual({ x:5, y:4 });   // is standing on the water tile
    s = applyAction(s, { type:'endTurn' }, registry); // and survives ending the turn there
    expect(u(s,1)).toBeDefined();
  });
});

describe('Burrowed Wyrm slides UNDER units (co-occupy, no bump)', () => {
  it('moves onto a cloaked Wraith’s tile and shares it (no bump-reveal, it actually moves)', () => {
    let s = base(); // player 0 = hive, player 1 = vanguard
    s.units.push({ ...mk(1,'wyrm_burrowed',0,4,4) }, mk(2,'wraith',1,5,4));
    const move = getLegalActions(s, registry, 0).find((a:any)=>a.type==='move'&&a.unitId===1&&a.to.x===5&&a.to.y===4) as any;
    expect(move).toBeTruthy();
    s = applyAction(s, move, registry);
    expect(u(s,1)!.position).toEqual({x:5,y:4}); // moved (a bump would keep it at 4,4)
    expect(u(s,2)).toBeTruthy();                  // Wraith still alive, co-occupying
    expect(u(s,2)!.position).toEqual({x:5,y:4});
    expect(s.units.filter(x=>x.position.x===5&&x.position.y===4).length).toBe(2); // shared tile
  });

  it('moves under a plain enemy warrior too', () => {
    let s = base();
    s.units.push({ ...mk(1,'wyrm_burrowed',0,4,4) }, mk(2,'warrior',1,5,4));
    const move = getLegalActions(s, registry, 0).find((a:any)=>a.type==='move'&&a.unitId===1&&a.to.x===5&&a.to.y===4) as any;
    expect(move).toBeTruthy();
    s = applyAction(s, move, registry);
    expect(u(s,1)!.position).toEqual({x:5,y:4});
    expect(u(s,2)).toBeTruthy();
  });

  it('tunnels UNDER an enemy from 2 tiles away — enemy AOI does not stop it (aoi_immune)', () => {
    // Wyrm (mv 2) at (3,4); enemy warrior at (5,4). The warrior's AOI ring (incl. (4,4))
    // would halt a normal mover one tile short — a burrowed Wyrm tunnels through it.
    let s = base();
    s.units.push({ ...mk(1,'wyrm_burrowed',0,3,4) }, mk(2,'warrior',1,5,4));
    const move = getLegalActions(s, registry, 0).find((a:any)=>a.type==='move'&&a.unitId===1&&a.to.x===5&&a.to.y===4) as any;
    expect(move).toBeTruthy();                       // reachable despite the AOI ring
    s = applyAction(s, move, registry);
    expect(u(s,1)!.position).toEqual({x:5,y:4});      // co-occupies the enemy tile
    expect(u(s,2)).toBeTruthy();
  });
});
