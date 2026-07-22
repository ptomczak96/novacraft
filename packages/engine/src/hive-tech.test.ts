import { describe, it, expect } from 'vitest';
import { createGame, applyAction, isTechAvailable, isUnitUnlocked, getLegalActions } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, ...o });
// Hive is player 0 here.
const game = () => { const s = createGame(cfg(), registry, ['hive','vanguard'], 7); s.players[0].ore = 100000; return s; };

describe('Hive Armory tech gating', () => {
  it('gates hive units behind their techs (Reaper ← Reaper tech; Vindrace ← Vindrace)', () => {
    let s = game();
    expect(isUnitUnlocked(s, 0, 'reaper', registry)).toBe(false);
    expect(isUnitUnlocked(s, 0, 'vindrace', registry)).toBe(false);
    s = applyAction(s, { type:'research', techId:'reaper_tech' }, registry);
    expect(isUnitUnlocked(s, 0, 'reaper', registry)).toBe(true);
    expect(isUnitUnlocked(s, 0, 'vindrace', registry)).toBe(false); // needs Vindrace tech
    s = applyAction(s, { type:'research', techId:'vindrace_tech' }, registry);
    expect(isUnitUnlocked(s, 0, 'vindrace', registry)).toBe(true);
  });

  it('Wyrm is unlockable via EITHER Vindrace or Seercaust', () => {
    // via Vindrace
    let a = game();
    a = applyAction(a, { type:'research', techId:'reaper_tech' }, registry);
    a = applyAction(a, { type:'research', techId:'vindrace_tech' }, registry);
    expect(isTechAvailable(a, 0, registry.techs['wyrm_tech'], registry)).toBe(true);
    // via Seercaust
    let b = game();
    b = applyAction(b, { type:'research', techId:'scab_tech' }, registry);
    b = applyAction(b, { type:'research', techId:'seercaust_tech' }, registry);
    expect(isTechAvailable(b, 0, registry.techs['wyrm_tech'], registry)).toBe(true);
  });

  it('Tunneling Network ⊕ Aftershock: picking one locks the other out', () => {
    let s = game();
    for (const t of ['reaper_tech','vindrace_tech','wyrm_tech']) s = applyAction(s, { type:'research', techId:t }, registry);
    expect(isTechAvailable(s, 0, registry.techs['tunneling_network'], registry)).toBe(true);
    expect(isTechAvailable(s, 0, registry.techs['aftershock'], registry)).toBe(true);
    s = applyAction(s, { type:'research', techId:'tunneling_network' }, registry);
    expect(isTechAvailable(s, 0, registry.techs['aftershock'], registry)).toBe(false); // locked out
  });
});

describe('Tunneling Network: Wyrm can burrow then move the same turn', () => {
  const wyrmGame = (withTech: boolean) => {
    const s = createGame(cfg({ fogOfWar: false }), registry, ['hive','vanguard'], 7);
    s.players[0].ore = 100000; s.currentPlayer = 0;
    // Clear the wyrm's neighbourhood to plain, walkable ground (leave city tiles intact so
    // the captureAllCities win condition doesn't fire on this degenerate board).
    for (let y=2;y<=6;y++) for (let x=2;x<=6;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; }
    if (withTech) for (const t of ['reaper_tech','vindrace_tech','wyrm_tech','tunneling_network']) s.players[0].researchedTechs.push(t);
    s.units = []; s.unitHomeCity = {};
    s.units.push({ id: 1, typeId:'wyrm', owner:0, position:{x:4,y:4}, hp: registry.unitTypes['wyrm'].maxHP, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
    s.units.push({ id: 2, typeId:'warrior', owner:1, position:{x:10,y:10}, hp: 10, hasMoved:false, hasAttacked:false, abilityCooldowns:{} }); // keep the game live
    return s;
  };
  const movesFor = (s: any, id: number) => getLegalActions(s, registry, 0).filter((a:any)=>a.type==='move'&&a.unitId===id);

  it('WITHOUT the tech, burrowing ends the turn (no move offered)', () => {
    let s = wyrmGame(false);
    s = applyAction(s, { type:'useAbility', unitId:1, abilityId:'burrow', target:{x:4,y:4} } as any, registry);
    expect(s.units[0].typeId).toBe('wyrm_burrowed'); // it did burrow
    expect(movesFor(s, 1).length).toBe(0);           // …but can't move
  });

  it('WITH Tunneling Network, the burrowed Wyrm can still move', () => {
    let s = wyrmGame(true);
    s = applyAction(s, { type:'useAbility', unitId:1, abilityId:'burrow', target:{x:4,y:4} } as any, registry);
    expect(s.units[0].typeId).toBe('wyrm_burrowed');
    expect(s.units[0].hasMoved).toBe(false);
    expect(movesFor(s, 1).length).toBeGreaterThan(0); // free burrow → can still move underground
  });
});

describe('Aftershock: erupting Wyrm deals 2 damage to its 3×3', () => {
  const setup = (withTech: boolean) => {
    const s = createGame(cfg({ fogOfWar: false }), registry, ['hive','vanguard'], 7);
    s.players[0].ore = 100000; s.currentPlayer = 0;
    for (let y=2;y<=6;y++) for (let x=2;x<=6;x++){ const t=s.map.tiles[y][x]; t.terrain='plains'; t.isResourceTile=false; t.isCity=false; t.isRuin=false; }
    if (withTech) for (const t of ['reaper_tech','vindrace_tech','wyrm_tech','aftershock']) s.players[0].researchedTechs.push(t);
    s.units = []; s.unitHomeCity = {};
    // burrowed Wyrm at (4,4); a friendly warrior ally at (5,4) (adjacent) and an enemy warrior at (3,3) (adjacent).
    s.units.push({ id: 1, typeId:'wyrm_burrowed', owner:0, position:{x:4,y:4}, hp: registry.unitTypes['wyrm_burrowed'].maxHP, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
    s.units.push({ id: 2, typeId:'warrior', owner:0, position:{x:5,y:4}, hp: 10, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
    s.units.push({ id: 3, typeId:'warrior', owner:1, position:{x:3,y:3}, hp: 10, hasMoved:false, hasAttacked:false, abilityCooldowns:{} });
    s.units.push({ id: 4, typeId:'warrior', owner:1, position:{x:8,y:8}, hp: 10, hasMoved:false, hasAttacked:false, abilityCooldowns:{} }); // outside the 3×3
    return applyAction(s, { type:'useAbility', unitId:1, abilityId:'erupt', target:{x:4,y:4} } as any, registry);
  };
  const hp = (s: any, id: number) => s.units.find((u:any)=>u.id===id)?.hp;

  it('WITHOUT the tech, erupting harms nobody in the 3×3', () => {
    const s = setup(false);
    expect(hp(s, 2)).toBe(10); // ally untouched
    expect(hp(s, 3)).toBe(10); // enemy untouched
  });

  it('WITH Aftershock, friend and foe in the 3×3 take a 3-ATTACK hit (Wyrm & units outside spared)', () => {
    const s = setup(true);
    // 3-attack vs warrior (def 2, full HP) on plains → round(3/5·3·4.5)=8 (not flat 3).
    expect(s.units.find((u:any)=>u.id===1)?.typeId).toBe('wyrm'); // surfaced
    expect(hp(s, 2)).toBe(2);  // friendly ally: 3-attack → 8 dmg
    expect(hp(s, 3)).toBe(2);  // enemy: 3-attack → 8 dmg
    expect(hp(s, 4)).toBe(10); // outside 3×3, spared
  });
});
