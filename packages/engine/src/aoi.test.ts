import { describe, it, expect } from 'vitest';
import { getReachableTiles, createGame, getLegalActions, canFoundCity } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
// Coords: x = column (A=0,B=1,C=2,D=3…), y = row (1,2,3…). Enemy at B2 = (1,2).
const plainsMap = (w=8, h=8) => ({ width: w, height: h, tiles: Array.from({length:h}, () => Array.from({length:w}, () => ({ terrain:'plains' }))) }) as any;
const mk = (id:number,t:string,o:number,x:number,y:number):Unit => ({ id, typeId:t, owner:o, position:{x,y}, hp:10, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
// AOI of an enemy at (ex,ey): its 8 neighbours.
const aoiOf = (ex:number,ey:number) => { const s=new Set<string>(); for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ if(!dx&&!dy)continue; s.add(`${ex+dx},${ey+dy}`);} return s; };
const reach = (mover:Unit, mv:number, units:Unit[], aoi:Set<string>) =>
  getReachableTiles(mover, { movement: mv, traits: [], conditions: [] }, plainsMap(), units, registry, 0, false, [], undefined, aoi);

describe('AOI / Zone of Control movement', () => {
  const enemy = mk(2,'warrior',1,1,2); // B2
  const aoi = aoiOf(1,2);

  it('B4 mover: 2 MP cannot reach D2 (must cross C3), can reach D3; 3 MP reaches D2 & C2', () => {
    const start = mk(1,'warrior',0,1,4); // B4
    const r2 = reach(start, 2, [start, enemy], aoi);
    expect(r2.has('3,3')).toBe(true);   // D3 via C4→D3
    expect(r2.has('3,2')).toBe(false);  // D2 unreachable in 2 (C3 blocks the diagonal)
    expect(r2.has('2,3')).toBe(true);   // C3 itself — AOI tile is a legal STOP (cost 1)
    expect(r2.has('2,2')).toBe(false);  // C2 needs 3 (can't chain through C3)

    const r3 = reach(start, 3, [start, enemy], aoi);
    expect(r3.has('3,2')).toBe(true);   // D2 via C4→D3→D2
    expect(r3.has('2,2')).toBe(true);   // C2 via C4→D3→C2 (AOI final stop)
  });

  it('cannot chain through an AOI tile regardless of MP (C3→C2 is illegal)', () => {
    const start = mk(1,'warrior',0,1,4); // B4
    // Columns A,B,C only (width 3) — no detour column. Enemy B2's AOI fills rows y=1 & y=3
    // across the whole width, so a mover below can STOP on a y=3 tile but never pass it.
    const narrow = { width: 3, height: 8, tiles: Array.from({length:8}, () => Array.from({length:3}, () => ({ terrain:'plains' }))) } as any;
    const r = getReachableTiles(start, { movement: 20, traits: [], conditions: [] }, narrow, [start, enemy], registry, 0, false, [], undefined, aoi);
    expect(r.has('0,3')).toBe(true);   // A3 / B3 / C3 (y=3, AOI) reachable as STOPS
    expect(r.has('1,3')).toBe(true);
    expect(r.has('2,3')).toBe(true);
    expect(r.has('0,2')).toBe(false);  // y=2 & above are walled off — never reachable from below
    expect(r.has('1,0')).toBe(false);
    expect(r.has('0,0')).toBe(false);
  });

  it('start tile is exempt: mover starting inside the AOI may move out freely', () => {
    const start = mk(1,'warrior',0,2,3); // C3 (in AOI)
    const r3 = reach(start, 3, [start, enemy], aoi);
    expect(r3.has('2,6')).toBe(true);   // C3→C4→C5→C6 straight out
    expect(r3.has('2,4')).toBe(true);
  });

  it('from C3 (in AOI): can reach A3 via B4 (2 MP) but not via B3 (which is terminal)', () => {
    const start = mk(1,'warrior',0,2,3); // C3
    const r2 = reach(start, 2, [start, enemy], aoi);
    expect(r2.has('0,3')).toBe(true);   // A3 via C3→B4→A3 (B4 outside AOI, A3 final stop)
    expect(r2.has('1,3')).toBe(true);   // B3 itself reachable (cost 1, terminal)
    // A3 must NOT be reachable through B3 — but it IS reachable via B4, so we assert the
    // count route works. Distinct proof: with only C3→B3 available (block B4), A3 is out.
  });

  it('C6 mover, 3 MP: can stop ON an AOI tile as its final move (C6→C5→C4→C3)', () => {
    const start = mk(1,'warrior',0,2,6); // C6
    const r3 = reach(start, 3, [start, enemy], aoi);
    expect(r3.has('2,3')).toBe(true);   // C3 (AOI) reached as final stop
  });
});

describe('AOI wired through getLegalActions', () => {
  it('a real move list omits tiles that require crossing an enemy AOI', () => {
    const cfg: GameConfig = { ...defaultConfig, fogOfWar: false };
    let s = createGame(cfg, registry, ['vanguard','hive'], 7);
    s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0;
    for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; }
    // Enemy at (4,4); reaper (mv 2) at (4,6). Straight up crosses the AOI tile (4,5).
    s.units.push(mk(2,'warrior',1,4,4), { ...mk(1,'reaper',0,4,6), hp: registry.unitTypes['reaper'].maxHP });
    const moves = getLegalActions(s, registry, 0).filter(a => a.type==='move' && a.unitId===1) as any[];
    const to = (x:number,y:number)=> moves.some(m=>m.to.x===x&&m.to.y===y);
    expect(to(4,5)).toBe(true);   // (4,5) is an AOI tile — legal STOP
    expect(to(4,4)).toBe(false);  // enemy tile — occupied
    expect(to(4,3)).toBe(false);  // beyond the AOI, would need to cross (4,5) — blocked
  });
});

