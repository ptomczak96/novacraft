import { describe, it, expect } from 'vitest';
import { createGame, applyAction, previewAttack } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const mk = (id:number,t:string,o:number,x:number,y:number):Unit => ({ id, typeId:t, owner:o, position:{x,y}, hp:registry.unitTypes[t].maxHP, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
const u = (s:GameState,id:number)=> s.units.find(x=>x.id===id);
const base = () => {
  let s = createGame(cfg(), registry, ['vanguard','hive'], 7);
  s.units=[]; s.unitHomeCity={}; s.currentPlayer=0;
  for (let y=0;y<s.map.height;y++) for (let x=0;x<s.map.width;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; }
  return s;
};

describe('Combat log: Combined Arms is reflected in the preview & breakdown', () => {
  it('shows a "Combined Arms" ×1.2 attack mod on the 2nd hit, and the preview matches the damage dealt', () => {
    let s = base();
    s.players[0].researchedTechs = ['advanced_weaponry'];
    s.units.push(mk(1,'lancer',0,3,3), mk(2,'lancer',0,3,4), { ...mk(3,'defender',1,4,3), hp:20 });

    // 1st hit — no Combined Arms yet.
    const p1 = previewAttack(s, 1, 3, registry)!;
    expect(p1.attackBreakdown.attackMods.some(m=>m.label==='Combined Arms')).toBe(false);
    s = applyAction(s, { type:'attack', unitId:1, targetId:3 }, registry);

    // 2nd hit on the SAME target — Combined Arms ×1.2 should now show, and the preview must
    // equal the HP actually lost.
    const p2 = previewAttack(s, 2, 3, registry)!;
    const ca = p2.attackBreakdown.attackMods.find(m=>m.label==='Combined Arms');
    expect(ca?.mult).toBe(1.2);
    expect(p2.attackBreakdown.effectiveAttack).toBeCloseTo(registry.unitTypes['lancer'].attack * 1.2, 5);
    const before = u(s,3)!.hp;
    s = applyAction(s, { type:'attack', unitId:2, targetId:3 }, registry);
    expect(before - u(s,3)!.hp).toBe(p2.attackerDamage); // log preview == real damage
  });

  it('Combined Arms is FLAT — the 3rd hit is still ×1.2 (not ×1.44)', () => {
    let s = base();
    s.players[0].researchedTechs = ['advanced_weaponry'];
    s.units.push(mk(1,'lancer',0,3,3), mk(2,'lancer',0,3,4), mk(4,'lancer',0,3,5), { ...mk(3,'defender',1,4,3), hp:20 });
    s = applyAction(s, { type:'attack', unitId:1, targetId:3 }, registry); // hit 1
    s = applyAction(s, { type:'attack', unitId:2, targetId:3 }, registry); // hit 2
    const p3 = previewAttack(s, 4, 3, registry)!;
    expect(p3.attackBreakdown.attackMods.find(m=>m.label==='Combined Arms')?.mult).toBe(1.2); // still flat 1.2
  });
});

describe('Combat log: defence buffs/debuffs are itemised', () => {
  it('a corrosive debuff and a city bonus appear as defence mods', () => {
    const s = base();
    s.map.tiles[3][4].isCity = true;                 // defender at (4,3) on a city
    s.units.push(mk(1,'warrior',0,3,3), { ...mk(2,'warrior',1,4,3), statuses:['corrosive_1'] });
    const p = previewAttack(s, 1, 2, registry)!;
    const labels = p.attackBreakdown.defenceMods.map(m=>m.label);
    expect(p.attackBreakdown.defenceMods.some(m=>/City/.test(m.label) && m.mult===1.5)).toBe(true);
    expect(p.attackBreakdown.defenceMods.some(m=>m.label==='Corrosive I' && m.mult===0.8)).toBe(true);
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });
});
