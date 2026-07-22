import { describe, it, expect } from 'vitest';
import { createTestCombatGame, getLegalActions } from './index.js';
import { buildRegistry, defaultConfig } from '@tactica/data';

const registry = buildRegistry();

describe('Test Combat Mode setup', () => {
  const s = createTestCombatGame({ ...defaultConfig, techTreeEnabled: false }, registry, ['vanguard','hive'], 7);

  it('is a 14×14 map with 6 level-1 cities at the specified tiles', () => {
    expect(s.map.width).toBe(14); expect(s.map.height).toBe(14);
    expect(s.cities.length).toBe(6);
    const at = (x:number,y:number,owner:number) => s.cities.some(c=>c.position.x===x&&c.position.y===y&&c.owner===owner&&c.level===1);
    expect(at(2,3,0)).toBe(true); expect(at(6,3,0)).toBe(true); expect(at(10,3,0)).toBe(true);   // c4,g4,k4
    expect(at(2,10,1)).toBe(true); expect(at(6,10,1)).toBe(true); expect(at(10,10,1)).toBe(true); // c11,g11,k11
    expect(s.cities.every(c=>c.owner===0?[3].includes(c.position.y):[10].includes(c.position.y))).toBe(true);
  });

  it('the middle no-mans-land (cols 0-11, rows 5-9) has NO ruins or resources', () => {
    for (let y=5;y<=9;y++) for (let x=0;x<=11;x++){
      const t = s.map.tiles[y][x];
      expect(t.isResourceTile).toBe(false);
      expect(t.isRuin ?? false).toBe(false);
    }
  });

  it('spawns exactly 2 of every unit each faction can build', () => {
    for (let team=0; team<2; team++){
      const roster = registry.factions[team===0?'vanguard':'hive'].unitTypes;
      for (const uid of roster){
        const n = s.units.filter(u=>u.owner===team && u.typeId===uid).length;
        expect(n).toBe(2);
      }
    }
    // no stray extra units
    expect(s.units.length).toBe((registry.factions['vanguard'].unitTypes.length + registry.factions['hive'].unitTypes.length) * 2);
  });

  it('every spawned unit is on a passable, unique, non-city tile', () => {
    const seen = new Set<string>();
    for (const u of s.units){
      const key = `${u.position.x},${u.position.y}`;
      expect(seen.has(key)).toBe(false); seen.add(key);
      const t = s.map.tiles[u.position.y][u.position.x];
      expect(t.isCity).toBe(false);
      expect(registry.terrainTypes[t.terrain]?.passable).toBe(true);
    }
  });

  it('produces a legal, playable state', () => {
    const legal = getLegalActions(s, registry, 0);
    expect(legal.some(a=>a.type==='move')).toBe(true);
    expect(legal.some(a=>a.type==='endTurn')).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = createTestCombatGame({ ...defaultConfig }, registry, ['vanguard','hive'], 42);
    const b = createTestCombatGame({ ...defaultConfig }, registry, ['vanguard','hive'], 42);
    expect(JSON.stringify(a.map)).toBe(JSON.stringify(b.map));
    expect(JSON.stringify(a.units)).toBe(JSON.stringify(b.units));
  });
});
