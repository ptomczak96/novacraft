import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getRecruitOptions, cityPop } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, techTreeEnabled: false, ...o });
const cap = (s: GameState) => s.cities.find(c => c.isCapital && c.owner === 0)!;
const mk = (id: number, t: string, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: 0, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });

describe('Recruit roster: pop-full city still shows the whole roster', () => {
  it('lists every unlocked unit (flagged fitsPop:false) when population is full', () => {
    const s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    const c = cap(s);
    s.units = []; s.unitHomeCity = {};
    // Fill the city to its population cap with units homed to it (positions off-centre).
    // Pass state so the cap includes tech bonuses (Habitation Domes when tech tree is off).
    const capacity = cityPop(c, registry, s);
    for (let i = 0; i < capacity; i++) {
      const uu = mk(200 + i, 'warrior', 0, i + 2);
      s.units.push(uu); s.unitHomeCity[uu.id] = c.id;
    }
    const opts = getRecruitOptions(s, registry, 0, c.position);
    // Whole roster still present — not collapsed to a handful.
    expect(opts.length).toBeGreaterThan(3);
    const warrior = opts.find(o => o.unitTypeId === 'warrior')!;
    expect(warrior).toBeTruthy();
    expect(warrior.fitsPop).toBe(false);          // no room
    // "Population full" is derivable: nothing fits.
    expect(opts.every(o => !o.fitsPop)).toBe(true);
  });

  it('flags fitsPop:true when the city has room', () => {
    const s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    const c = cap(s);
    s.units = []; s.unitHomeCity = {};
    const opts = getRecruitOptions(s, registry, 0, c.position);
    expect(opts.find(o => o.unitTypeId === 'warrior')!.fitsPop).toBe(true);
  });
});

describe('Recruit guard: no spawn onto an occupied city tile', () => {
  it('a single-unit recruit is rejected when a unit stands on the city centre', () => {
    let s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
    const c = cap(s);
    s.units = []; s.unitHomeCity = {};
    s.units.push(mk(1, 'warrior', c.position.x, c.position.y)); // block the centre
    s.players[0].ore = 1000;
    const before = s.units.length;
    s = applyAction(s, { type: 'recruit', unitTypeId: 'warrior', cityPosition: c.position }, registry);
    expect(s.units.length).toBe(before); // nothing spawned
  });
});
