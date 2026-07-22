import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
const u = (s: GameState, id: number) => s.units.find(x => x.id === id);
const base = (o: Partial<GameConfig> = {}) => {
  const s = createGame(cfg(o), registry, ['vanguard', 'hive'], 7); s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0;
  // Flatten terrain to plains but LEAVE city tiles intact — wiping isCity would make the
  // captureAllCities win condition fire (0 cities everywhere) the moment a turn ends.
  for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) { const t = s.map.tiles[y][x]; if (!t.isCity) t.terrain = 'plains'; t.isResourceTile = false; }
  return s;
};
const endTurns = (s: GameState, n: number) => { for (let i = 0; i < n; i++) s = applyAction(s, { type: 'endTurn' }, registry); return s; };

describe('Medic — Tracer Round (Advanced Biomed)', () => {
  it('is offered on an enemy with Advanced Biomed, and NOT without it', () => {
    const on = base({ techTreeEnabled: false }); // all techs
    on.units.push(mk(1, 'medic', 0, 4, 4), mk(2, 'reaper', 1, 6, 4));
    expect(getLegalActions(on, registry, 0).some((a: any) => a.abilityId === 'tracer_round')).toBe(true);
    const off = base({ techTreeEnabled: true }); // research-gated, no biomed
    off.players[0].researchedTechs.push('small_arms', 'triage');
    off.units.push(mk(1, 'medic', 0, 4, 4), mk(2, 'reaper', 1, 6, 4));
    expect(getLegalActions(off, registry, 0).some((a: any) => a.abilityId === 'tracer_round')).toBe(false);
  });
});

describe('Medic — Heal I / Heal II (light units only)', () => {
  it('Heal I heals ONE adjacent light friendly for 8; not heavy/giant, not enemy, not self', () => {
    let s = base({ techTreeEnabled: true });
    s.players[0].researchedTechs.push('small_arms', 'triage'); // medic + heal_1 (no biomed → not superseded)
    s.units.push(mk(1, 'medic', 0, 4, 4), { ...mk(2, 'lancer', 0, 5, 4), hp: 4 }, mk(3, 'stalker', 0, 4, 5), mk(4, 'warrior', 1, 3, 4));
    const casts = getLegalActions(s, registry, 0).filter((a: any) => a.type === 'useAbility' && a.unitId === 1 && a.abilityId === 'heal_1') as any[];
    const at = (x: number, y: number) => casts.some(a => a.target.x === x && a.target.y === y);
    expect(at(5, 4)).toBe(true);   // light friendly lancer — OK
    expect(at(4, 5)).toBe(false);  // heavy stalker — not healable
    expect(at(3, 4)).toBe(false);  // enemy — not healable
    s = applyAction(s, casts.find(a => a.target.x === 5 && a.target.y === 4)!, registry);
    expect(u(s, 2)!.hp).toBe(12);  // 4 + 8 (lancer max 15)
    expect(getLegalActions(s, registry, 0).some((a: any) => a.abilityId === 'heal_2')).toBe(false); // no biomed
    expect(getLegalActions(s, registry, 0).some((a: any) => a.abilityId === 'cure')).toBe(false);   // no biomed
  });

  it('Advanced Biomed replaces Heal I with Heal II — heals TWO light units for 10 each', () => {
    let s = base({ techTreeEnabled: false }); // all techs → heal_2 available, heal_1 superseded
    s.units.push(mk(1, 'medic', 0, 4, 4), { ...mk(2, 'warrior', 0, 5, 4), hp: 2 }, { ...mk(3, 'scout', 0, 4, 5), hp: 1 });
    expect(getLegalActions(s, registry, 0).some((a: any) => a.abilityId === 'heal_1')).toBe(false); // superseded
    expect(getLegalActions(s, registry, 0).some((a: any) => a.abilityId === 'heal_2')).toBe(true);
    s = applyAction(s, { type: 'useAbility', unitId: 1, abilityId: 'heal_2', target: { x: 5, y: 4 }, targets: [{ x: 5, y: 4 }, { x: 4, y: 5 }] } as any, registry);
    expect(u(s, 2)!.hp).toBe(10); // 2 + 10 (warrior max 10)
    expect(u(s, 3)!.hp).toBe(10); // 1 + 10 (scout max 10)
  });

  it('Heal II caps at 2 targets and ignores duplicate picks (cannot stack)', () => {
    let s = base({ techTreeEnabled: false });
    s.units.push(mk(1, 'medic', 0, 4, 4), { ...mk(2, 'scout', 0, 5, 4), hp: 1 });
    s = applyAction(s, { type: 'useAbility', unitId: 1, abilityId: 'heal_2', target: { x: 5, y: 4 }, targets: [{ x: 5, y: 4 }, { x: 5, y: 4 }] } as any, registry);
    expect(u(s, 2)!.hp).toBe(10); // 1 + 10 once, not +20
  });
});

