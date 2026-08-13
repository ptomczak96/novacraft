import { describe, it, expect } from 'vitest';
import { createTestCombatGame, getLegalActions, applyAction } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';

const registry = buildRegistry();

const sandboxConfig = { ...defaultConfig, sandboxMode: true, unlimitedResources: true, fogOfWar: false };

describe('Sandbox mode (prototyping)', () => {
  const s = createTestCombatGame(sandboxConfig, registry, ['vanguard', 'hive'], 7, { allUnitTypes: true, copies: 1 });

  it('spawns one of every non-morph unit kind for both teams', () => {
    const morphTargets = new Set<string>();
    for (const ut of Object.values(registry.unitTypes)) {
      for (const ab of ut.abilities ?? []) if (ab.morphTo) morphTargets.add(ab.morphTo);
    }
    const rosterUnion = new Set(Object.values(registry.factions).flatMap(f => f.unitTypes));
    const expected = Object.keys(registry.unitTypes).filter(id => rosterUnion.has(id) || !morphTargets.has(id));
    for (let team = 0; team < 2; team++) {
      for (const uid of expected) {
        expect(s.units.filter(u => u.owner === team && u.typeId === uid).length).toBe(1);
      }
    }
    expect(s.units.length).toBe(expected.length * 2);
  });

  it('moving a unit does not exhaust it — it can move again immediately', () => {
    const legal = getLegalActions(s, registry, 0);
    const move = legal.find(a => a.type === 'move');
    expect(move).toBeDefined();
    const after = applyAction(s, move!, registry);
    const unit = after.units.find(u => u.id === (move as { unitId: number }).unitId)!;
    expect(unit.hasMoved).toBe(false);
    expect(unit.hasAttacked).toBe(false);
    const legalAfter = getLegalActions(after, registry, 0);
    expect(legalAfter.some(a => a.type === 'move' && (a as { unitId: number }).unitId === unit.id)).toBe(true);
  });

  it('casting an ability leaves no cooldown and the unit can act again', () => {
    const legal = getLegalActions(s, registry, 0);
    const cast = legal.find(a => a.type === 'useAbility');
    expect(cast).toBeDefined();
    const after = applyAction(s, cast!, registry);
    const unit = after.units.find(u => u.id === (cast as { unitId: number }).unitId)!;
    expect(unit.hasAttacked).toBe(false);
    expect(Object.keys(unit.abilityCooldowns).length).toBe(0);
    const legalAfter = getLegalActions(after, registry, 0);
    expect(legalAfter.some(a => (a as { unitId?: number }).unitId === unit.id)).toBe(true);
  });

  it('normal (non-sandbox) test combat is unchanged: moving exhausts the unit', () => {
    const normal = createTestCombatGame({ ...defaultConfig, fogOfWar: false }, registry, ['vanguard', 'hive'], 7);
    const legal = getLegalActions(normal, registry, 0);
    const move = legal.find(a => a.type === 'move');
    expect(move).toBeDefined();
    const after = applyAction(normal, move!, registry);
    const unit = after.units.find(u => u.id === (move as { unitId: number }).unitId)!;
    expect(unit.hasMoved).toBe(true);
  });
});
