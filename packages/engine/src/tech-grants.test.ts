import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, grantedConditions } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const mk = (id:number,t:string,o:number,x:number,y:number):Unit => ({ id, typeId:t, owner:o, position:{x,y}, hp:registry.unitTypes[t].maxHP, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
const clear = (s:GameState) => { for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isCity=false; t.isResourceTile=false; t.isRuin=false; } };

describe('Tech → unit grant system', () => {
  it('grantedConditions reads grantCondition effects for the player', () => {
    const s = createGame(cfg({ techTreeEnabled: false }), registry, ['hive','vanguard'], 7); // all techs
    // dash_2 from Adrenal Glands (L2); aoi_immune/Creep from Berserker Glands (L3).
    expect(grantedConditions(s.players[0], 'reaper', registry).sort()).toEqual(['aoi_immune','dash_2']);
    expect(grantedConditions(s.players[0], 'scuttling', registry)).toContain('fleet_1'); // Adrenal Glands
    expect(grantedConditions(s.players[0], 'stalker', registry)).toContain('mountain_shooter_2');
    // a fresh player (tech tree ON, nothing researched) gets nothing.
    const s2 = createGame(cfg(), registry, ['hive','vanguard'], 7);
    expect(grantedConditions(s2.players[0], 'reaper', registry)).toEqual([]);
  });

  it('Adrenal Glands → Reaper gains Dash II (can move after attacking)', () => {
    // Without the tech: a Reaper (base dash_1) can move 1 after attacking.
    const dashAfterAttack = (techOn: boolean) => {
      const s = createGame(cfg({ techTreeEnabled: techOn ? undefined : false }), registry, ['hive','vanguard'], 7);
      s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0; clear(s);
      s.units.push({ ...mk(1,'reaper',0,3,3), hasAttacked: true, dashRemaining: undefined } as any, mk(2,'warrior',1,8,8));
      // simulate a real attack so dashRemaining is set by the engine
      let st = s; st.units = []; st.unitHomeCity = {};
      st.units.push(mk(1,'reaper',0,3,3), mk(2,'warrior',1,4,3));
      st = applyAction(st, { type:'attack', unitId:1, targetId:2 }, registry);
      return st.units.find(u=>u.id===1)?.dashRemaining ?? 0;
    };
    expect(dashAfterAttack(true)).toBe(1);  // base dash_1
    expect(dashAfterAttack(false)).toBe(2); // Adrenal Glands (pre-researched) → dash_2
  });

  it('Adrenal Glands → Scuttling gains +1 movement (fleet_1)', () => {
    // Scuttling base movement is 1; Adrenal Glands (fleet_1) makes it 2.
    const reach = (techOn: boolean) => {
      const s = createGame(cfg({ techTreeEnabled: techOn ? undefined : false }), registry, ['hive','vanguard'], 7);
      s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0; clear(s);
      s.units.push(mk(1,'scuttling',0,5,5));
      // Straight-line east: the farthest reachable move tile on row 5 tells us the range.
      const xs = getLegalActions(s, registry, 0)
        .filter((a:any) => a.type==='move' && a.unitId===1 && a.to.y===5)
        .map((a:any) => a.to.x - 5);
      return Math.max(...xs);
    };
    expect(reach(true)).toBe(1);  // base movement 1
    expect(reach(false)).toBe(2); // Adrenal Glands (fleet_1) → 2
  });

  it('Berserker Glands → Reaper gains Creep (ignores enemy AOI when moving)', () => {
    // Enemy warrior at (4,3); its AOI tile (4,4) would normally stop a mover transiting it.
    const canTransit = (techOn: boolean) => {
      const s = createGame(cfg({ techTreeEnabled: techOn ? undefined : false }), registry, ['hive','vanguard'], 7);
      s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0; clear(s);
      // reaper (mv 2) at (4,5); enemy at (4,3). (3,3) is only reachable in 2 by transiting the AOI.
      s.units.push(mk(1,'reaper',0,4,5), mk(2,'warrior',1,4,3));
      return getLegalActions(s, registry, 0).some((a:any) => a.type==='move' && a.unitId===1 && a.to.x===3 && a.to.y===3);
    };
    expect(canTransit(true)).toBe(false);  // base reaper is stopped by AOI
    expect(canTransit(false)).toBe(true);  // Adrenal Glands (aoi_immune) → moves freely
  });
});