describe('Medic — Cure (Advanced Biomed): strip afflictions', () => {
  it('only afflicted allies are targetable, and Cure removes every affliction (keeps buffs)', () => {
    let s = base({ techTreeEnabled: false }); // all techs → cure available
    s.units.push(
      mk(1, 'medic', 0, 4, 4),
      { ...mk(2, 'warrior', 0, 5, 4), statuses: ['infected', 'corrosive_1', 'shielded'], infectedBy: 1, statusExpiry: {} },
      mk(3, 'warrior', 0, 4, 5), // healthy, no afflictions
    );
    const casts = getLegalActions(s, registry, 0).filter((a: any) => a.type === 'useAbility' && a.unitId === 1 && a.abilityId === 'cure') as any[];
    expect(casts.some(a => a.target.x === 5 && a.target.y === 4)).toBe(true);  // afflicted — targetable
    expect(casts.some(a => a.target.x === 4 && a.target.y === 5)).toBe(false); // clean ally — not offered
    s = applyAction(s, casts.find(a => a.target.x === 5 && a.target.y === 4)!, registry);
    const cured = u(s, 2)!;
    expect(cured.statuses).toEqual(['shielded']);   // afflictions gone, buff kept
    expect(cured.infectedBy).toBeUndefined();
  });
});

describe('Engineer — Repair I / Repair II (heavy & giant units)', () => {
  it('Engineering unlocks Repair I: heals ONE adjacent heavy/giant friendly for 5; not light', () => {
    let s = base({ techTreeEnabled: true });
    s.players[0].researchedTechs.push('small_arms', 'engineering'); // engineer + repair_1
    s.units.push(mk(1, 'engineer', 0, 4, 4), { ...mk(2, 'stalker', 0, 5, 4), hp: 10 }, mk(3, 'warrior', 0, 4, 5));
    const casts = getLegalActions(s, registry, 0).filter((a: any) => a.type === 'useAbility' && a.unitId === 1 && a.abilityId === 'repair_1') as any[];
    expect(casts.some(a => a.target.x === 5 && a.target.y === 4)).toBe(true);  // heavy stalker — OK
    expect(casts.some(a => a.target.x === 4 && a.target.y === 5)).toBe(false); // light warrior — not repairable
    s = applyAction(s, casts.find(a => a.target.x === 5 && a.target.y === 4)!, registry);
    expect(u(s, 2)!.hp).toBe(15); // 10 + 5
  });

  it('Tactical Engineering replaces Repair I with Repair II — heals TWO for 8 each', () => {
    let s = base({ techTreeEnabled: false });
    s.units.push(mk(1, 'engineer', 0, 4, 4), { ...mk(2, 'stalker', 0, 5, 4), hp: 5 }, { ...mk(3, 'behemoth', 0, 4, 5), hp: 5 });
    expect(getLegalActions(s, registry, 0).some((a: any) => a.abilityId === 'repair_1')).toBe(false); // superseded
    expect(getLegalActions(s, registry, 0).some((a: any) => a.abilityId === 'repair_2')).toBe(true);
    s = applyAction(s, { type: 'useAbility', unitId: 1, abilityId: 'repair_2', target: { x: 5, y: 4 }, targets: [{ x: 5, y: 4 }, { x: 4, y: 5 }] } as any, registry);
    expect(u(s, 2)!.hp).toBe(13); // 5 + 8
    expect(u(s, 3)!.hp).toBe(13); // 5 + 8
  });

  it('Build Node is a disabled placeholder — never offered', () => {
    const s = base({ techTreeEnabled: false });
    s.units.push(mk(1, 'engineer', 0, 4, 4));
    expect(getLegalActions(s, registry, 0).some((a: any) => a.abilityId === 'build_node')).toBe(false);
  });
});