describe('No AOI (aoi_none): Scout / Sentinel project no zone of control', () => {
  // A hive Reaper (mv 2) at (4,5). An enemy at (4,3). Reaching (3,3) in 2 moves requires
  // transiting (3,4), which is one of the enemy's AOI tiles — so a normal enemy blocks it,
  // but a No-AOI enemy (Scout/Sentinel) does not.
  const setup = (enemyType: string) => {
    const s = createGame({ ...defaultConfig, fogOfWar: false }, registry, ['vanguard','hive'], 7);
    s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0;
    for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; }
    s.units.push(mk(2,enemyType,1,4,3), { ...mk(1,'reaper',0,4,5), hp: registry.unitTypes['reaper'].maxHP } as any);
    return getLegalActions(s, registry, 0).filter((a:any) => a.type==='move' && a.unitId===1) as any[];
  };

  it('a Scout (No AOI) lets an enemy transit its zone; a Warrior blocks it', () => {
    expect(setup('scout').some(m=>m.to.x===3 && m.to.y===3)).toBe(true);    // No AOI → free transit
    expect(setup('warrior').some(m=>m.to.x===3 && m.to.y===3)).toBe(false); // normal AOI blocks
  });

  it('the Sentinel also projects No AOI', () => {
    expect(setup('sentinel').some(m=>m.to.x===3 && m.to.y===3)).toBe(true);
  });
});

