import type { Bot } from './types.js';
import type { Action, VisibleState, DataRegistry } from '@tactica/engine';
import { getLegalActions, createPRNG, nextInt } from '@tactica/engine';

export class RandomBot implements Bot {
  name = 'random';
  private prng;

  constructor(seed: number = 12345) {
    this.prng = createPRNG(seed);
  }

  chooseAction(visibleState: VisibleState, registry: DataRegistry): Action {
    // Reconstruct legal actions from visible state — for bots we use a simplified approach
    // In practice, bots receive the visible state and compute actions from it
    const actions = getLegalActionsFromVisible(visibleState, registry);
    if (actions.length === 0) return { type: 'endTurn' };

    const [idx, nextPrng] = nextInt(this.prng, 0, actions.length - 1);
    this.prng = nextPrng;
    return actions[idx];
  }
}

export function getLegalActionsFromVisible(state: VisibleState, registry: DataRegistry): Action[] {
  const playerId = state.currentPlayer;
  const actions: Action[] = [];
  const player = state.players[playerId];
  const faction = registry.factions[player.factionId];

  for (const unit of state.units) {
    if (unit.owner !== playerId) continue;
    const unitType = registry.unitTypes[unit.typeId];
    if (!unitType) continue;

    // Move actions — simplified (direct neighbor check based on movement)
    if (!unit.hasMoved) {
      const visited = new Map<string, number>();
      const queue = [{ x: unit.position.x, y: unit.position.y, cost: 0 }];
      visited.set(`${unit.position.x},${unit.position.y}`, 0);
      const ignoresTerrain = unitType.traits.includes('ignoresTerrainCost');
      const isFlying = unitType.traits.includes('flying');
      const occupiedByEnemy = new Set(state.units.filter(u => u.owner !== playerId).map(u => `${u.position.x},${u.position.y}`));
      const occupiedByFriendly = new Set(state.units.filter(u => u.owner === playerId && u.id !== unit.id).map(u => `${u.position.x},${u.position.y}`));

      while (queue.length > 0) {
        queue.sort((a, b) => a.cost - b.cost);
        const cur = queue.shift()!;
        const ck = `${cur.x},${cur.y}`;
        if (cur.cost > (visited.get(ck) ?? Infinity)) continue;

        if (cur.cost > 0 && !occupiedByFriendly.has(ck) && !occupiedByEnemy.has(ck)) {
          actions.push({ type: 'move', unitId: unit.id, to: { x: cur.x, y: cur.y } });
        }

        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (nx < 0 || nx >= state.map.width || ny < 0 || ny >= state.map.height) continue;
          const tile = state.map.tiles[ny][nx];
          const terrain = registry.terrainTypes[tile.terrain];
          if (!terrain) continue;
          if (!isFlying && !terrain.passable) continue;

          const nk = `${nx},${ny}`;
          if (occupiedByEnemy.has(nk)) continue;

          const moveCost = ignoresTerrain || isFlying ? 1 : terrain.movementCost;
          const newCost = cur.cost + moveCost;
          if (newCost > unitType.movement) continue;

          const prev = visited.get(nk);
          if (prev !== undefined && prev <= newCost) continue;
          visited.set(nk, newCost);
          queue.push({ x: nx, y: ny, cost: newCost });
        }
      }
    }

    // Attack actions
    if (!unit.hasAttacked) {
      if (unitType.traits.includes('noMoveAndAttack') && unit.hasMoved) continue;
      for (const target of state.units) {
        if (target.owner === playerId) continue;
        const dist = Math.abs(unit.position.x - target.position.x) + Math.abs(unit.position.y - target.position.y);
        if (dist <= unitType.attackRange) {
          actions.push({ type: 'attack', unitId: unit.id, targetId: target.id });
        }
      }
    }
  }

  // Recruit — at owned cities with a free unit slot and enough resources
  if (faction) {
    const econ = registry.economy;
    for (const city of state.cities) {
      if (city.owner !== playerId) continue;
      const { x, y } = city.position;
      const occupied = state.units.some(u => u.position.x === x && u.position.y === y);
      if (occupied) continue;
      const capacity = econ.city.popBase + (city.level - 1);
      const used = state.units.filter(u => state.unitHomeCity[u.id] === city.id).length;
      if (used >= capacity) continue;
      for (const utId of faction.unitTypes) {
        const ut = registry.unitTypes[utId];
        if (!ut) continue;
        if (ut.cost > player.ore) continue;
        if ((econ.unitPlasmaCost[utId] ?? 0) > player.plasma) continue;
        actions.push({ type: 'recruit', unitTypeId: utId, cityPosition: { x, y } });
      }
    }
  }

  // Research — branch-unlock availability + city-scaled ore cost
  const cityCount = state.cities.filter(c => c.owner === playerId).length;
  const tcfg = registry.techConfig;
  for (const [techId, tech] of Object.entries(registry.techs)) {
    if (player.researchedTechs.includes(techId)) continue;
    if (tech.level > tcfg.maxLevel) continue;
    if (tech.level > 1) {
      const hasLower = player.researchedTechs.some(id => {
        const t = registry.techs[id];
        return !!t && t.branch === tech.branch && t.level === tech.level - 1;
      });
      if (!hasLower) continue;
    }
    if (tech.prerequisites && !tech.prerequisites.every(p => player.researchedTechs.includes(p))) continue;
    const cost = (tcfg.costBaseByLevel[tech.level - 1] ?? 0) + (tcfg.costPerCityByLevel[tech.level - 1] ?? 0) * Math.max(0, cityCount - 1);
    if (cost > player.ore) continue;
    actions.push({ type: 'research', techId });
  }

  actions.push({ type: 'endTurn' });
  return actions;
}
