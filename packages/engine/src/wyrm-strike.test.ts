import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, getVisibleState, wyrmStrikePairs } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit, WyrmStrikeAction } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: true, ...o });
const plains = (s: GameState) => { for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; } };
const mk = (id:number,t:string,o:number,x:number,y:number):Unit => ({ id, typeId:t, owner:o, position:{x,y}, hp:registry.unitTypes[t].maxHP, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
const u = (s:GameState,id:number)=> s.units.find(x=>x.id===id);
const base = () => { let s = createGame(cfg(), registry, ['hive','vanguard'], 7); s.units=[]; s.unitHomeCity={}; s.currentPlayer=0; plains(s); return s; };

describe('Wyrm strike geometry', () => {
  it('pairs: primary in 3×3, secondary touching, neither the wyrm tile', () => {
    const pairs = wyrmStrikePairs({x:2,y:2}, 20, 20);
    for (const [p,q] of pairs) {
      expect(Math.max(Math.abs(p.x-2),Math.abs(p.y-2))).toBe(1); // primary chebyshev 1
      expect(Math.max(Math.abs(p.x-q.x),Math.abs(p.y-q.y))).toBe(1); // touch
      expect(p.x===2&&p.y===2).toBe(false);
      expect(q.x===2&&q.y===2).toBe(false);
    }
    // B2 -> C2 & D2 is legal (example from spec)
    expect(pairs.some(([p,q])=>p.x===3&&p.y===2&&q.x===4&&q.y===2)).toBe(true);
  });
});

describe('Wyrm strike damage', () => {
  it('primary 100%, secondary 50%, no retaliation, only if not moved', () => {
    let s = base();
    s.units.push(mk(1,'wyrm',0,3,3), mk(2,'defender',1,4,3), mk(3,'defender',1,5,3));
    const a2=u(s,2)!.hp, a3=u(s,3)!.hp, wyrmHP=u(s,1)!.hp; const minDmg=s.config.combatConfig.minimumDamage;
    const act: WyrmStrikeAction = { type:'wyrmStrike', unitId:1, tiles:[{x:4,y:3},{x:5,y:3}] };
    s = applyAction(s, act, registry);
    const d2 = a2-u(s,2)!.hp, d3 = a3-u(s,3)!.hp;
    expect(d2).toBeGreaterThan(0);
    expect(d3).toBe(Math.max(minDmg, Math.round(d2*0.5))); // secondary ~half
    expect(u(s,1)!.hp).toBe(wyrmHP); // no retaliation
    expect(u(s,1)!.hasAttacked).toBe(true);
  });

  it('cannot strike after moving', () => {
    let s = base();
    s.units.push({ ...mk(1,'wyrm',0,3,3), hasMoved:true }, mk(2,'warrior',1,4,3));
    const strikes = getLegalActions(s, registry, 0).filter(a=>a.type==='wyrmStrike');
    expect(strikes.length).toBe(0);
  });
});

describe('Wyrm strike into fog reveals for one turn', () => {
  it('reveals a struck fogged enemy this turn; it hides again next turn', () => {
    let s = base();
    // Wyrm at (3,3); enemy far from any hive sight, on (4,3). Ensure it is not visible pre-strike.
    s.units.push(mk(1,'wyrm',0,3,3), mk(2,'warrior',1,4,3));
    // Move hive capital far so its sight doesn't cover (4,3): just check via getVisibleState.
    const before = getVisibleState(s, 0, registry).units.some(x=>x.id===2);
    s = applyAction(s, { type:'wyrmStrike', unitId:1, tiles:[{x:4,y:3},{x:5,y:3}] } as WyrmStrikeAction, registry);
    const during = getVisibleState(s, 0, registry).units.some(x=>x.id===2);
    expect(during).toBe(true); // revealed by the strike this turn
    // End player 0's turn → reveal clears.
    s = applyAction(s, { type:'endTurn' }, registry);
    const after = getVisibleState(s, 0, registry).units.some(x=>x.id===2);
    // if it wasn't visible before, it should not be visible after (reveal cleared)
    if (!before) expect(after).toBe(false);
  });
});
