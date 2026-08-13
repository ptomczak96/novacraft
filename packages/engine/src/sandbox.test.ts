import { describe, it, expect } from 'vitest';
import { createTestCombatGame, getLegalActions, applyAction } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';

const registry = buildRegistry();

const sandboxConfig = { ...defaultConfig, sandboxMode: true, unlimitedResources: true, fogOfWar: false };

describe('Sandbox mode (prototyping)', () => {
  const s = createTestCombatGame(sandboxConfig, registry, ['vanguard', 'hive'], 7, { allUnitTypes: true, copies: 1 });

  it('spawns one of every non-morph unit kind for both teams', () => {
    for (let team = 0; team < 2; team++) {
      expect(s.units.filter(u => u.owner === team && u.typeId === 'scout')).toHaveLength(1);
      expect(s.units.filter(u => u.owner === team && u.typeId === 'scab')).toHaveLength(1);
      expect(s.units.filter(u => u.owner === team && u.typeId === 'tank_assault')).toHaveLength(0);
      expect(s.units.filter(u => u.owner === team && u.typeId === 'wyrm_burrowed')).toHaveLength(0);
    }
    expect(s.units.length).toBeGreaterThan(30);
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

  it('attacking does not exhaust a unit, so it can attack again immediately', () => {
    const state = createTestCombatGame(sandboxConfig, registry, ['vanguard', 'hive'], 7, { allUnitTypes: true, copies: 1 });
    const attacker = state.units.find(u => u.owner === 0 && u.typeId === 'tank')!;
    const defender = state.units.find(u => u.owner === 1 && u.typeId === 'titan')!;
    state.units = [attacker, defender];
    attacker.position = { x: 3, y: 3 };
    defender.position = { x: 4, y: 3 };
    attacker.hasMoved = false;
    attacker.hasAttacked = false;

    const attack = getLegalActions(state, registry, 0).find(
      a => a.type === 'attack' && a.unitId === attacker.id && a.targetId === defender.id,
    );
    expect(attack).toBeDefined();
    const after = applyAction(state, attack!, registry);
    expect(after.units.find(u => u.id === attacker.id)?.hasAttacked).toBe(false);
    expect(getLegalActions(after, registry, 0).some(
      a => a.type === 'attack' && a.unitId === attacker.id && a.targetId === defender.id,
    )).toBe(true);
  });

  it('offers tech-gated abilities without researching their prerequisite', () => {
    const state = createTestCombatGame(sandboxConfig, registry, ['vanguard', 'hive'], 7, { allUnitTypes: true, copies: 1 });
    const medic = state.units.find(u => u.owner === 0 && u.typeId === 'medic')!;
    const scout = state.units.find(u => u.owner === 0 && u.typeId === 'scout')!;
    state.units = [medic, scout];
    medic.position = { x: 3, y: 3 };
    scout.position = { x: 4, y: 3 };
    scout.hp -= 5;
    state.players[0].researchedTechs = [];

    expect(getLegalActions(state, registry, 0).some(
      a => a.type === 'useAbility' && a.unitId === medic.id && a.abilityId === 'heal_2',
    )).toBe(true);
  });

  it('does not passively heal damaged units when ending a sandbox turn', () => {
    const state = createTestCombatGame(sandboxConfig, registry, ['vanguard', 'hive'], 7, { allUnitTypes: true, copies: 1 });
    const scout = state.units.find(u => u.owner === 0 && u.typeId === 'scout')!;
    state.units = [scout];
    scout.hp -= 5;
    state.map.tiles[scout.position.y][scout.position.x].owner = null;
    const damagedHp = scout.hp;

    const after = applyAction(state, { type: 'endTurn' }, registry);
    expect(after.units.find(u => u.id === scout.id)?.hp).toBe(damagedHp);
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
