import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, enumerateVolleyGrids } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit, UseAbilityAction } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const plains = (s: GameState) => { for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) s.map.tiles[y][x].terrain = 'plains'; };
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
const u = (s: GameState, id: number) => s.units.find(x => x.id === id);
const base = () => { let s = createGame(cfg(), registry, ['vanguard', 'hive'], 7); s.units = []; s.unitHomeCity = {}; s.currentPlayer = 0; plains(s); return s; };
const volleyActs = (s: GameState) => getLegalActions(s, registry, 0).filter(a => a.type === 'useAbility' && a.abilityId === 'ballistic_volley') as UseAbilityAction[];

describe('Titan: Ballistic Volley', () => {
  it('all offered grids are strict 2×2 squares with every tile at range 2–3', () => {
    const s = base(); s.units.push(mk(1, 'titan', 0, 6, 6));
    const grids = volleyActs(s);
    expect(grids.length).toBeGreaterThan(0);
    for (const a of grids) {
      const t = a.tiles!;
      expect(t.length).toBe(4);
      const xs = t.map(c => c.x), ys = t.map(c => c.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(1); // 2 wide
      expect(Math.max(...ys) - Math.min(...ys)).toBe(1); // 2 tall
      for (const c of t) {
        const cheb = Math.max(Math.abs(c.x - 6), Math.abs(c.y - 6));
        expect(cheb).toBeGreaterThanOrEqual(2);
        expect(cheb).toBeLessThanOrEqual(3);
      }
    }
  });

  it('enumerateVolleyGrids excludes range-1 and range-4 tiles', () => {
    const grids = enumerateVolleyGrids({ x: 6, y: 6 }, 20, 20, 2, 3);
    const flat = grids.flat();
    expect(flat.some(c => Math.max(Math.abs(c.x - 6), Math.abs(c.y - 6)) < 2)).toBe(false);
    expect(flat.some(c => Math.max(Math.abs(c.x - 6), Math.abs(c.y - 6)) > 3)).toBe(false);
  });

  it('deals a 2-ATTACK hit to EVERY unit in the grid — friend and foe alike', () => {
    let s = base();
    // Titan at (6,6); 2×2 = (8,8),(9,8),(8,9),(9,9) — all range 2–3.
    s.units.push(mk(1, 'titan', 0, 6, 6), mk(2, 'warrior', 1, 8, 8), mk(3, 'warrior', 0, 9, 9));
    const foeHP = u(s, 2)!.hp, friendHP = u(s, 3)!.hp;
    const act: UseAbilityAction = { type: 'useAbility', unitId: 1, abilityId: 'ballistic_volley',
      target: { x: 8, y: 8 }, tiles: [{ x: 8, y: 8 }, { x: 9, y: 8 }, { x: 8, y: 9 }, { x: 9, y: 9 }] };
    expect(volleyActs(s).some(a => a.tiles!.every(c => act.tiles!.some(t => t.x === c.x && t.y === c.y)))).toBe(true);
    s = applyAction(s, act, registry);
    // 2-attack vs warrior (def 2, full HP) on plains → round(2/4·2·4.5)=5 (not flat 2).
    expect(u(s, 2)!.hp).toBe(foeHP - 5);   // enemy hit
    expect(u(s, 3)!.hp).toBe(friendHP - 5); // friendly fire
    expect(u(s, 1)!.hasAttacked).toBe(true); // spent the turn
  });

  it('rejects a non-square (snake/line) tile set — no damage dealt', () => {
    let s = base();
    s.units.push(mk(1, 'titan', 0, 6, 6), mk(2, 'warrior', 1, 8, 6));
    const hp = u(s, 2)!.hp;
    // A 1×4 line, not a square.
    const bad: UseAbilityAction = { type: 'useAbility', unitId: 1, abilityId: 'ballistic_volley',
      target: { x: 8, y: 6 }, tiles: [{ x: 8, y: 6 }, { x: 8, y: 7 }, { x: 8, y: 8 }, { x: 8, y: 9 }] };
    s = applyAction(s, bad, registry);
    expect(u(s, 2)!.hp).toBe(hp); // unchanged — illegal grid ignored
  });
});
