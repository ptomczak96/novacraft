import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, previewCombat } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';
import type { GameConfig, GameState, Unit, UseAbilityAction } from './types.js';

const registry = buildRegistry();
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({ ...defaultConfig, fogOfWar: false, ...o });
const plains = (s: GameState) => { for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) s.map.tiles[y][x].terrain = 'plains'; };
const mk = (id: number, t: string, o: number, x: number, y: number): Unit =>
  ({ id, typeId: t, owner: o, position: { x, y }, hp: registry.unitTypes[t].maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
const unit = (s: GameState, id: number) => s.units.find(u => u.id === id);
// Seercaust owned by hive (player 1); its abilities are its turn.
const base = () => {
  let s = createGame(cfg(), registry, ['vanguard', 'hive'], 7);
  s.units = []; s.unitHomeCity = {}; s.currentPlayer = 1; plains(s);
  return s;
};
const infect = (target: Unit): UseAbilityAction => ({ type: 'useAbility', unitId: 1, abilityId: 'infect', target: { ...target.position } });
const bile = (x: number, y: number): UseAbilityAction => ({ type: 'useAbility', unitId: 1, abilityId: 'spray_bile', target: { x, y } });

describe('Seercaust: Infect', () => {
  it('is offered only against LIGHT units within range 3, and not against the caster', () => {
    const s = base();
    s.units.push(
      mk(1, 'seercaust', 1, 3, 3),
      mk(2, 'scout', 0, 4, 3),     // light, in range → offered
      mk(3, 'archer', 0, 5, 3),    // non-light (no unitClass) → not offered
      mk(4, 'scout', 0, 7, 3),     // light but out of range (dist 4) → not offered
    );
    const acts = getLegalActions(s, registry, 1).filter(a => a.type === 'useAbility' && a.abilityId === 'infect') as UseAbilityAction[];
    const targets = acts.map(a => `${a.target.x},${a.target.y}`);
    expect(targets).toContain('4,3');     // scout (light) offered
    expect(targets).not.toContain('5,3'); // archer (non-light) not offered
    expect(targets).not.toContain('7,3'); // out of range not offered
    expect(targets).not.toContain('3,3'); // never the caster
  });

  it('applies the "infected" condition and records the infector', () => {
    let s = base();
    s.units.push(mk(1, 'seercaust', 1, 3, 3), mk(2, 'scout', 0, 4, 3));
    s = applyAction(s, infect(unit(s, 2)!), registry);
    expect(unit(s, 2)!.statuses).toContain('infected');
    expect(unit(s, 2)!.infectedBy).toBe(1);
    // Casting spent the turn and set the cooldown.
    expect(unit(s, 1)!.hasAttacked).toBe(true);
    expect(unit(s, 1)!.abilityCooldowns['infect']).toBe(2);
  });

  it('an infected unit killed spawns 2 scuttlings for the infector (one on its tile)', () => {
    let s = base();
    s.units.push(
      mk(1, 'seercaust', 1, 3, 3),
      { ...mk(2, 'scout', 0, 6, 6), hp: 1 }, // will be killed
      mk(3, 'warrior', 1, 6, 5),             // hive attacker to finish it
    );
    s = applyAction(s, infect(unit(s, 2)!), registry);
    // Hive attacks the infected scout with the warrior (adjacent).
    s = applyAction(s, { type: 'attack', unitId: 3, targetId: 2 }, registry);
    expect(unit(s, 2)).toBeUndefined(); // scout dead
    const scuttlings = s.units.filter(u => u.typeId === 'scuttling' && u.owner === 1);
    expect(scuttlings.length).toBe(2);
    expect(scuttlings.some(u => u.position.x === 6 && u.position.y === 6)).toBe(true); // on the death tile
  });
});

describe('Seercaust: Spray Bile', () => {
  it('marks the target tile with bile for 5 rounds and is offered within range 2', () => {
    let s = base();
    s.units.push(mk(1, 'seercaust', 1, 3, 3));
    const acts = getLegalActions(s, registry, 1).filter(a => a.type === 'useAbility' && a.abilityId === 'spray_bile') as UseAbilityAction[];
    expect(acts.some(a => a.target.x === 5 && a.target.y === 3)).toBe(true);  // dist 2 in range
    expect(acts.some(a => a.target.x === 6 && a.target.y === 3)).toBe(false); // dist 3 out of range

    s = applyAction(s, bile(4, 3), registry);
    const t = s.map.tiles[3][4];
    expect(t.bile).toBeDefined();
    expect(t.bile!.owner).toBe(1);
    expect(t.bile!.expiresTurn).toBe(s.turn + 5);
  });

  it('buffs a friendly unit (DEF ×1.2) and debuffs an enemy (DEF ×0.8) standing on the tile', () => {
    // Hive bile at (8,8). A tanky DEF-3 unit on it is attacked by a DEF-neutral warrior.
    // Damage dealt to the unit reflects its effective defence, so it's a clean probe.
    const dmgToUnitOnBile = (ownerOfUnit: 0 | 1, place: boolean) => {
      const s = base();
      s.units.push(
        mk(1, 'seercaust', 1, 3, 3),
        mk(2, 'defender', ownerOfUnit, 8, 8),                       // DEF 3, on the bile tile
        mk(3, 'archer', ownerOfUnit === 1 ? 0 : 1, 8, 7),             // ATK 5 enemy attacker adjacent
      );
      if (place) s.map.tiles[8][8].bile = { owner: 1, expiresTurn: s.turn + 5 };
      return previewCombat(unit(s, 3)!, registry.unitTypes['archer'], unit(s, 2)!, registry.unitTypes['defender'], s.map, registry, s.config.combatConfig).attackerDamage;
    };
    // Friendly to the bile (owner 1): tougher → takes LESS damage on bile.
    expect(dmgToUnitOnBile(1, true)).toBeLessThan(dmgToUnitOnBile(1, false));
    // Enemy to the bile (owner 0): softer → takes MORE damage on bile.
    expect(dmgToUnitOnBile(0, true)).toBeGreaterThan(dmgToUnitOnBile(0, false));
  });

  it('clears after its rounds elapse', () => {
    let s = base();
    s.units.push(mk(1, 'seercaust', 1, 3, 3));
    s = applyAction(s, bile(4, 3), registry);
    const expires = s.map.tiles[3][4].bile!.expiresTurn;
    // End turns until we pass the expiry round.
    let guard = 0;
    while (s.turn < expires && guard++ < 50) {
      s = applyAction(s, { type: 'endTurn' }, registry);
    }
    expect(s.map.tiles[3][4].bile).toBeUndefined();
  });
});