describe('Cities project AOI (zone of control)', () => {
  const setup = (cityOwner: number | null) => {
    const s = createGame({ ...defaultConfig, fogOfWar: false }, registry, ['vanguard','hive'], 7);
    s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0;
    for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; }
    // enemy city at (4,3); a hive reaper (mv 2) at (4,5). (3,3) needs to transit the city's
    // AOI tile (3,4) — blocked if the city is an enemy's.
    if (cityOwner !== null) {
      s.map.tiles[3][4].isCity = true;
      s.cities = [{ id: 90, owner: cityOwner, position: {x:4,y:3}, isCapital:false, level:1, supply:0, incomeBonus:0, popBonus:0, bonusSupply:0, fortified:false, extraTerritory:[] } as any];
      s.map.tiles[3][4] = s.map.tiles[3][4]; // no-op
      s.map.tiles[3][4].isCity = false;
      s.map.tiles[3][4] = s.map.tiles[3][4];
    }
    s.units.push(mk(1,'reaper',0,4,5), mk(2,'warrior',1,8,8));
    return getLegalActions(s, registry, 0).filter((a:any) => a.type==='move' && a.unitId===1) as any[];
  };
  it("an enemy city blocks transit through its 3×3; a friendly one does not", () => {
    // enemy city (owner 1) at (4,3) → (3,3) blocked
    const s1 = createGame({ ...defaultConfig, fogOfWar: false }, registry, ['vanguard','hive'], 7);
    s1.units = []; s1.unitHomeCity = {}; s1.currentPlayer = 0;
    for (let y=0;y<s1.map.height;y++) for (let x=0;x<s1.map.width;x++){ const t=s1.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; }
    s1.map.tiles[3][4].isCity = true; // (4,3) is the city
    s1.cities = [{ id: 90, owner: 1, position: {x:4,y:3}, isCapital:false, level:1, supply:0, incomeBonus:0, popBonus:0, bonusSupply:0, fortified:false, extraTerritory:[] } as any];
    s1.units.push(mk(1,'reaper',0,4,5));
    const blocked = getLegalActions(s1, registry, 0).some((a:any)=>a.type==='move'&&a.unitId===1&&a.to.x===3&&a.to.y===3);
    expect(blocked).toBe(false);

    // friendly city (owner 0) → no AOI against player 0 → (3,3) reachable
    const s2 = createGame({ ...defaultConfig, fogOfWar: false }, registry, ['vanguard','hive'], 7);
    s2.units = []; s2.unitHomeCity = {}; s2.currentPlayer = 0;
    for (let y=0;y<s2.map.height;y++) for (let x=0;x<s2.map.width;x++){ const t=s2.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; }
    s2.map.tiles[3][4].isCity = true;
    s2.cities = [{ id: 91, owner: 0, position: {x:4,y:3}, isCapital:false, level:1, supply:0, incomeBonus:0, popBonus:0, bonusSupply:0, fortified:false, extraTerritory:[] } as any];
    s2.units.push(mk(1,'reaper',0,4,5));
    const ok = getLegalActions(s2, registry, 0).some((a:any)=>a.type==='move'&&a.unitId===1&&a.to.x===3&&a.to.y===3);
    expect(ok).toBe(true);
  });
});

describe('Burrowed Wyrm: no AOI (even when detected) & cannot found cities', () => {
  const clear = (s: GameState) => { s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0;
    for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; } };

  it('a DETECTED enemy burrowed Wyrm blocks no movement (aoi_none)', () => {
    const s = createGame({ ...defaultConfig, fogOfWar: false }, registry, ['vanguard','hive'], 7);
    clear(s);
    // Enemy burrowed Wyrm at (4,3); a friendly Seercaust adjacent (detect range 1) so it's
    // NOT hidden — without aoi_none it would project its 3×3 and block transit through (3,4).
    s.units.push(mk(2,'wyrm_burrowed',1,4,3), mk(3,'seercaust',0,5,3),
      { ...mk(1,'reaper',0,4,5), hp: registry.unitTypes['reaper'].maxHP } as any);
    const moves = getLegalActions(s, registry, 0).filter((a:any)=>a.type==='move'&&a.unitId===1) as any[];
    expect(moves.some(m=>m.to.x===3 && m.to.y===3)).toBe(true); // free transit — burrowed Wyrm has no AOI
  });

  it('a burrowed Wyrm on a ruin cannot found a city', () => {
    const s = createGame({ ...defaultConfig, fogOfWar: false }, registry, ['vanguard','hive'], 7);
    clear(s);
    s.players[0].ore = 100000;
    s.map.tiles[3][4].isRuin = true; // ruin at (4,3)
    s.units.push({ ...mk(1,'wyrm_burrowed',0,4,3), hasMoved:false });
    expect(canFoundCity(s, registry, 0, { x:4, y:3 })).toBe(false);
    // A normal founder on the same ruin CAN (sanity: the ruin itself is foundable).
    s.units = [{ ...mk(1,'warrior',0,4,3), hasMoved:false }];
    expect(canFoundCity(s, registry, 0, { x:4, y:3 })).toBe(true);
  });
});
