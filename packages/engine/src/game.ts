import type {
  GameState, GameConfig, GameResult, Action, MoveAction, AttackAction, SlashAction, WyrmStrikeAction, UseAbilityAction,
  RecruitAction, ResearchAction, BuildAction, UpgradeBuildingAction, FoundCityAction,
  CaptureCityAction, LevelUpCityAction, ExpandTerritoryAction, CancelNodeBuildAction, RemoveMarkAction, EndTurnAction, Unit, PlayerId, CityState,
  VisibleState, DataRegistry, Coord, PlayerState, TileVisibility, RecruitOption, UnitType, AbilityDef, NodeState, UnitMark,
} from './types.js';
import { createPRNG, nextInt } from './prng.js';
import { generateMap } from './mapgen.js';
import { getReachableTiles, distance, inRange } from './pathfinding.js';
import { resolveCombat, previewCombat, effectiveAttackRange, calculateDamage, getDefenseMultiplier } from './combat.js';
import type { CombatResult } from './combat.js';
import { getSlashArc, slashHitDamage } from './slash.js';
import { resolvePush, pushDir } from './push.js';
import { computeVisibility, recordSight, makePlayerMemory, revealTowardEnemy } from './fog.js';
import {
  settleEconomy, calculateOreIncome, calculatePlasmaIncome, recomputeCities,
  territoryCityAt, cityAt, cityById, cityHasCapacity, cityHasCapacityFor, cityOwnsTile, getUnitPlasmaCost,
  canBuild, canUpgradeBuilding, upgradeCostFor, buildingCost, canFoundCity,
  cityCanLevelUp, levelUpChoices, isChoiceAvailable, recruitOreCost, validateExpansion,
} from './economy.js';
import { getModifier, isTechAvailable, techCostForPlayer, isUnitUnlocked, techsUnlockingUnit, grantedConditions } from './tech.js';

// ── Deep clone helper (JSON round-trip, since state is JSON-serializable) ──
function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// "Unlimited Resources" mode: each team starts with 10,000 ore + 10,000 plasma (income
// still accrues on top) — plenty for a full game without micromanaging economy.
const UNLIMITED_RESOURCES = 10000;

// Applied statuses that are BENEFICIAL (never stripped by Cure). Everything else in
// unit.statuses (infected, corrosive_*, stunned, slowed…) is an "affliction".
const POSITIVE_STATUSES = new Set(['shielded']);
function unitAfflictions(unit: Unit): string[] {
  return (unit.statuses ?? []).filter(s => !POSITIVE_STATUSES.has(s));
}

// ── Create Game ──
export function createGame(
  config: GameConfig,
  registry: DataRegistry,
  factionIds: string[],
  seed: number,
): GameState {
  const prng = createPRNG(seed);
  const playerCount = factionIds.length;

  const [map, cityPositions, prngAfterMap] = generateMap(
    config.mapWidth, config.mapHeight, playerCount, registry, prng, config.mapgen,
  );

  // "Rich start" (testing): flood each team with resources so buildings/units can be
  // exercised without grinding economy first.
  const startOre = config.unlimitedResources ? UNLIMITED_RESOURCES : config.richStart ? 2000 : registry.economy.startingOre;
  const startPlasma = config.unlimitedResources ? UNLIMITED_RESOURCES : config.richStart ? 2000 : registry.economy.startingPlasma;
  const players: PlayerState[] = factionIds.map((factionId, i) => ({
    id: i,
    factionId,
    ore: startOre,
    plasma: startPlasma,
    researchedTechs: [],
  }));

  // Tech tree OFF (config.techTreeEnabled === false): unlock everything by pre-
  // researching all (non-locked) techs. All existing gating (isUnitUnlocked,
  // getModifier, isTechAvailable) then works unchanged — tech→unit links stay
  // intact, they're just already satisfied. (Undefined/true keeps normal gating.)
  if (config.techTreeEnabled === false) {
    const allTechs = Object.entries(registry.techs).filter(([, t]) => !t.locked).map(([id]) => id);
    for (const p of players) p.researchedTechs = [...allTechs];
  }

  // Build city state from the map. Each player's starting city is a capital;
  // any other city tiles begin as neutral level-1 cities.
  const capitalKeys = new Set(cityPositions.map(p => `${p.x},${p.y}`));
  const cities: CityState[] = [];
  let nextCityId = 1;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y][x];
      if (!tile.isCity) continue;
      cities.push({
        id: nextCityId++,
        position: { x, y },
        owner: tile.owner,
        isCapital: capitalKeys.has(`${x},${y}`),
        level: 1,
        supply: 0,
        incomeBonus: 0,
        popBonus: 0,
        bonusSupply: 0,
        fortified: false,
        extraTerritory: [],
      });
    }
  }

  // Place each faction's starting units at/around their capital (default: 1 warrior;
  // e.g. Hive starts with 2 scuttlings). Multiple units fill the capital tile then
  // free passable neighbours, deterministically.
  const units: Unit[] = [];
  const unitHomeCity: Record<number, number> = {};
  let nextUnitId = 1;
  const spawnOrder = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let i = 0; i < playerCount; i++) {
    const pos = cityPositions[i];
    const capital = cities.find(c => c.position.x === pos.x && c.position.y === pos.y);
    const faction = registry.factions[factionIds[i]];
    const spec = faction?.startingUnits ?? [{ unit: 'warrior', count: 1 }];
    const toSpawn = spec.flatMap(s => Array.from({ length: s.count }, () => s.unit));

    let slot = 0;
    for (const typeId of toSpawn) {
      const ut = registry.unitTypes[typeId];
      if (!ut) continue;
      // Find the next free spawn tile (centre always ok; neighbours must be passable).
      let placed: Coord | null = null;
      for (; slot < spawnOrder.length; slot++) {
        const [dx, dy] = spawnOrder[slot];
        const tx = pos.x + dx, ty = pos.y + dy;
        const tile = map.tiles[ty]?.[tx];
        if (!tile) continue;
        if ((dx !== 0 || dy !== 0) && !registry.terrainTypes[tile.terrain]?.passable) continue;
        if (units.some(u => u.position.x === tx && u.position.y === ty)) continue;
        placed = { x: tx, y: ty };
        slot++;
        break;
      }
      if (!placed) break; // no room left in the territory
      const id = nextUnitId++;
      units.push({ id, typeId, owner: i, position: placed, hp: ut.maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
      if (capital) unitHomeCity[id] = capital.id;
    }
  }

  const state: GameState = {
    config,
    map,
    units,
    players,
    cities,
    buildings: [],
    nodes: [],
    unitHomeCity,
    memory: players.map(() => makePlayerMemory(map.width, map.height)),
    revealedTiles: players.map(() => []),
    combinedArmsHits: {},
    currentPlayer: 0,
    turn: 1,
    nextUnitId,
    nextCityId,
    nextBuildingId: 1,
    nextNodeId: 1,
    prng: prngAfterMap,
    actionLog: [],
    phase: 'playing',
    winner: null,
    winConditionMet: null,
  };

  // Seed each player's fog memory with what they can see at the start.
  for (let p = 0; p < players.length; p++) recordSight(state, p, registry);
  return state;
}

/**
 * "Test Combat Mode" — a fixed 14×14 sandbox. Two teams, 3 level-1 cities each
 * (team 0 at c4/g4/k4, team 1 at c11/g11/k11), a clean environmental no-man's-land in the
 * middle (cols a–l, rows 6–10 — no ruins/resources), and 2 of EVERY unit each faction can
 * build, spawned on/next to its territory. Obeys the same config (fog, tech tree, rich
 * start, mapgen biome…) as a normal game.
 */
export function createTestCombatGame(config: GameConfig, registry: DataRegistry, factionIds: string[], seed: number): GameState {
  const W = 14, H = 14;
  const cfg: GameConfig = { ...config, mapWidth: W, mapHeight: H };
  const prng = createPRNG(seed);

  // Environmental base map (terrain + resources + ruins). We discard its cities/ownership.
  const [map, , prngAfterMap] = generateMap(W, H, 2, registry, prng, config.mapgen);

  // City layout — 1-indexed cols a=1..n=14, rows 1..14 → 0-indexed (letter-1, number-1).
  const teamCities: Coord[][] = [
    [{ x: 2, y: 3 }, { x: 6, y: 3 }, { x: 10, y: 3 }],    // c4, g4, k4  (team 0, top)
    [{ x: 2, y: 10 }, { x: 6, y: 10 }, { x: 10, y: 10 }], // c11, g11, k11 (team 1, bottom)
  ];

  // Strip ALL mapgen cities + territory ownership (keep terrain/resources/ruins elsewhere).
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = map.tiles[y][x];
    t.isCity = false; t.owner = null; t.isPerimeter = false; t.fortified = false;
  }

  // Clean the middle no-man's-land (bounding box of corners a6/l7/l10/a9 → cols 0–11,
  // rows 5–9): remove ruins & resources, keep the environmental terrain untouched.
  for (let y = 5; y <= 9; y++) for (let x = 0; x <= 11; x++) {
    const t = map.tiles[y][x];
    t.isResourceTile = false; t.resourceKind = null; t.isRuin = false;
  }

  // Carve each team's 3 bases: a clean 3×3 of owned plains, centre = city, no resources.
  for (let team = 0; team < 2; team++) {
    for (const c of teamCities[team]) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = c.x + dx, ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const t = map.tiles[ny][nx];
        const isCenter = dx === 0 && dy === 0;
        t.terrain = 'plains'; t.owner = team; t.isResourceTile = false; t.resourceKind = null;
        t.isRuin = false; t.isCity = isCenter; t.isPerimeter = !isCenter;
      }
    }
  }

  // Cities: 3 per team, level 1 (the first of each team is that team's capital).
  const cities: CityState[] = [];
  let nextCityId = 1;
  for (let team = 0; team < 2; team++) {
    teamCities[team].forEach((c, idx) => {
      cities.push({
        id: nextCityId++, position: { ...c }, owner: team, isCapital: idx === 0,
        level: 1, supply: 0, incomeBonus: 0, popBonus: 0, bonusSupply: 0, fortified: false, extraTerritory: [],
      });
    });
  }

  // Players (rich start / tech-tree-off handled exactly as in createGame).
  const startOre = config.unlimitedResources ? UNLIMITED_RESOURCES : config.richStart ? 2000 : registry.economy.startingOre;
  const startPlasma = config.unlimitedResources ? UNLIMITED_RESOURCES : config.richStart ? 2000 : registry.economy.startingPlasma;
  const players: PlayerState[] = factionIds.map((factionId, i) => ({
    id: i, factionId, ore: startOre, plasma: startPlasma, researchedTechs: [],
  }));
  if (config.techTreeEnabled === false) {
    const allTechs = Object.entries(registry.techs).filter(([, t]) => !t.locked).map(([id]) => id);
    for (const pl of players) pl.researchedTechs = [...allTechs];
  }

  // Spawn 2 of EVERY unit each faction can build, on passable non-mountain tiles within
  // Chebyshev 2 of the team's cities (on/next to its territory), deterministically.
  const units: Unit[] = [];
  const unitHomeCity: Record<number, number> = {};
  let nextUnitId = 1;
  const occupied = new Set<string>();
  const cheb = (a: Coord, b: Coord) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  for (let team = 0; team < 2; team++) {
    const roster = registry.factions[factionIds[team]]?.unitTypes ?? [];
    const toSpawn = roster.flatMap(uid => [uid, uid]); // 2 of each
    // Candidate tiles (row-major, deterministic) around this team's cities.
    const seen = new Set<string>();
    const candidates: Coord[] = [];
    for (const c of teamCities[team]) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = c.x + dx, ny = c.y + dy, key = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(key)) continue;
        seen.add(key);
        const t = map.tiles[ny][nx];
        const terr = registry.terrainTypes[t.terrain];
        if (t.isCity || !terr?.passable || terr.id === 'mountain') continue; // stand-able ground only
        candidates.push({ x: nx, y: ny });
      }
    }
    candidates.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    let ci = 0;
    for (const typeId of toSpawn) {
      const ut = registry.unitTypes[typeId];
      if (!ut) continue;
      while (ci < candidates.length && occupied.has(`${candidates[ci].x},${candidates[ci].y}`)) ci++;
      if (ci >= candidates.length) break; // out of room (shouldn't happen at this scale)
      const pos = candidates[ci++];
      occupied.add(`${pos.x},${pos.y}`);
      const id = nextUnitId++;
      units.push({ id, typeId, owner: team, position: { ...pos }, hp: ut.maxHP, hasMoved: false, hasAttacked: false, abilityCooldowns: {} });
      const home = cities.filter(c => c.owner === team).sort((a, b) => cheb(a.position, pos) - cheb(b.position, pos))[0];
      if (home) unitHomeCity[id] = home.id;
    }
  }

  const state: GameState = {
    config: cfg, map, units, players, cities, buildings: [], nodes: [], unitHomeCity,
    memory: players.map(() => makePlayerMemory(W, H)),
    revealedTiles: players.map(() => []),
    combinedArmsHits: {},
    currentPlayer: 0, turn: 1,
    nextUnitId, nextCityId, nextBuildingId: 1, nextNodeId: 1,
    prng: prngAfterMap, actionLog: [],
    phase: 'playing', winner: null, winConditionMet: null,
  };
  for (let p = 0; p < players.length; p++) recordSight(state, p, registry);
  return state;
}

function findAdjacentSpawn(map: { width: number; height: number; tiles: { terrain: string }[][] }, pos: Coord, occupiedPositions: Coord[]): Coord {
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const occupied = new Set(occupiedPositions.map(p => `${p.x},${p.y}`));
  for (const [dx, dy] of dirs) {
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
      if (!occupied.has(`${nx},${ny}`)) {
        return { x: nx, y: ny };
      }
    }
  }
  return pos; // fallback to city tile
}

// Eligible target tiles for a multi-unit ability (Cure / Repair): friendly units of the
// allowed class(es) within range, excluding the caster. Shared by getLegalActions and the
// UI target picker so they agree exactly. (Buildings are NOT targeted yet — no building-HP
// model exists; see docs.)
export function getAbilityUnitTargets(state: GameState, unitId: number, abilityId: string, registry: DataRegistry): Coord[] {
  const caster = state.units.find(u => u.id === unitId);
  if (!caster) return [];
  const ability = registry.unitTypes[caster.typeId]?.abilities.find(a => a.id === abilityId);
  if (!ability || ability.targetKind !== 'units') return [];
  const range = ability.range ?? 1;
  const classes = ability.targetClasses ?? [];
  const out: Coord[] = [];
  for (const u of state.units) {
    if (u.id === caster.id) continue; // no self-target
    if (ability.targetAlly && u.owner !== caster.owner) continue;
    if (ability.targetEnemy && u.owner === caster.owner) continue;
    const tc = registry.unitTypes[u.typeId]?.unitClass;
    if (classes.length > 0 && (!tc || !classes.includes(tc))) continue;
    if (ability.targetAfflicted && unitAfflictions(u).length === 0) continue; // Cure: only afflicted allies
    if (Math.max(Math.abs(u.position.x - caster.position.x), Math.abs(u.position.y - caster.position.y)) > range) continue;
    out.push({ x: u.position.x, y: u.position.y });
  }
  return out;
}

// ── Get Legal Actions ──
export function getLegalActions(state: GameState, registry: DataRegistry, playerId: PlayerId): Action[] {
  if (state.phase !== 'playing') return [];
  if (state.currentPlayer !== playerId) return [];

  const actions: Action[] = [];
  const player = state.players[playerId];
  const faction = registry.factions[player.factionId];

  // Movement bonus from tech
  const movementBonus = getMovementBonus(player, registry);

  // Enemy Area-of-Influence tiles (Zone of Control). Shared by all this player's movers —
  // entering one stops movement. A mover with `aoi_immune` ignores it (scaffolding).
  const aoiTiles = enemyAOITiles(state, playerId, registry);

  // Cloaked enemy tiles hidden from this player → any of their units can BUMP them (move
  // onto → reveal + stop). Burrowed enemies are co-occupied, not bumped, so they're excluded.
  const hiddenEnemyTiles = new Set<string>();
  for (const e of state.units) {
    if (e.owner === playerId) continue;
    if (registry.unitTypes[e.typeId]?.conditions?.includes('burrowed')) continue;
    if (unitHiddenByCloak(state, e, playerId, registry)) hiddenEnemyTiles.add(`${e.position.x},${e.position.y}`);
  }

  // Tiles the player has already seen — a blind unit won't walk into a KNOWN lethal tile
  // (it's blocked); only HIDDEN lethal tiles are fatal. Built only when a blind unit exists.
  const knownTiles = new Set<string>();
  if (state.units.some(u => u.owner === playerId && registry.unitTypes[u.typeId]?.conditions?.includes('blind'))) {
    const mem = state.memory?.[playerId];
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        if (!state.config.fogOfWar || mem?.tiles[y]?.[x]) knownTiles.add(`${x},${y}`);
      }
    }
  }

  // Per-unit actions
  for (const unit of state.units) {
    if (unit.owner !== playerId) continue;
    // Effective type = base + tech-granted conditions (Adrenal Glands, Precision Targeting…),
    // so granted passives affect movement / AOI / range / dash below.
    const unitType = effectiveUnitType(state, unit, registry);
    if (!unitType) continue;
    // "Stunned" (Wraith's Stun): the unit can't move or act this turn.
    if (unit.statuses?.includes('stunned')) continue;

    // A node-building engineer may explicitly cancel construction (any other action also
    // cancels it, but this is the clean "stop building, do nothing else" option).
    if (unit.buildingNodeId !== undefined) {
      actions.push({ type: 'cancelNodeBuild', unitId: unit.id });
    }

    // Remove a Tracer / Explosives mark from an adjacent friendly ally — only if the mark is
    // Detect-visible to us, this unit hasn't attacked/cast yet, and it isn't the marked unit.
    if (!unit.hasAttacked) {
      for (const ally of state.units) {
        if (ally.owner !== playerId || ally.id === unit.id || !ally.marks?.length) continue;
        if (Math.max(Math.abs(ally.position.x - unit.position.x), Math.abs(ally.position.y - unit.position.y)) > 1) continue;
        if (!teamHasDetectOn(state, ally.position, playerId, registry)) continue;
        for (const m of ally.marks) actions.push({ type: 'removeMark', unitId: unit.id, target: { ...ally.position }, kind: m.kind });
      }
    }

    // Capture: standing on an enemy/neutral city, but only when the unit didn't
    // move onto it this turn (so capture becomes available the FOLLOWING turn).
    if (!unit.hasMoved && !unitType.conditions?.includes('burrowed')) {
      const onCity = cityAt(state, unit.position);
      if (onCity && onCity.owner !== playerId) {
        actions.push({ type: 'captureCity', unitId: unit.id });
      }
    }

    // Move actions. Default: a unit moves BEFORE attacking and can't move afterward.
    // Exception — the "Dash N" condition grants a post-attack move of up to N tiles.
    const canBump = unitType.conditions?.includes('blind') ?? false;
    const dash = unit.dashRemaining ?? 0;
    if (!unit.hasMoved && !unit.hasAttacked) {
      const bumps = new Map<string, string>();
      const moverAOI = unitType.conditions?.includes('aoi_immune') ? undefined : aoiTiles;
      const reachable = getReachableTiles(unit, unitType, state.map, state.units, registry, movementBonus, canBump, state.buildings, bumps, moverAOI, hiddenEnemyTiles, knownTiles);
      for (const [key] of reachable) {
        const [x, y] = key.split(',').map(Number);
        actions.push({ type: 'move', unitId: unit.id, to: { x, y } });
      }
      // Bump moves: land on the valid tile, reveal the impassable tile as fog.
      for (const [impassableKey, landKey] of bumps) {
        const [ix, iy] = impassableKey.split(',').map(Number);
        const [lx, ly] = landKey.split(',').map(Number);
        actions.push({ type: 'move', unitId: unit.id, to: { x: lx, y: ly }, bumpReveal: { x: ix, y: iy } });
      }
    } else if (unit.hasAttacked && dash > 0) {
      const moverAOI = unitType.conditions?.includes('aoi_immune') ? undefined : aoiTiles;
      const reachable = getReachableTiles(unit, { ...unitType, movement: dash }, state.map, state.units, registry, 0, canBump, state.buildings, undefined, moverAOI, hiddenEnemyTiles, knownTiles);
      for (const [key] of reachable) {
        const [x, y] = key.split(',').map(Number);
        actions.push({ type: 'move', unitId: unit.id, to: { x, y } });
      }
    }

    // Attack actions — burrowed units and attack-0 units (e.g. Sentinel) can't attack.
    if (!unit.hasAttacked && !unitType.conditions?.includes('burrowed') && unitType.attack > 0) {
      // Can't attack after moving — the `noMoveAndAttack` trait (Catapult/Siege Tower)
      // or the `repositioning` passive (Tank).
      if (mustStayToAttack(unitType) && unit.hasMoved) continue;

      if (unitType.conditions?.includes('twin_strike')) {
        // Wyrm strike: two touching cells (primary in the 3×3, secondary adjacent to it).
        // Offer every geometric pair that hits ≥1 enemy (into fog too, for the UI, but the
        // UI drives that via its own picker — this keeps bot legality meaningful).
        for (const [t0, t1] of wyrmStrikePairs(unit.position, state.map.width, state.map.height)) {
          const hitsEnemy = [t0, t1].some(c =>
            state.units.some(u => u.owner !== playerId && !isAir(registry.unitTypes[u.typeId]) && u.position.x === c.x && u.position.y === c.y));
          if (hitsEnemy) actions.push({ type: 'wyrmStrike', unitId: unit.id, tiles: [t0, t1] });
        }
      } else if (unitType.conditions?.includes('slash')) {
        // Slash units attack a 3-tile arc instead of a single target. Offer one
        // Slash per neighbouring central tile whose arc contains ≥1 enemy. The
        // Slash replaces the normal single-target attack (it's the only attack).
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const center = { x: unit.position.x + dx, y: unit.position.y + dy };
            if (center.y < 0 || center.y >= state.map.height || center.x < 0 || center.x >= state.map.width) continue;
            const arc = getSlashArc(unit.position, center);
            const hitsEnemy = arc.some(({ coord }) =>
              state.units.some(u => u.owner !== playerId && !isAir(registry.unitTypes[u.typeId]) && u.position.x === coord.x && u.position.y === coord.y));
            if (hitsEnemy) actions.push({ type: 'slash', unitId: unit.id, target: center });
          }
        }
      } else {
        // Banded range: attack only if minAttackRange ≤ Chebyshev dist ≤ effective max.
        // Effective max accounts for "Mountain shooter 2" (+1 range on a mountain) and
        // "Overwatch Network I" (+1 range for a RANGED unit next to a friendly Sentinel).
        const atkTile = state.map.tiles[unit.position.y]?.[unit.position.x];
        const overwatch = unitType.attackRange >= 2 && state.units.some(o =>
          o.owner === playerId && o.id !== unit.id
          && registry.unitTypes[o.typeId]?.conditions?.includes('overwatch_network_1')
          && Math.max(Math.abs(o.position.x - unit.position.x), Math.abs(o.position.y - unit.position.y)) <= 1);
        const maxRange = effectiveAttackRange(unitType, atkTile) + (overwatch ? 1 : 0);
        const minRange = unitType.minAttackRange ?? 1;
        const melee = unitType.attackRange <= 1; // melee weapons can't hit AIR units
        for (const target of state.units) {
          if (target.owner === playerId) continue;
          if (melee && isAir(registry.unitTypes[target.typeId])) continue; // air is melee-immune
          const d = Math.max(Math.abs(unit.position.x - target.position.x), Math.abs(unit.position.y - target.position.y));
          if (d >= minRange && d <= maxRange) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: target.id });
          }
        }
      }
    }

    // Active abilities (cast) — like the attack action, casting spends the unit's
    // turn, so it's gated on !hasAttacked and on the ability's cooldown being ready.
    if (!unit.hasAttacked && unitType.abilities.length > 0) {
      for (const ability of unitType.abilities) {
        if (ability.disabled) continue; // greyed-out placeholder — never offered
        // Tech-gated ability (e.g. Medic's Slow needs Advanced Biomed).
        if (ability.requiresTech && !player.researchedTechs.includes(ability.requiresTech)) continue;
        // Superseded ability (e.g. Cure I once Advanced Biomed replaces it with Cure II).
        if (ability.supersededByTech && player.researchedTechs.includes(ability.supersededByTech)) continue;
        if ((unit.abilityCooldowns[ability.id] ?? 0) > 0) continue;
        const range = ability.range ?? 0;
        if (ability.targetKind === 'units') {
          // Cure/Repair: offer one single-target cast per eligible ally (the UI can pick more
          // via the target picker; applyUseAbility validates & caps at maxTargets).
          for (const c of getAbilityUnitTargets(state, unit.id, ability.id, registry)) {
            actions.push({ type: 'useAbility', unitId: unit.id, abilityId: ability.id, target: { ...c }, targets: [{ ...c }] });
          }
        } else if (ability.targetKind === 'unit') {
          for (const target of state.units) {
            if (target.id === unit.id) continue;
            if (ability.targetEnemy && target.owner === playerId) continue;
            if (ability.targetAlly && target.owner !== playerId) continue;
            if (ability.targetClass && registry.unitTypes[target.typeId]?.unitClass !== ability.targetClass) continue;
            if (inRange(unit.position, target.position, range)) {
              actions.push({ type: 'useAbility', unitId: unit.id, abilityId: ability.id, target: { ...target.position } });
            }
          }
        } else if (ability.id === 'build_node') {
          // Build Node: only offer VALID placement tiles in range, and only if affordable.
          if (player.ore >= NODE_BUILD_COST) {
            for (let dy = -range; dy <= range; dy++) {
              for (let dx = -range; dx <= range; dx++) {
                const c = { x: unit.position.x + dx, y: unit.position.y + dy };
                if (canPlaceNode(state, playerId, c)) {
                  actions.push({ type: 'useAbility', unitId: unit.id, abilityId: ability.id, target: c });
                }
              }
            }
          }
        } else if (ability.targetKind === 'tile') {
          for (let dy = -range; dy <= range; dy++) {
            for (let dx = -range; dx <= range; dx++) {
              const tx = unit.position.x + dx, ty = unit.position.y + dy;
              if (ty < 0 || ty >= state.map.height || tx < 0 || tx >= state.map.width) continue;
              actions.push({ type: 'useAbility', unitId: unit.id, abilityId: ability.id, target: { x: tx, y: ty } });
            }
          }
        } else if (ability.targetKind === 'grid2x2') {
          // Ballistic Volley: every valid 2×2 square whose 4 tiles are all in the
          // ability's range band (minRange..range) from the caster.
          for (const grid of enumerateVolleyGrids(unit.position, state.map.width, state.map.height, ability.minRange ?? 0, range)) {
            actions.push({ type: 'useAbility', unitId: unit.id, abilityId: ability.id, target: { ...grid[0] }, tiles: grid.map(c => ({ ...c })) });
          }
        } else {
          // Self-target ability (no targetKind), e.g. Assault Mode — targets own tile.
          // The Wyrm can't Burrow/Erupt on a city, mountain, or building tile.
          if ((ability.id === 'burrow' || ability.id === 'erupt') && !canBurrowEruptAt(state, unit.position, registry)) continue;
          actions.push({ type: 'useAbility', unitId: unit.id, abilityId: ability.id, target: { ...unit.position } });
        }
      }
    }
  }

  // Recruit actions — at owned cities with a free unit slot and enough resources
  if (faction) {
    for (const city of state.cities) {
      if (city.owner !== playerId) continue;
      const { x, y } = city.position;
      // Need an empty city tile to recruit at.
      const occupied = state.units.some(u => u.position.x === x && u.position.y === y);
      if (occupied) continue;
      for (const unitTypeId of faction.unitTypes) {
        const ut = registry.unitTypes[unitTypeId];
        if (!ut) continue;
        if (!isUnitUnlocked(state, playerId, unitTypeId, registry)) continue;
        if (recruitOreCost(ut.cost, city) > player.ore) continue;
        if (getUnitPlasmaCost(unitTypeId, registry) > player.plasma) continue;
        // Pop this recruit adds (paired/half-pop units: e.g. a scuttling pair = 1).
        const addedPop = (ut.popCost ?? 1) * (ut.recruitCount ?? 1);
        if (!cityHasCapacityFor(state, city, registry, addedPop)) continue;
        actions.push({ type: 'recruit', unitTypeId, cityPosition: { x, y } });
      }
    }
  }

  // Economy actions — build / upgrade structures, found cities
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      const pos = { x, y };
      for (const kind of ['mine', 'extractor', 'refinery', 'purifier'] as const) {
        if (canBuild(state, registry, playerId, kind, pos)) {
          actions.push({ type: 'build', kind, position: pos });
        }
      }
      if (canUpgradeBuilding(state, registry, playerId, pos)) {
        actions.push({ type: 'upgradeBuilding', position: pos });
      }
      if (canFoundCity(state, registry, playerId, pos)) {
        actions.push({ type: 'foundCity', position: pos });
      }
    }
  }

  // Level-up actions — for each owned city ready to level, offer both reward
  // choices for the level it would reach. (Deferred choices reveal/territory are
  // still emitted; their effect lands in a later group. UI may disable them.)
  for (const city of state.cities) {
    if (city.owner !== playerId) continue;
    if (!cityCanLevelUp(city, registry)) continue;
    const choices = levelUpChoices(city.level + 1);
    if (!choices) continue;
    // Hero is greyed out (no heroes yet / only one at a time) → never a legal pick.
    if (isChoiceAvailable(choices.a)) actions.push({ type: 'levelUpCity', cityId: city.id, choice: choices.a });
    if (isChoiceAvailable(choices.b)) actions.push({ type: 'levelUpCity', cityId: city.id, choice: choices.b });
  }

  // Research actions — branch-unlock availability + city-scaled ore cost
  for (const [techId, tech] of Object.entries(registry.techs)) {
    if (!isTechAvailable(state, playerId, tech, registry)) continue;
    if (techCostForPlayer(state, playerId, tech, registry) > player.ore) continue;
    actions.push({ type: 'research', techId });
  }

  // End turn is always available
  actions.push({ type: 'endTurn' });

  return actions;
}

/**
 * Every unit a player's city could recruit (unlocked + fits the city's pop + the
 * city tile is free), each flagged `affordable`. Unlike getLegalActions (which only
 * lists affordable recruits as actions), this drives the UI so unaffordable units can
 * still be shown — greyed/red — rather than vanishing.
 */
export function getRecruitOptions(
  state: GameState,
  registry: DataRegistry,
  playerId: PlayerId,
  cityPosition: Coord,
): RecruitOption[] {
  const city = cityAt(state, cityPosition);
  if (!city || city.owner !== playerId) return [];
  const player = state.players[playerId];
  const faction = registry.factions[player.factionId];
  if (!faction) return [];

  // Show the ENTIRE roster for an owned city, always — tech-locked units (greyed) and
  // pop-blocked units (flagged `fitsPop:false`) included, so the panel never collapses
  // to a handful of tiles. Recruitability is decided per-flag by the UI / getLegalActions.
  const options: RecruitOption[] = [];
  for (const unitTypeId of faction.unitTypes) {
    const ut = registry.unitTypes[unitTypeId];
    if (!ut) continue;
    const locked = !isUnitUnlocked(state, playerId, unitTypeId, registry);
    const addedPop = (ut.popCost ?? 1) * (ut.recruitCount ?? 1);
    const plasmaCost = getUnitPlasmaCost(unitTypeId, registry);
    const oreCost = recruitOreCost(ut.cost, city); // "Conscription" city discount
    options.push({
      unitTypeId,
      cost: oreCost,
      plasmaCost,
      affordable: oreCost <= player.ore && plasmaCost <= player.plasma,
      locked,
      lockedBy: locked ? techsUnlockingUnit(unitTypeId, registry) : undefined,
      fitsPop: cityHasCapacityFor(state, city, registry, addedPop),
    });
  }
  return options;
}

// ── Apply Action ──
export function applyAction(state: GameState, action: Action, registry: DataRegistry): GameState {
  const newState = clone(state);
  newState.actionLog.push(action);

  const result = dispatchAction(newState, action, registry);

  // Refresh fog memory after the action: the acting player (their units may have
  // moved and revealed new tiles) and, after an endTurn, the player now on turn.
  if (result.config.fogOfWar && result.memory) {
    recordSight(result, state.currentPlayer, registry);
    if (result.currentPlayer !== state.currentPlayer) {
      recordSight(result, result.currentPlayer, registry);
    }
  }
  return result;
}

function dispatchAction(newState: GameState, action: Action, registry: DataRegistry): GameState {
  switch (action.type) {
    case 'move':
      return applyMove(newState, action, registry);
    case 'attack':
      return applyAttack(newState, action, registry);
    case 'slash':
      return applySlash(newState, action, registry);
    case 'wyrmStrike':
      return applyWyrmStrike(newState, action, registry);
    case 'useAbility':
      return applyUseAbility(newState, action, registry);
    case 'recruit':
      return applyRecruit(newState, action, registry);
    case 'research':
      return applyResearch(newState, action, registry);
    case 'build':
      return applyBuild(newState, action, registry);
    case 'upgradeBuilding':
      return applyUpgradeBuilding(newState, action, registry);
    case 'foundCity':
      return applyFoundCity(newState, action, registry);
    case 'captureCity':
      return applyCaptureCity(newState, action, registry);
    case 'levelUpCity':
      return applyLevelUpCity(newState, action, registry);
    case 'expandTerritory':
      return applyExpandTerritory(newState, action, registry);
    case 'cancelNodeBuild':
      return applyCancelNodeBuild(newState, action, registry);
    case 'removeMark':
      return applyRemoveMark(newState, action, registry);
    case 'endTurn':
      return applyEndTurn(newState, registry);
    default:
      return newState;
  }
}

function applyMove(state: GameState, action: MoveAction, registry: DataRegistry): GameState {
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit) return state;
  cancelNodeForActingUnit(state, unit); // moving abandons any node this engineer was building

  const ut = registry.unitTypes[unit.typeId];

  // BUMP (enemy): moving onto a tile with an enemy the mover can't see doesn't move — it
  // stays put, REVEALS that enemy for the rest of this turn (the tile also enters fog
  // memory), and may then attack (range 1) or stand still. Any unit bumps a cloaked enemy;
  // a blind unit bumps any hidden enemy — EXCEPT it cannot reveal a CLOAKED one (blind
  // can't pierce cloak). Two exemptions co-occupy the tile instead of bumping: a BURROWED
  // enemy (you pass over it), and a BURROWED MOVER (the Wyrm slides UNDER anything).
  const enemyOnTarget = state.units.find(
    u => u.position.x === action.to.x && u.position.y === action.to.y && u.owner !== unit.owner,
  );
  if (enemyOnTarget) {
    const et = registry.unitTypes[enemyOnTarget.typeId];
    const enemyBurrowed = et?.conditions?.includes('burrowed') ?? false;
    const moverBurrowed = ut?.conditions?.includes('burrowed') ?? false;
    if (!enemyBurrowed && !moverBurrowed) {
      const moverBlind = ut?.conditions?.includes('blind') ?? false;
      const enemyCloaked = et?.conditions?.includes('cloak') ?? false;
      const reveal = !(moverBlind && enemyCloaked);
      unit.hasMoved = true; // the bump spends the move; hasAttacked stays false so it can attack
      if (reveal) {
        const p = unit.owner;
        (state.revealedTiles[p] ??= []).push({ x: action.to.x, y: action.to.y });
        const mem = state.memory?.[p];
        if (mem) mem.tiles[action.to.y][action.to.x] = clone(state.map.tiles[action.to.y][action.to.x]); // tile → fog
      }
      return checkWinConditions(state, registry);
    }
    // burrowed enemy OR burrowed mover → fall through to a normal move (co-occupy the tile).
  }

  // BUMP (terrain): a blind/burrowed unit moved onto a hidden non-lethal impassable tile
  // (e.g. a mountain). It lands on `to` (the last valid tile) and reveals `bumpReveal` as
  // fog, wasting the move.
  if (action.bumpReveal) {
    unit.position = { ...action.to };
    unit.hasMoved = true;
    const p = unit.owner;
    const { x: bx, y: by } = action.bumpReveal;
    (state.revealedTiles[p] ??= []).push({ x: bx, y: by });
    const mem = state.memory?.[p];
    if (mem) mem.tiles[by][bx] = clone(state.map.tiles[by][bx]); // tile → fog memory (grey)
    return checkWinConditions(state, registry);
  }

  unit.position = { ...action.to };

  // LETHAL TERRAIN: a blind GROUND unit that walked onto a HIDDEN void tile (water/lava/
  // acid/chasm) falls in and dies. Reveal the tile (so the player learns the danger — it
  // becomes "known" and is blocked next time). FLYING units hover over impassable tiles and
  // are unharmed; non-blind ground units are never offered such a move, and burrowed units
  // pass under rather than stop — so only a blind ground unit dies here.
  const destTerrain = registry.terrainTypes[state.map.tiles[action.to.y]?.[action.to.x]?.terrain ?? ''];
  if (destTerrain && !destTerrain.passable && !isAir(registry.unitTypes[unit.typeId])) {
    unit.hasMoved = true;
    const p = unit.owner;
    (state.revealedTiles[p] ??= []).push({ x: action.to.x, y: action.to.y });
    const mem = state.memory?.[p];
    if (mem) mem.tiles[action.to.y][action.to.x] = clone(state.map.tiles[action.to.y][action.to.x]);
    unit.hp = 0;
    sweepDead(state, registry);
    return checkWinConditions(state, registry);
  }

  // A move after attacking is a one-shot "Dash" (consume it); a normal pre-attack
  // move spends the unit's movement for the turn.
  if (unit.hasAttacked) unit.dashRemaining = 0;
  else unit.hasMoved = true;

  // No instant capture: a unit standing on an enemy/neutral city captures it on a
  // LATER turn via the explicit captureCity action (see applyCaptureCity). Lone
  // resources aren't captured either — ownership comes from a city's territory.

  return checkWinConditions(state, registry);
}

/** A unit that can't attack once it has moved (and can't move once it has attacked):
 *  the `noMoveAndAttack` trait, the `repositioning` passive (Tank), or `twin_strike`
 *  (Wyrm — it strikes only if it stayed put). */
function mustStayToAttack(unitType: { traits: string[]; conditions?: string[] }): boolean {
  return unitType.traits.includes('noMoveAndAttack')
    || (unitType.conditions?.includes('repositioning') ?? false)
    || (unitType.conditions?.includes('twin_strike') ?? false);
}

/** Post-attack move range granted by a "dash_N" condition (0 if none). */
function dashRange(unitType: { conditions?: string[] }): number {
  // Take the MAX dash level, so a granted dash_2 (Adrenal Glands) upgrades a base dash_1.
  let best = 0;
  for (const c of unitType.conditions ?? []) {
    const m = /^dash_(\d+)$/.exec(c);
    if (m) best = Math.max(best, parseInt(m[1], 10));
  }
  return best;
}

/**
 * The unit type as it applies to `unit`'s owner RIGHT NOW — base conditions plus any
 * conditions granted by the owner's researched techs (grantCondition effects). Combat,
 * movement, and range all read `.conditions`, so passing this augmented type makes granted
 * passives (e.g. Reaper's Adrenal Glands, Stalker's Precision Targeting) take effect.
 */
function effectiveUnitType(state: GameState, unit: Unit, registry: DataRegistry): UnitType {
  const base = registry.unitTypes[unit.typeId];
  if (!base) return base;
  const player = state.players[unit.owner];
  const granted = player ? grantedConditions(player, unit.typeId, registry) : [];
  if (granted.length === 0) return base;
  return { ...base, conditions: [...(base.conditions ?? []), ...granted] };
}

// Does the "Combined Arms" passive apply to this attacker? It's granted by the Advanced
// Weaponry tech (which also unlocks the Bulwark) and affects LIGHT units only.
function combinedArmsApplies(state: GameState, attacker: Unit, attackerType: UnitType): boolean {
  return attackerType.unitClass === 'light'
    && (state.players[attacker.owner]?.researchedTechs.includes('advanced_weaponry') ?? false);
}

// The Combined Arms attack multiplier for THIS hit (read-only): ×1.2 on the 2nd+ hit on the
// same target this turn, else ×1. Flat — never compounds. Used by both applyAttack and the
// preview so the combat log matches the damage actually dealt.
function combinedArmsMult(state: GameState, attacker: Unit, attackerType: UnitType, defender: Unit): number {
  if (!combinedArmsApplies(state, attacker, attackerType)) return 1;
  return (state.combinedArmsHits[defender.id] ?? 0) >= 1 ? 1.2 : 1;
}

// Preview a would-be attack WITHOUT mutating state — same result the apply will produce
// (Combined Arms multiplier included), for the combat log / damage popups. Kinetic-Shield
// absorption is NOT modelled here (it's resolved at apply time).
export function previewAttack(state: GameState, attackerId: number, targetId: number, registry: DataRegistry): CombatResult | null {
  const attacker = state.units.find(u => u.id === attackerId);
  const defender = state.units.find(u => u.id === targetId);
  if (!attacker || !defender) return null;
  const at = effectiveUnitType(state, attacker, registry); // include tech-granted conditions
  const dt = effectiveUnitType(state, defender, registry);
  if (!at || !dt) return null;
  const mult = combinedArmsMult(state, attacker, at, defender);
  return resolveCombat(attacker, at, defender, dt, state.map, registry, state.config.combatConfig, { seed: 0, state: 0 }, mult);
}

function applyAttack(state: GameState, action: AttackAction, registry: DataRegistry): GameState {
  const attacker = state.units.find(u => u.id === action.unitId);
  const defender = state.units.find(u => u.id === action.targetId);
  if (!attacker || !defender) return state;
  cancelNodeForActingUnit(state, attacker); // attacking abandons any node this engineer was building

  // Effective types include tech-granted conditions (e.g. Stalker's Mountain Shooter II).
  const attackerType = effectiveUnitType(state, attacker, registry);
  const defenderType = effectiveUnitType(state, defender, registry);
  if (!attackerType || !defenderType) return state;
  // Melee (range-1) weapons can't hit AIR units. Defensive guard (also gated in getLegalActions).
  if (attackerType.attackRange <= 1 && isAir(defenderType)) return state;

  // "Combined Arms" (tech): a LIGHT unit's 2nd+ attack on the SAME enemy this turn gets
  // ×1.2 (a FLAT bonus — it does NOT compound: the 3rd, 4th… hit are also ×1.2, not ×1.44).
  // The multiplier is read here; the per-target hit counter is incremented for the NEXT hit.
  const attackMult = combinedArmsMult(state, attacker, attackerType, defender);
  if (combinedArmsApplies(state, attacker, attackerType)) {
    state.combinedArmsHits[defender.id] = (state.combinedArmsHits[defender.id] ?? 0) + 1;
  }

  const result = resolveCombat(
    attacker, attackerType, defender, defenderType,
    state.map, registry, state.config.combatConfig, state.prng, attackMult,
  );
  state.prng = result.prng;

  // Apply damage — Kinetic Shield (Sentinel) absorbs 100% of one hit, then is spent.
  let attackerDamage = result.attackerDamage;
  let defenderKilled = result.defenderKilled;
  if (attackerDamage > 0 && tryAbsorbShield(defender)) { attackerDamage = 0; defenderKilled = false; }
  defender.hp -= attackerDamage;

  let retaliation = result.defenderRetaliation;
  let attackerKilled = result.attackerKilled;
  if (retaliation > 0 && tryAbsorbShield(attacker)) { retaliation = 0; attackerKilled = false; }
  attacker.hp -= retaliation;

  // Remove killed units, then resolve any infected-death scuttling spawns (which
  // may fill the vacated tiles) BEFORE the melee advance checks occupancy.
  const dead: Unit[] = [];
  if (defenderKilled) dead.push(defender);
  if (attackerKilled) dead.push(attacker);
  if (dead.length > 0) {
    const deadIds = new Set(dead.map(d => d.id));
    state.units = state.units.filter(u => !deadIds.has(u.id));
    resolveDeaths(state, dead, registry);
  }

  // Mark attacker as having attacked.
  if (!attackerKilled) {
    attacker.hasAttacked = true;
    // Default: a unit can't move after attacking. The "Dash N" condition is the
    // exception — it grants a post-attack move of up to N tiles (see applyMove).
    const dashN = dashRange(attackerType);
    if (dashN > 0) attacker.dashRemaining = dashN;
    else attacker.hasMoved = true;

    if (mustStayToAttack(attackerType)) attacker.hasMoved = true;
    // Melee units advance into the tile of a unit they kill (Polytopia-style) —
    // unless it's now occupied (e.g. an infected victim spawned a scuttling there).
    if (defenderKilled && attackerType.attackRange === 1) {
      const blocked = state.units.some(u => u.position.x === defender.position.x && u.position.y === defender.position.y);
      if (!blocked) {
        attacker.position = { ...defender.position };
        if (dashN <= 0) attacker.hasMoved = true; // dash units keep their dash after advancing
      }
    }

    // "Corrosive" (passive ability): the attacker's hit leaves the corrosive_1
    // condition on a surviving defender (−20% defence). Doesn't stack.
    if (attackerType.conditions?.includes('corrosive') && !defenderKilled) {
      defender.statuses ??= [];
      if (!defender.statuses.includes('corrosive_1')) defender.statuses.push('corrosive_1');
    }
  }

  return checkWinConditions(state, registry);
}

/** Kinetic Shield: if the unit is shielded, consume it and report the hit absorbed. */
function tryAbsorbShield(unit: Unit): boolean {
  if (unit.statuses?.includes('shielded')) {
    unit.statuses = unit.statuses.filter(s => s !== 'shielded');
    return true;
  }
  return false;
}

/** Remove hp≤0 units (with infected-death scuttling spawns + home-city cleanup). */
function sweepDead(state: GameState, registry: DataRegistry): void {
  const dead = state.units.filter(u => u.hp <= 0);
  if (!dead.length) return;
  const ids = new Set(dead.map(d => d.id));
  for (const id of ids) delete state.unitHomeCity[id];
  state.units = state.units.filter(u => !ids.has(u.id));
  resolveDeaths(state, dead, registry);
}

const BURSTLING_BURST_ATTACK = 2;
const AFTERSHOCK_ATTACK = 3;

/** Damage a synthetic FULL-STRENGTH attack of `attackStat` deals to `target` — resolved
 *  through the target's defence and terrain/city/fortify cover (the Polytopia force
 *  formula), with NO retaliation. This is an "attack" (scales off atk-vs-def), not flat
 *  HP loss. Used by the area attacks (Aftershock, Burstling burst). */
function areaAttackDamage(state: GameState, target: Unit, attackStat: number, registry: DataRegistry): number {
  const tt = effectiveUnitType(state, target, registry);
  if (!tt) return 0;
  const tile = state.map.tiles[target.position.y][target.position.x];
  const terrain = registry.terrainTypes[tile.terrain];
  const defBonus = getDefenseMultiplier(tile, terrain, tt);
  // Full-strength attacker (hp/maxHP = 1/1) so the shock's force is the flat attackStat.
  const { damage } = calculateDamage(attackStat, 1, 1, tt.defence, target.hp, tt.maxHP, defBonus, state.config.combatConfig.minimumDamage);
  return damage;
}

/** Aftershock (Wyrm upgrade): when the Wyrm erupts, every OTHER unit (friend or foe) in
 *  its 3×3 takes a 3-ATTACK hit. The erupting Wyrm itself is unharmed. */
function applyAftershock(state: GameState, center: Coord, eruptingId: number, registry: DataRegistry): void {
  for (const u of state.units) {
    if (u.id === eruptingId) continue;
    if (Math.max(Math.abs(u.position.x - center.x), Math.abs(u.position.y - center.y)) > 1) continue;
    if (tryAbsorbShield(u)) continue;
    u.hp -= areaAttackDamage(state, u, AFTERSHOCK_ATTACK, registry);
  }
  sweepDead(state, registry);
}

/** True for AIR units (Ravener, Sentinel) — they fly over terrain and can't be hit by melee. */
function isAir(ut: { unitClass?: string; traits?: string[] } | undefined): boolean {
  return ut?.unitClass === 'air' || (ut?.traits?.includes('flying') ?? false);
}

/** A Burstling's death burst: a 2-ATTACK hit on EVERY unit (friend or foe) in its 3×3. */
function applyBurstlingBurst(state: GameState, center: Coord, registry: DataRegistry): void {
  for (const u of state.units) {
    if (Math.max(Math.abs(u.position.x - center.x), Math.abs(u.position.y - center.y)) > 1) continue;
    if (tryAbsorbShield(u)) continue;
    u.hp -= areaAttackDamage(state, u, BURSTLING_BURST_ATTACK, registry);
  }
}

/**
 * Death hooks for units that have ALREADY been removed from state.units: infected→scuttling
 * spawns, and Burstling death bursts (which can chain-kill more units, incl. other
 * Burstlings — handled by re-sweeping and recursing until nothing new dies).
 */
function resolveDeaths(state: GameState, dead: Unit[], registry: DataRegistry): void {
  // A builder killed mid-construction cancels its (half-built) node.
  for (const d of dead) if (d.buildingNodeId !== undefined) removeNode(state, d.buildingNodeId);
  for (const d of dead) spawnScuttlingsFromInfected(state, d, registry);
  const bursters = dead.filter(d => registry.unitTypes[d.typeId]?.conditions?.includes('death_burst'));
  if (!bursters.length) return;
  for (const b of bursters) applyBurstlingBurst(state, b.position, registry);
  const newly = state.units.filter(u => u.hp <= 0);
  if (!newly.length) return;
  const ids = new Set(newly.map(u => u.id));
  for (const id of ids) delete state.unitHomeCity[id];
  state.units = state.units.filter(u => !ids.has(u.id));
  resolveDeaths(state, newly, registry);
}

const NEIGHBORS8: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// Titan "Percussive Shells": impact any tile — a LIGHT unit there takes a normal Titan
// hit; every LIGHT unit in the 8 surrounding tiles is pushed radially outward (see push.ts).
function applyPercussiveShells(state: GameState, titan: Unit, titanType: UnitType, impact: Coord, registry: DataRegistry): void {
  const center = state.units.find(u => u.position.x === impact.x && u.position.y === impact.y);
  if (center && registry.unitTypes[center.typeId]?.unitClass === 'light') {
    const ct = registry.unitTypes[center.typeId]!;
    const result = resolveCombat(titan, titanType, center, ct, state.map, registry, state.config.combatConfig, state.prng);
    if (!(result.attackerDamage > 0 && tryAbsorbShield(center))) center.hp -= result.attackerDamage;
  }
  // Snapshot the neighbours first (a push moves them 2 tiles out, but be safe).
  const toPush: { u: Unit; dx: number; dy: number }[] = [];
  for (const [dx, dy] of NEIGHBORS8) {
    const u = state.units.find(un => un.position.x === impact.x + dx && un.position.y === impact.y + dy);
    if (u) toPush.push({ u, dx, dy });
  }
  for (const { u, dx, dy } of toPush) resolvePush(state, u, dx, dy, registry);
  sweepDead(state, registry);
}

// Every valid 2×2 square (as its 4 tiles, top-left first) whose tiles all lie in the
// range band [min..max] (Chebyshev) from `from` and inside the map. Used by both the
// legal-action enumeration and the click-picker eligibility (see enumerateVolleyGrids
// export). A grid is a strict square — no snakes/lines — by construction.
export function enumerateVolleyGrids(from: Coord, width: number, height: number, min: number, max: number): Coord[][] {
  const cheb = (x: number, y: number) => Math.max(Math.abs(x - from.x), Math.abs(y - from.y));
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && cheb(x, y) >= min && cheb(x, y) <= max;
  const grids: Coord[][] = [];
  for (let ay = 0; ay <= height - 2; ay++) {
    for (let ax = 0; ax <= width - 2; ax++) {
      const t = [{ x: ax, y: ay }, { x: ax + 1, y: ay }, { x: ax, y: ay + 1 }, { x: ax + 1, y: ay + 1 }];
      if (t.every(c => ok(c.x, c.y))) grids.push(t);
    }
  }
  return grids;
}

// True iff `tiles` is exactly one of the legal 2×2 grids from `from` (4 distinct tiles
// forming a square, all in the range band). Defensive validation for applyAction.
function volleyGridLegal(from: Coord, tiles: Coord[], width: number, height: number, min: number, max: number): boolean {
  if (!tiles || tiles.length !== 4) return false;
  return enumerateVolleyGrids(from, width, height, min, max).some(g =>
    g.every(c => tiles.some(t => t.x === c.x && t.y === c.y)));
}

// Titan "Ballistic Volley": a flat area bombardment. Every unit standing on one of the
// 4 grid tiles — friend or foe — takes `amount` damage (default 2), no retaliation. A
// Kinetic-Shielded unit consumes its shield to negate the hit (as with Percussive Shells).
function applyBallisticVolley(state: GameState, ability: AbilityDef, tiles: Coord[], registry: DataRegistry): void {
  // The `damage` effect amount is the ATTACK stat of each impact (default 2) — resolved
  // through the target's defence/cover (a 2-ATTACK hit), not flat HP loss.
  const dmgEffect = ability.effects.find(e => e.type === 'damage');
  const atk = typeof dmgEffect?.params.amount === 'number' ? dmgEffect.params.amount : 2;
  for (const t of tiles) {
    const victim = state.units.find(u => u.position.x === t.x && u.position.y === t.y);
    if (!victim) continue;
    if (atk > 0 && tryAbsorbShield(victim)) continue;
    victim.hp -= areaAttackDamage(state, victim, atk, registry);
  }
  sweepDead(state, registry);
}

// Slash (Vindrace): an AoE swing at a 3-tile arc. `action.target` is the central
// tile; the two side tiles are derived. Central takes 100% damage, sides 50%.
// Hits ALL units in the arc — friendly units included (friendly fire) — and provokes
// NO retaliation (see docs/conditions.md).
function applySlash(state: GameState, action: SlashAction, registry: DataRegistry): GameState {
  const attacker = state.units.find(u => u.id === action.unitId);
  if (!attacker) return state;
  cancelNodeForActingUnit(state, attacker);
  const attackerType = registry.unitTypes[attacker.typeId];
  if (!attackerType) return state;

  const arc = getSlashArc(attacker.position, action.target);
  const killed = new Set<number>();

  for (const { coord, isCenter } of arc) {
    const victim = state.units.find(u =>
      u.id !== attacker.id && u.position.x === coord.x && u.position.y === coord.y);
    if (!victim) continue;
    const victimType = registry.unitTypes[victim.typeId];
    if (!victimType) continue;
    if (isAir(victimType)) continue; // Slash is melee — air units are immune

    // Reuse the normal force-ratio formula per target (so each victim's own
    // defence/terrain/corrosion count), then take damage only — no retaliation.
    const result = resolveCombat(
      attacker, attackerType, victim, victimType,
      state.map, registry, state.config.combatConfig, state.prng,
    );
    const dmg = slashHitDamage(result.attackerDamage, isCenter, state.config.combatConfig.minimumDamage);
    victim.hp -= dmg;
    if (victim.hp <= 0) killed.add(victim.id);
  }

  if (killed.size > 0) {
    const dead = state.units.filter(u => killed.has(u.id));
    state.units = state.units.filter(u => !killed.has(u.id));
    resolveDeaths(state, dead, registry);
  }

  // Slashing spends the turn; the Vindrace stays put (an AoE swing, no advance)
  // and has no Dash, so it can't move afterwards.
  attacker.hasAttacked = true;
  attacker.hasMoved = true;

  return checkWinConditions(state, registry);
}

// ── Wyrm strike (twin_strike) ───────────────────────────────────────────────
const STRIKE_DIRS: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// Every legal (primary, secondary) pair for a Wyrm at `from`: primary within the 3×3
// (Chebyshev 1, never the Wyrm's own tile), secondary adjacent to the primary
// (Chebyshev 1), distinct, never the Wyrm's own tile, both in bounds.
export function wyrmStrikePairs(from: Coord, width: number, height: number): [Coord, Coord][] {
  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const pairs: [Coord, Coord][] = [];
  for (const [dx, dy] of STRIKE_DIRS) {
    const p = { x: from.x + dx, y: from.y + dy };
    if (!inB(p.x, p.y)) continue;
    for (const [ex, ey] of STRIKE_DIRS) {
      const q = { x: p.x + ex, y: p.y + ey };
      if (!inB(q.x, q.y)) continue;
      if (q.x === from.x && q.y === from.y) continue; // secondary can't be the Wyrm's tile
      pairs.push([{ ...p }, q]);
    }
  }
  return pairs;
}

function wyrmStrikeLegal(from: Coord, tiles: Coord[], width: number, height: number): boolean {
  if (!tiles || tiles.length !== 2) return false;
  const [p, q] = tiles;
  const cheb = (a: Coord, b: Coord) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return false;
  if (q.x < 0 || q.y < 0 || q.x >= width || q.y >= height) return false;
  if (cheb(p, from) !== 1) return false;              // primary within the 3×3 (not the centre)
  if (cheb(p, q) !== 1) return false;                 // secondary touches the primary
  if (q.x === from.x && q.y === from.y) return false; // secondary ≠ the Wyrm's tile
  return true;
}

// The Wyrm strikes two touching cells — primary 100% damage, secondary 50%, no
// retaliation (an overhead sweep). It targets TILES, so it can strike into fog/cloud:
// each struck tile is revealed for THIS turn (unit + damage shown) and its terrain is
// written to fog memory (cloud → fog permanently); a surviving hidden unit reverts to
// hidden when the turn ends (revealedTiles is cleared in applyEndTurn).
function applyWyrmStrike(state: GameState, action: WyrmStrikeAction, registry: DataRegistry): GameState {
  const attacker = state.units.find(u => u.id === action.unitId);
  if (!attacker) return state;
  const attackerType = registry.unitTypes[attacker.typeId];
  if (!attackerType || !attackerType.conditions?.includes('twin_strike')) return state;
  if (attacker.hasAttacked || attacker.hasMoved) return state; // strike only if it stayed put
  if (!wyrmStrikeLegal(attacker.position, action.tiles, state.map.width, state.map.height)) return state;

  const cells = [
    { coord: action.tiles[0], primary: true },
    { coord: action.tiles[1], primary: false },
  ];
  const killed = new Set<number>();
  const p = attacker.owner;
  for (const { coord, primary } of cells) {
    const victim = state.units.find(u =>
      u.id !== attacker.id && u.position.x === coord.x && u.position.y === coord.y);
    if (victim) {
      const vt = registry.unitTypes[victim.typeId];
      if (vt && !isAir(vt)) { // Wyrm strike is melee — air units are immune (tile still revealed)
        const result = resolveCombat(attacker, attackerType, victim, vt, state.map, registry, state.config.combatConfig, state.prng);
        const dmg = slashHitDamage(result.attackerDamage, primary, state.config.combatConfig.minimumDamage);
        victim.hp -= dmg;
        if (victim.hp <= 0) killed.add(victim.id);
      }
    }
    // Temporary reveal (this turn) + permanent terrain-to-fog for the struck tile.
    (state.revealedTiles[p] ??= []).push({ x: coord.x, y: coord.y });
    const mem = state.memory?.[p];
    if (mem && state.map.tiles[coord.y]?.[coord.x]) mem.tiles[coord.y][coord.x] = clone(state.map.tiles[coord.y][coord.x]);
  }

  if (killed.size > 0) {
    const dead = state.units.filter(u => killed.has(u.id));
    for (const d of dead) delete state.unitHomeCity[d.id];
    state.units = state.units.filter(u => !killed.has(u.id));
    for (const d of dead) spawnScuttlingsFromInfected(state, d, registry);
  }

  attacker.hasAttacked = true;
  attacker.hasMoved = true; // no advance after striking
  return checkWinConditions(state, registry);
}

// Seercaust active abilities. Casting spends the unit's turn and starts a cooldown.
function applyUseAbility(state: GameState, action: UseAbilityAction, registry: DataRegistry): GameState {
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit) return state;
  const unitType = registry.unitTypes[unit.typeId];
  const ability = unitType?.abilities.find(a => a.id === action.abilityId);
  if (!unitType || !ability) return state;
  // Burrow/Erupt are illegal on city, mountain, or building tiles.
  if ((action.abilityId === 'burrow' || action.abilityId === 'erupt') && !canBurrowEruptAt(state, unit.position, registry)) return state;

  // Build Node (Engineer): place a node under construction on a valid tile within range 1.
  if (action.abilityId === 'build_node') {
    const player = state.players[unit.owner];
    if (!player || player.ore < NODE_BUILD_COST) return state;
    if (Math.max(Math.abs(action.target.x - unit.position.x), Math.abs(action.target.y - unit.position.y)) > (ability.range ?? 1)) return state;
    if (!canPlaceNode(state, unit.owner, action.target)) return state;
    cancelNodeForActingUnit(state, unit); // an engineer already mid-build swaps to the new site
    player.ore -= NODE_BUILD_COST;
    const node: NodeState = { id: state.nextNodeId++, owner: unit.owner, position: { ...action.target }, building: true, buildTurnsLeft: NODE_BUILD_TURNS, builderUnitId: unit.id };
    state.nodes.push(node);
    unit.buildingNodeId = node.id;
    unit.hasAttacked = true;
    unit.hasMoved = true;
    return checkWinConditions(state, registry);
  }

  // Any OTHER action by an engineer mid-build cancels its in-progress node first.
  cancelNodeForActingUnit(state, unit);

  // Tunneling Network (tech-granted): the Wyrm burrows for FREE — it keeps its move/attack,
  // so it can burrow then move underground the same turn. Checked before the morph, while
  // the unit is still a `wyrm` (the tech grants the condition to the wyrm type).
  const freeBurrow = action.abilityId === 'burrow'
    && (effectiveUnitType(state, unit, registry)?.conditions?.includes('tunneling_network') ?? false);

  // Self Destruct (Burstling): remove itself, then trigger its death_burst (1 dmg to the
  // 3×3) — same effect as being killed. Returns early (the unit is gone).
  if (action.abilityId === 'self_destruct') {
    const corpse = { ...unit, position: { ...unit.position } };
    state.units = state.units.filter(u => u.id !== unit.id);
    delete state.unitHomeCity[unit.id];
    resolveDeaths(state, [corpse], registry);
    return checkWinConditions(state, registry);
  }

  if (action.abilityId === 'infect') {
    // Infect a LIGHT unit (any owner). It gains the "infected" condition; when it
    // dies it spawns 2 scuttlings for the caster (see spawnScuttlingsFromInfected).
    const target = state.units.find(u => u.position.x === action.target.x && u.position.y === action.target.y);
    const targetType = target && registry.unitTypes[target.typeId];
    if (target && target.id !== unit.id && targetType?.unitClass === 'light') {
      target.statuses ??= [];
      if (!target.statuses.includes('infected')) target.statuses.push('infected');
      target.infectedBy = unit.owner;
    }
  } else if (action.abilityId === 'spray_bile') {
    // Mark the target tile as "infected" (bile) for `duration` rounds.
    const tile = state.map.tiles[action.target.y]?.[action.target.x];
    if (tile) tile.bile = { owner: unit.owner, expiresTurn: state.turn + (ability.duration ?? 5) };
  } else if (action.abilityId === 'kinetic_shield') {
    // Sentinel: shield a friendly unit — absorbs 100% of the next hit, then gone.
    const target = state.units.find(u => u.owner === unit.owner && u.position.x === action.target.x && u.position.y === action.target.y);
    if (target) { target.statuses ??= []; if (!target.statuses.includes('shielded')) target.statuses.push('shielded'); }
  } else if (ability.targetKind === 'units') {
    // Multi-unit cast on up to `maxTargets` DISTINCT eligible friendly units in range:
    //  • Heal (Medic) / Repair (Engineer) — restore HP (the `heal` effect amount).
    //  • Cure (Medic, no heal effect) — strip every affliction (all non-positive statuses).
    const eligible = new Set(getAbilityUnitTargets(state, unit.id, action.abilityId, registry).map(c => `${c.x},${c.y}`));
    const healEffect = ability.effects.find(e => e.type === 'heal');
    const amount = typeof healEffect?.params.amount === 'number' ? healEffect.params.amount : 0;
    const max = ability.maxTargets ?? 1;
    const seen = new Set<string>();
    let applied = 0;
    for (const p of action.targets ?? [action.target]) {
      const key = `${p.x},${p.y}`;
      if (applied >= max || seen.has(key) || !eligible.has(key)) continue;
      seen.add(key);
      const target = state.units.find(u => u.position.x === p.x && u.position.y === p.y);
      const tt = target && registry.unitTypes[target.typeId];
      if (!target || !tt) continue;
      if (healEffect) {
        target.hp = Math.min(tt.maxHP, target.hp + amount);
      } else {
        // Cure: remove all afflictions (keep positive statuses like "shielded").
        const kept = (target.statuses ?? []).filter(s => POSITIVE_STATUSES.has(s));
        const removed = new Set((target.statuses ?? []).filter(s => !POSITIVE_STATUSES.has(s)));
        target.statuses = kept;
        if (removed.has('infected')) delete target.infectedBy;
        if (target.statusExpiry) for (const s of removed) delete target.statusExpiry[s];
      }
      applied++;
    }
  } else if (action.abilityId === 'slow') {
    // Medic (Advanced Biomed): cap an enemy's movement at 1 for `duration` rounds.
    const target = state.units.find(u => u.owner !== unit.owner && u.position.x === action.target.x && u.position.y === action.target.y);
    if (target) {
      target.statuses ??= [];
      if (!target.statuses.includes('slowed')) target.statuses.push('slowed');
      (target.statusExpiry ??= {})['slowed'] = state.turn + (ability.duration ?? 3);
    }
  } else if (action.abilityId === 'percussive_shells') {
    applyPercussiveShells(state, unit, unitType, action.target, registry);
  } else if (ability.targetKind === 'grid2x2') {
    // Ballistic Volley: validate the 2×2 (shape + range band) then bombard it.
    const tiles = action.tiles ?? [];
    if (volleyGridLegal(unit.position, tiles, state.map.width, state.map.height, ability.minRange ?? 0, ability.range ?? 0)) {
      applyBallisticVolley(state, ability, tiles, registry);
    }
  } else if (action.abilityId === 'ram') {
    // Vindrace: shove an adjacent enemy light unit one tile away.
    const target = state.units.find(u => u.owner !== unit.owner && u.position.x === action.target.x && u.position.y === action.target.y);
    if (target) {
      const d = pushDir(unit.position, target.position);
      resolvePush(state, target, d.dx, d.dy, registry);
      sweepDead(state, registry);
    }
  } else if (action.abilityId === 'stun') {
    // Stun (Wraith): applies "stunned" to an enemy — it can't move/act on its
    // next turn (cleared at the end of the stunned unit's own turn, in applyEndTurn).
    const target = state.units.find(u => u.owner !== unit.owner && u.position.x === action.target.x && u.position.y === action.target.y);
    if (target) {
      target.statuses ??= [];
      if (!target.statuses.includes('stunned')) target.statuses.push('stunned');
    }
  } else if (action.abilityId === 'tracer_round' || action.abilityId === 'plant_explosives') {
    // Plant a Tracer Round (3 turns, reveals) or Plant Explosives (2 turns, detonates 5-atk)
    // on an enemy unit. One mark of each kind per placer.
    const kind = action.abilityId === 'tracer_round' ? 'tracer' : 'explosive';
    const target = state.units.find(u => u.owner !== unit.owner && u.position.x === action.target.x && u.position.y === action.target.y);
    if (target) {
      target.marks ??= [];
      if (!target.marks.some(m => m.kind === kind && m.owner === unit.owner)) {
        target.marks.push({ kind, owner: unit.owner, turnsLeft: ability.duration ?? (kind === 'tracer' ? 3 : 2) });
      }
    }
  } else if (action.abilityId === 'erupt') {
    // Erupt (Wyrm): surface (morph back to `wyrm`) AND kill any enemy unit sharing
    // this tile (the one it burrowed under). May also erupt on an empty tile. Ends
    // the turn (below) — no further move/attack.
    const victims = state.units.filter(u => u.owner !== unit.owner && u.id !== unit.id
      && u.position.x === unit.position.x && u.position.y === unit.position.y);
    if (victims.length > 0) {
      const victimIds = new Set(victims.map(u => u.id));
      for (const id of victimIds) delete state.unitHomeCity[id];
      state.units = state.units.filter(u => !victimIds.has(u.id));
      resolveDeaths(state, victims, registry);
    }
    // Aftershock (tech-granted): checked BEFORE the morph, while the unit is still
    // `wyrm_burrowed` (the tech grants the condition to that form). Every OTHER unit in
    // the 3×3 takes 2 damage.
    const aftershock = effectiveUnitType(state, unit, registry)?.conditions?.includes('aftershock') ?? false;
    const eruptCenter = { ...unit.position };
    const newType = ability.morphTo && registry.unitTypes[ability.morphTo];
    if (ability.morphTo && newType) {
      unit.typeId = ability.morphTo;
      if (unit.hp > newType.maxHP) unit.hp = newType.maxHP;
    }
    if (aftershock) applyAftershock(state, eruptCenter, unit.id, registry);
  } else if (ability.morphTo) {
    // Mode toggle (e.g. Assault Mode): morph into another unit type, keeping id/hp/
    // position. Clamp HP to the new type's max. Toggling spends the turn (below).
    const newType = registry.unitTypes[ability.morphTo];
    if (newType) {
      unit.typeId = ability.morphTo;
      if (unit.hp > newType.maxHP) unit.hp = newType.maxHP;
    }
  }

  // Casting ends the turn and starts the cooldown — UNLESS this is a free (Tunneling
  // Network) burrow, which leaves the Wyrm able to move afterward.
  if (!freeBurrow) {
    unit.hasAttacked = true;
    unit.hasMoved = true;
    if (ability.cooldown) unit.abilityCooldowns[action.abilityId] = ability.cooldown;
  }

  return checkWinConditions(state, registry);
}

// When an "infected" unit dies, spawn 2 scuttlings for its infector: one on the
// tile it died on, one on a random free tile in the surrounding 3×3. Call AFTER the
// dead unit has been removed from state.units (so its tile reads as free).
function spawnScuttlingsFromInfected(state: GameState, dead: Unit, registry: DataRegistry): void {
  if (!dead.statuses?.includes('infected') || dead.infectedBy === undefined) return;
  const scuttling = registry.unitTypes['scuttling'];
  if (!scuttling) return;

  const occupied = (c: Coord) => state.units.some(u => u.position.x === c.x && u.position.y === c.y);
  const spots: Coord[] = [];
  if (!occupied(dead.position)) spots.push({ ...dead.position });

  // Random free tile in the 3×3 around the death tile (deterministic PRNG).
  const candidates: Coord[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const c = { x: dead.position.x + dx, y: dead.position.y + dy };
      if (c.y < 0 || c.y >= state.map.height || c.x < 0 || c.x >= state.map.width) continue;
      if (occupied(c) || spots.some(s => s.x === c.x && s.y === c.y)) continue;
      candidates.push(c);
    }
  }
  if (candidates.length > 0) {
    const [idx, np] = nextInt(state.prng, 0, candidates.length - 1);
    state.prng = np;
    spots.push(candidates[idx]);
  }

  for (const pos of spots) {
    state.units.push({
      id: state.nextUnitId++,
      typeId: 'scuttling',
      owner: dead.infectedBy,
      position: { ...pos },
      hp: scuttling.maxHP,
      hasMoved: true, // freshly spawned — can't act until the owner's next turn
      hasAttacked: true,
      abilityCooldowns: {},
    });
  }
}

function applyRecruit(state: GameState, action: RecruitAction, registry: DataRegistry): GameState {
  const player = state.players[state.currentPlayer];
  const unitType = registry.unitTypes[action.unitTypeId];
  if (!unitType) return state;

  const city = cityAt(state, action.cityPosition);
  if (!city || city.owner !== state.currentPlayer) return state;

  const count = unitType.recruitCount ?? 1;
  const addedPop = (unitType.popCost ?? 1) * count;
  if (!cityHasCapacityFor(state, city, registry, addedPop)) return state;

  // Spawn positions: a single unit appears on the city tile; multi-unit recruits
  // (e.g. a scuttling pair) appear on random empty passable tiles in the territory.
  const spawnTiles: Coord[] = [];
  if (count <= 1) {
    // Single-spawn units appear on the city tile — it must be empty.
    if (state.units.some(u => u.position.x === action.cityPosition.x && u.position.y === action.cityPosition.y)) return state;
    spawnTiles.push({ ...action.cityPosition });
  } else {
    const candidates: Coord[] = [];
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        const pos = { x, y };
        if (pos.x === city.position.x && pos.y === city.position.y) continue; // not the centre
        if (!cityOwnsTile(city, registry, pos)) continue;
        const terrain = registry.terrainTypes[state.map.tiles[y][x].terrain];
        if (!terrain || !terrain.passable) continue;
        if (state.units.some(u => u.position.x === x && u.position.y === y)) continue; // occupied
        candidates.push(pos);
      }
    }
    // Deterministic random pick from the territory candidates.
    let p = state.prng;
    for (let i = 0; i < count && candidates.length > 0; i++) {
      const [idx, np] = nextInt(p, 0, candidates.length - 1);
      p = np;
      spawnTiles.push(candidates.splice(idx, 1)[0]);
    }
    state.prng = p;
    if (spawnTiles.length === 0) return state; // nowhere to place them
  }

  player.ore -= recruitOreCost(unitType.cost, city); // "Conscription" city → 20% cheaper
  player.plasma -= getUnitPlasmaCost(action.unitTypeId, registry);

  // "Muster" city → units may MOVE the turn they're built (but still can't attack).
  const canMove = city.muster ?? false;
  for (const pos of spawnTiles) {
    const id = state.nextUnitId++;
    state.units.push({
      id,
      typeId: action.unitTypeId,
      owner: state.currentPlayer,
      position: { ...pos },
      hp: unitType.maxHP,
      hasMoved: !canMove, // newly recruited units can't act this turn (Muster lets them MOVE)
      hasAttacked: true,
      abilityCooldowns: {},
    });
    state.unitHomeCity[id] = city.id; // counts against this city's pop
  }

  return state;
}

function applyResearch(state: GameState, action: ResearchAction, registry: DataRegistry): GameState {
  const player = state.players[state.currentPlayer];
  if (player.researchedTechs.includes(action.techId)) return state; // already researched

  // Techs defined in the engine registry charge their ore cost (and later apply
  // effects). UI-only techs (not yet in tech-tree.json) are still recorded so the
  // selection persists/saves — their functionality is implemented separately.
  const tech = registry.techs[action.techId];
  if (tech) {
    // Registry tech: must be available AND affordable — never let ore go negative.
    if (!isTechAvailable(state, state.currentPlayer, tech, registry)) return state;
    const cost = techCostForPlayer(state, state.currentPlayer, tech, registry);
    if (player.ore < cost) return state; // can't afford → no-op
    player.ore -= cost;
  }
  // UI-only techs (not yet in tech-tree.json) fall through and are still recorded
  // so the selection persists/saves — their functionality is implemented separately.
  player.researchedTechs.push(action.techId);
  return state;
}

function applyBuild(state: GameState, action: BuildAction, registry: DataRegistry): GameState {
  const playerId = state.currentPlayer;
  if (!canBuild(state, registry, playerId, action.kind, action.position)) return state;

  const def = registry.economy.buildings[action.kind];
  const city = territoryCityAt(state, registry, action.position);
  const cost = buildingCost(def, 1);
  state.players[playerId].ore -= cost.ore;
  state.players[playerId].plasma -= cost.plasma;
  state.buildings.push({
    id: state.nextBuildingId++,
    kind: action.kind,
    position: { ...action.position },
    level: 1,
    cityId: city ? city.id : null,
  });

  recomputeCities(state, registry); // supply/level may have changed
  return checkWinConditions(state, registry);
}

function applyUpgradeBuilding(state: GameState, action: UpgradeBuildingAction, registry: DataRegistry): GameState {
  const playerId = state.currentPlayer;
  if (!canUpgradeBuilding(state, registry, playerId, action.position)) return state;

  const building = state.buildings.find(
    b => b.position.x === action.position.x && b.position.y === action.position.y,
  );
  if (!building) return state;
  const cost = upgradeCostFor(building, registry);
  if (cost === null) return state;

  state.players[playerId].ore -= cost.ore;
  state.players[playerId].plasma -= cost.plasma;
  building.level += 1;

  recomputeCities(state, registry);
  return checkWinConditions(state, registry);
}

function applyFoundCity(state: GameState, action: FoundCityAction, registry: DataRegistry): GameState {
  const playerId = state.currentPlayer;
  if (!canFoundCity(state, registry, playerId, action.position)) return state;

  const { x, y } = action.position;
  const tile = state.map.tiles[y][x];
  tile.isCity = true;
  tile.isRuin = false;
  tile.owner = playerId;

  // Claim the full 3x3 territory (ownership only — keep the ruin's terrain and
  // resources), so a founded city has a real territory like a capital.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = state.map.tiles[y + dy]?.[x + dx];
      if (!t || t.isCity) continue;
      t.owner = playerId;
    }
  }

  const newCityId = state.nextCityId++;
  // Colonial Charter (Refinement tech): newly founded cities start at level 2.
  const startLevel = state.players[playerId].researchedTechs.includes('colonial_charter') ? 2 : 1;
  state.cities.push({
    id: newCityId,
    position: { x, y },
    owner: playerId,
    isCapital: false,
    level: startLevel,
    supply: 0,
    incomeBonus: 0,
    popBonus: 0,
    bonusSupply: 0,
    fortified: false,
    extraTerritory: [],
  });
  state.players[playerId].ore -= registry.economy.foundCity.cost;

  // The founder. Normally it re-homes to the new city (its pop transfers here);
  // but a unit with the "Sacrificial Founder" condition DIES founding it instead.
  const founder = state.units.find(u => u.owner === playerId && u.position.x === x && u.position.y === y);
  if (founder) {
    const ft = registry.unitTypes[founder.typeId];
    if (ft?.conditions?.includes('sacrificial_founder')) {
      state.units = state.units.filter(u => u.id !== founder.id); // consumed by the founding
      delete state.unitHomeCity[founder.id];
    } else {
      // Founding fully spends the turn — no move AND no attack afterwards (mirrors
      // capture, which sets both). Previously only hasMoved was set, which let a
      // founder still attack after founding a city.
      founder.hasMoved = true;
      founder.hasAttacked = true;
      state.unitHomeCity[founder.id] = newCityId;
    }
  }

  recomputeCities(state, registry);
  return checkWinConditions(state, registry);
}

function applyCaptureCity(state: GameState, action: CaptureCityAction, registry: DataRegistry): GameState {
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || unit.owner !== state.currentPlayer) return state;
  if (unit.hasMoved) return state; // can't capture the same turn you moved onto it
  const city = cityAt(state, unit.position);
  if (!city || city.owner === unit.owner) return state; // must be an enemy/neutral city

  // The previous owner's units homed here become stateless (home link cleared).
  for (const u of state.units) {
    if (state.unitHomeCity[u.id] === city.id) delete state.unitHomeCity[u.id];
  }
  // Transfer the city and its 3x3 territory. Buildings keep their cityId, so
  // their output now follows the new owner automatically — everything transfers.
  city.owner = state.currentPlayer;
  const { x, y } = city.position;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = state.map.tiles[y + dy]?.[x + dx];
      if (t) t.owner = state.currentPlayer;
    }
  }
  // Expanded territory transfers with the city too (it stays on city.extraTerritory).
  for (const et of city.extraTerritory ?? []) {
    const t = state.map.tiles[et.y]?.[et.x];
    if (t) t.owner = state.currentPlayer;
  }
  unit.hasMoved = true;
  unit.hasAttacked = true; // capturing spends the unit's turn

  // The capturing unit re-homes to the captured city: its pop slot transfers off
  // its old home city onto the one it just took. (Set after the clear loop above so
  // it isn't wiped — the capturer was homed elsewhere, not at this city.)
  state.unitHomeCity[unit.id] = city.id;

  recomputeCities(state, registry);
  return checkWinConditions(state, registry);
}

function applyLevelUpCity(state: GameState, action: LevelUpCityAction, registry: DataRegistry): GameState {
  const city = cityById(state, action.cityId);
  if (!city || city.owner !== state.currentPlayer) return state;
  if (!cityCanLevelUp(city, registry)) return state;

  const targetLevel = city.level + 1;
  const choices = levelUpChoices(targetLevel);
  if (!choices || (action.choice !== choices.a && action.choice !== choices.b)) return state;
  if (!isChoiceAvailable(action.choice)) return state; // Hero is greyed out (not pickable yet)

  // 'territory' is granted via the expandTerritory action (it carries the tiles).
  if (action.choice === 'territory') return state;

  city.level = targetLevel;
  switch (action.choice) {
    case 'income': city.incomeBonus += 20; break;   // perpetual +20 ore/turn (capture-invariant)
    case 'pop': city.popBonus += 1; break;          // +1 unit capacity, stacks on the per-level pop
    case 'fortify': {                               // combat applies the city-walls +50% defence
      city.fortified = true;
      const ct = state.map.tiles[city.position.y]?.[city.position.x];
      if (ct) ct.fortified = true;                  // mirror onto the tile so combat (tile-based) reads it
      break;
    }
    case 'beacon': city.beacon = true; break;       // city sight radius +1 (see the 5×5 around it)
    case 'supply': city.bonusSupply += 3; break;    // permanent supply toward further leveling
    case 'muster': city.muster = true; break;       // units recruited here may MOVE (not attack) when built
    case 'detect': city.detect = true; break;       // exposes cloaked/burrowed enemies in its 3×3
    case 'conscription': city.conscription = true; break; // units recruited here cost 20% less ore
    case 'plasma': city.plasmaBonus = (city.plasmaBonus ?? 0) + 10; break; // +10 plasma/turn
    default: break;
  }

  recomputeCities(state, registry); // fold bonusSupply (if any) back into city.supply
  return checkWinConditions(state, registry);
}

function applyExpandTerritory(state: GameState, action: ExpandTerritoryAction, registry: DataRegistry): GameState {
  const city = cityById(state, action.cityId);
  if (!city || city.owner !== state.currentPlayer) return state;
  // This reward IS the L4 level-up: the city must be ready to reach level 4.
  if (city.level + 1 !== 4 || !cityCanLevelUp(city, registry)) return state;
  if (action.tiles.length !== 3) return state;
  if (!validateExpansion(state, registry, city, action.tiles)) return state;

  city.level = 4;
  for (const t of action.tiles) {
    city.extraTerritory.push({ x: t.x, y: t.y });
    const tile = state.map.tiles[t.y]?.[t.x];
    if (tile) tile.owner = state.currentPlayer; // claimed land flips to the owner's colour/border
  }

  recomputeCities(state, registry);
  return checkWinConditions(state, registry);
}

// ── Nodes (Engineer-built 3×3 territory structures) ─────────────────────────
const NODE_BUILD_COST = 100;   // ore
const NODE_BUILD_TURNS = 2;    // rounds of the builder's turns to finish

// The 3×3 footprint (centre + ring), clipped to the map.
function nodeFootprint(state: GameState, center: Coord): Coord[] {
  const out: Coord[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = center.x + dx, y = center.y + dy;
    if (x >= 0 && y >= 0 && x < state.map.width && y < state.map.height) out.push({ x, y });
  }
  return out;
}

// A node may be placed only where its whole 3×3 is on-map, neutral territory (no owner),
// and free of any city or ruin tile — and not overlapping another node's footprint.
export function canPlaceNode(state: GameState, playerId: PlayerId, center: Coord): boolean {
  if (center.x < 0 || center.y < 0 || center.x >= state.map.width || center.y >= state.map.height) return false;
  const foot = nodeFootprint(state, center);
  if (foot.length !== 9) return false; // must be fully on-map (a 3×3), never clipped at an edge
  for (const c of foot) {
    const t = state.map.tiles[c.y][c.x];
    if (t.owner !== null) return false;         // no friendly/enemy territory overlap
    if (t.isCity || t.isRuin) return false;     // no city/ruin overlap
  }
  // No overlap with another node's 3×3 footprint (building or complete).
  for (const n of state.nodes ?? []) {
    if (Math.max(Math.abs(n.position.x - center.x), Math.abs(n.position.y - center.y)) <= 2) return false;
  }
  return true;
}

// Remove a node (cancel construction or clean up on builder death) and free its builder.
function removeNode(state: GameState, nodeId: number): void {
  const node = (state.nodes ?? []).find(n => n.id === nodeId);
  if (!node) return;
  state.nodes = state.nodes.filter(n => n.id !== nodeId);
  const builder = state.units.find(u => u.id === node.builderUnitId);
  if (builder && builder.buildingNodeId === nodeId) delete builder.buildingNodeId;
}

// Any action (move/attack/cast) by an engineer mid-build cancels its node first.
function cancelNodeForActingUnit(state: GameState, unit: Unit): void {
  if (unit.buildingNodeId !== undefined) removeNode(state, unit.buildingNodeId);
}

// Finish a node: claim its 3×3 as friendly territory (neutral tiles only) and free the builder.
function completeNode(state: GameState, node: NodeState): void {
  node.building = false;
  node.buildTurnsLeft = 0;
  for (const c of nodeFootprint(state, node.position)) {
    const t = state.map.tiles[c.y][c.x];
    if (t.owner === null) t.owner = node.owner; // claim neutral tiles (never steal a city's land)
  }
  const builder = state.units.find(u => u.id === node.builderUnitId);
  if (builder && builder.buildingNodeId === node.id) delete builder.buildingNodeId;
}

function applyCancelNodeBuild(state: GameState, action: CancelNodeBuildAction, registry: DataRegistry): GameState {
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || unit.owner !== state.currentPlayer || unit.buildingNodeId === undefined) return state;
  removeNode(state, unit.buildingNodeId);
  return checkWinConditions(state, registry);
}

// ── Marks (Tracer Round / Plant Explosives) ─────────────────────────────────
const EXPLOSIVE_DAMAGE = 5; // attack value of a Plant-Explosives detonation

// Does `viewerId` have a Detect unit/city covering `target`? (Same rule as cloak detection.)
function teamHasDetectOn(state: GameState, target: Coord, viewerId: PlayerId, registry: DataRegistry): boolean {
  const byUnit = state.units.some(d => {
    if (d.owner !== viewerId) return false;
    const dc = registry.unitTypes[d.typeId]?.conditions ?? [];
    const range = dc.includes('detect_2') ? 2 : dc.includes('detect') ? 1 : 0;
    if (range === 0) return false;
    return Math.max(Math.abs(d.position.x - target.x), Math.abs(d.position.y - target.y)) <= range;
  });
  if (byUnit) return true;
  return state.cities.some(c => c.owner === viewerId && c.detect &&
    Math.max(Math.abs(c.position.x - target.x), Math.abs(c.position.y - target.y)) <= 1);
}

// A mark on `markedUnit` is visible to `viewerId` if the viewer PLACED it, or the viewer owns
// the marked unit AND has Detect covering it (the marked team can't see it without Detect).
function markVisibleTo(state: GameState, markedUnit: Unit, mark: UnitMark, viewerId: PlayerId, registry: DataRegistry): boolean {
  if (mark.owner === viewerId) return true;
  if (markedUnit.owner === viewerId) return teamHasDetectOn(state, markedUnit.position, viewerId, registry);
  return false;
}

// Remove a mark from a friendly ally: the remover must be adjacent, not the marked unit itself,
// not have attacked/cast yet, and the mark must be Detect-visible to its team. Consumes the
// remover's attack/cast (but not its move — you may move THEN remove).
function applyRemoveMark(state: GameState, action: RemoveMarkAction, registry: DataRegistry): GameState {
  const remover = state.units.find(u => u.id === action.unitId);
  if (!remover || remover.owner !== state.currentPlayer || remover.hasAttacked) return state;
  const marked = state.units.find(u => u.position.x === action.target.x && u.position.y === action.target.y);
  if (!marked || marked.owner !== remover.owner || marked.id === remover.id) return state;
  if (Math.max(Math.abs(remover.position.x - marked.position.x), Math.abs(remover.position.y - marked.position.y)) > 1) return state;
  if (!(marked.marks ?? []).some(m => m.kind === action.kind)) return state;
  if (!teamHasDetectOn(state, marked.position, remover.owner, registry)) return state;
  marked.marks = (marked.marks ?? []).filter(m => m.kind !== action.kind);
  remover.hasAttacked = true; // consumes the attack/cast for this turn
  return checkWinConditions(state, registry);
}

function applyEndTurn(state: GameState, registry: DataRegistry): GameState {
  // The bump reveals expire when the bumping player's turn ends (fog returns).
  if (state.revealedTiles[state.currentPlayer]) state.revealedTiles[state.currentPlayer] = [];
  // "Combined Arms" per-target counts reset each turn.
  state.combinedArmsHits = {};

  // Node construction advances at the end of the builder's turn. A node still present here
  // wasn't cancelled (any action by its builder removes it), so tick it down / complete it.
  for (const node of state.nodes ?? []) {
    if (!node.building || node.owner !== state.currentPlayer) continue;
    node.buildTurnsLeft -= 1;
    if (node.buildTurnsLeft <= 0) completeNode(state, node);
  }

  // Tracer / Explosives marks tick down at the end of the MARKED unit's owner's turn.
  // A Plant-Explosives mark that reaches 0 DETONATES (a 5-attack hit) before it's removed.
  const detonated: Unit[] = [];
  for (const unit of state.units) {
    if (unit.owner !== state.currentPlayer || !unit.marks?.length) continue;
    for (const m of unit.marks) m.turnsLeft -= 1;
    if (unit.marks.some(m => m.turnsLeft <= 0 && m.kind === 'explosive')) detonated.push(unit);
    unit.marks = unit.marks.filter(m => m.turnsLeft > 0);
    if (unit.marks.length === 0) delete unit.marks;
  }
  for (const unit of detonated) unit.hp -= areaAttackDamage(state, unit, EXPLOSIVE_DAMAGE, registry);
  if (detonated.length) sweepDead(state, registry);

  // Passive heal: a unit that neither moved NOR attacked this turn recovers HP based on the
  // territory it stands in — friendly +4, neutral (unowned) +2, enemy +0 (data-driven, see
  // config.heal). Read BEFORE the flags reset below. Heal = HP recovery only (≠ Cure).
  const healCfg = state.config.heal ?? { friendlyTerritory: 4, neutralTerritory: 2, enemyTerritory: 0 };
  // Reset all current player's units (conditions like "corrosive_1" persist).
  for (const unit of state.units) {
    if (unit.owner === state.currentPlayer) {
      if (!unit.hasMoved && !unit.hasAttacked) {
        const ut = registry.unitTypes[unit.typeId];
        if (ut && unit.hp < ut.maxHP) {
          const owner = state.map.tiles[unit.position.y]?.[unit.position.x]?.owner ?? null;
          const heal = owner === unit.owner ? healCfg.friendlyTerritory
            : owner === null ? healCfg.neutralTerritory
            : healCfg.enemyTerritory;
          if (heal > 0) unit.hp = Math.min(ut.maxHP, unit.hp + heal);
        }
      }
      unit.hasMoved = false;
      unit.hasAttacked = false;
      unit.dashRemaining = 0;
      // "Stunned" lasts one of the unit's own turns — clear it as that turn ends.
      if (unit.statuses?.includes('stunned')) unit.statuses = unit.statuses.filter(s => s !== 'stunned');
      // Tick down ability cooldowns for the player whose turn just ended.
      for (const k in unit.abilityCooldowns) {
        if (unit.abilityCooldowns[k] > 0) unit.abilityCooldowns[k]--;
      }
    }
  }

  // Advance to next player
  const nextPlayer = (state.currentPlayer + 1) % state.players.length;
  state.currentPlayer = nextPlayer;

  // If we wrapped around to player 0, it's a new turn
  if (nextPlayer === 0) {
    state.turn++;

    // Clear expired "bile" (Spray Bile) tiles — they last `duration` rounds.
    for (const row of state.map.tiles) {
      for (const t of row) {
        if (t.bile && state.turn >= t.bile.expiresTurn) delete t.bile;
      }
    }

    // Clear expired timed unit statuses (e.g. "slowed" from a Medic) — each carries an
    // expiry round in unit.statusExpiry.
    for (const unit of state.units) {
      if (!unit.statusExpiry) continue;
      for (const s of Object.keys(unit.statusExpiry)) {
        if (state.turn >= unit.statusExpiry[s]) {
          if (unit.statuses) unit.statuses = unit.statuses.filter(x => x !== s);
          delete unit.statusExpiry[s];
        }
      }
    }

    // Collect ore income (city production + ore buildings), settle upkeep
    // (dormant), then collect plasma income. See economy.ts for the rules.
    for (const player of state.players) {
      const oreIncome = calculateOreIncome(state, player.id, registry);
      settleEconomy(state, player.id, oreIncome, registry);
      player.plasma += calculatePlasmaIncome(state, player.id, registry);
    }
  }

  return checkWinConditions(state, registry);
}

// ── Tech modifiers (getModifier lives in tech.ts) ──
function getMovementBonus(player: PlayerState, registry: DataRegistry): number {
  return getModifier(player, registry, 'allMovementBonus');
}

// ── Win Conditions ──
function checkWinConditions(state: GameState, registry: DataRegistry): GameState {
  if (state.phase !== 'playing') return state;
  const { config } = state;

  // Check elimination
  if (config.winConditions.eliminateAllUnits) {
    for (const player of state.players) {
      const hasUnits = state.units.some(u => u.owner === player.id);
      if (!hasUnits) {
        const opponent = state.players.find(p => p.id !== player.id);
        if (opponent && state.units.some(u => u.owner === opponent.id)) {
          state.phase = 'finished';
          state.winner = opponent.id;
          state.winConditionMet = 'eliminateAllUnits';
          return state;
        }
      }
    }
  }

  // Check capital capture — a player who no longer holds ANY capital (each player starts
  // with exactly one, and capitals can only be captured, never destroyed) has lost it; the
  // opponent still holding a capital wins.
  if (config.winConditions.captureCapital) {
    for (const player of state.players) {
      const holdsCapital = state.cities.some(c => c.isCapital && c.owner === player.id);
      if (!holdsCapital) {
        const opponent = state.players.find(p => p.id !== player.id
          && state.cities.some(c => c.isCapital && c.owner === p.id));
        if (opponent) {
          state.phase = 'finished';
          state.winner = opponent.id;
          state.winConditionMet = 'captureCapital';
          return state;
        }
      }
    }
  }

  // Check city capture
  if (config.winConditions.captureAllCities) {
    for (const player of state.players) {
      const cities = getCities(state, player.id);
      if (cities.length === 0) {
        // This player lost all cities — check if anyone else has all
        const allCities = getAllCities(state);
        for (const other of state.players) {
          if (other.id === player.id) continue;
          const otherCities = getCities(state, other.id);
          if (otherCities.length === allCities.length) {
            state.phase = 'finished';
            state.winner = other.id;
            state.winConditionMet = 'captureAllCities';
            return state;
          }
        }
      }
    }
  }

  // Check turn limit
  if (config.winConditions.highestScoreAtLimit && state.turn > config.turnLimit) {
    const scores = computeScores(state, registry);
    let bestPlayer = 0;
    let bestScore = -1;
    for (const [pid, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestPlayer = Number(pid);
      }
    }
    state.phase = 'finished';
    state.winner = bestPlayer;
    state.winConditionMet = 'highestScoreAtLimit';
    return state;
  }

  return state;
}

function getCities(state: GameState, playerId: PlayerId): Coord[] {
  const cities: Coord[] = [];
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (state.map.tiles[y][x].isCity && state.map.tiles[y][x].owner === playerId) {
        cities.push({ x, y });
      }
    }
  }
  return cities;
}

function getAllCities(state: GameState): Coord[] {
  const cities: Coord[] = [];
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (state.map.tiles[y][x].isCity) {
        cities.push({ x, y });
      }
    }
  }
  return cities;
}

export function computeScores(state: GameState, registry: DataRegistry): Record<PlayerId, number> {
  const scores: Record<PlayerId, number> = {};
  for (const player of state.players) {
    const cities = getCities(state, player.id);
    const unitCost = state.units
      .filter(u => u.owner === player.id)
      .reduce((sum, u) => {
        const ut = registry.unitTypes[u.typeId];
        return sum + (ut ? ut.cost : 0);
      }, 0);
    const income = calculateOreIncome(state, player.id, registry);

    scores[player.id] =
      cities.length * state.config.scoreWeights.cityValue +
      unitCost * state.config.scoreWeights.unitCostValue +
      income * state.config.scoreWeights.incomeValue;
  }
  return scores;
}

// ── Visible State (Fog of War) ──
// "Cloak" (Wraith): an enemy cloaked unit is hidden from `viewerId` unless it is
// "marked" or a viewer-owned "detect" unit is adjacent (Chebyshev ≤ 1). Cloak is
// separate from fog — it hides the unit even when fog is off. (Detect range is 1 for
// now — flagged to revisit.) Returns true if the unit should be HIDDEN from the viewer.
function unitHiddenByCloak(state: GameState, unit: Unit, viewerId: PlayerId, registry: DataRegistry): boolean {
  if (unit.owner === viewerId) return false; // you always see your own units
  const ut = registry.unitTypes[unit.typeId];
  // Cloak (Wraith) and Burrow (Wyrm) both hide the unit from enemies unless detected.
  if (!ut?.conditions?.includes('cloak') && !ut?.conditions?.includes('burrowed')) return false;
  if (unit.statuses?.includes('marked')) return false; // marked/exposed → visible
  // A CLOAKED unit (Wraith) standing on a ruin or an ENEMY city is exposed — it uncloaks.
  if (ut.conditions?.includes('cloak')) {
    const tile = state.map.tiles[unit.position.y]?.[unit.position.x];
    if (tile?.isRuin) return false;
    if (tile?.isCity) {
      const city = cityAt(state, unit.position);
      if (city && city.owner !== null && city.owner !== unit.owner) return false;
    }
  }
  // A viewer's detect unit reveals it within its detect range (detect = 1, detect_2 = 2).
  const detectedByUnit = state.units.some(d => {
    if (d.owner !== viewerId) return false;
    const dc = registry.unitTypes[d.typeId]?.conditions ?? [];
    const range = dc.includes('detect_2') ? 2 : dc.includes('detect') ? 1 : 0;
    if (range === 0) return false;
    return Math.max(Math.abs(d.position.x - unit.position.x), Math.abs(d.position.y - unit.position.y)) <= range;
  });
  // A viewer's "Detect" city (L5 level-up) reveals it within the city's 3×3.
  const detectedByCity = state.cities.some(c =>
    c.owner === viewerId && c.detect &&
    Math.max(Math.abs(c.position.x - unit.position.x), Math.abs(c.position.y - unit.position.y)) <= 1);
  return !(detectedByUnit || detectedByCity);
}

// Area of Influence (Zone of Control): the set of tiles ("x,y") projected by ENEMY units
// that a mover of `viewerId` can see. Each visible enemy projects a square around itself
// (Chebyshev radius 1 by default; `aoi_large` → radius 2), excluding its own tile. A unit
// entering one of these tiles has its movement stopped (enforced in getReachableTiles).
// Enemies hidden from the viewer (burrowed/cloaked, undetected) project nothing — a unit
// you can't see can't halt you (no information leak). TODO: `aoi_large` (5×5) and
// `aoi_immune` (mover ignores AOI) are scaffolding — no unit opts into them yet.
function enemyAOITiles(state: GameState, viewerId: PlayerId, registry: DataRegistry): Set<string> {
  const set = new Set<string>();
  const add3x3 = (cx: number, cy: number) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue; // the centre (unit/city tile) is not a sink
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) continue;
        set.add(`${x},${y}`);
      }
    }
  };
  // Enemy UNITS project AOI (radius 1 by default; aoi_large → 2; aoi_none → none). Hidden
  // enemies (cloaked/burrowed) project nothing — no fog info-leak.
  for (const e of state.units) {
    if (e.owner === viewerId) continue;
    if (unitHiddenByCloak(state, e, viewerId, registry)) continue;
    const conds = registry.unitTypes[e.typeId]?.conditions;
    if (conds?.includes('aoi_none')) continue;
    const r = conds?.includes('aoi_large') ? 2 : 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = e.position.x + dx, y = e.position.y + dy;
        if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) continue;
        set.add(`${x},${y}`);
      }
    }
  }
  // Enemy CITIES also project a 3×3 AOI (their immediate ring can't be freely moved through).
  // Only DISCOVERED enemy cities (in the viewer's fog memory, or fog off) — same no-leak rule
  // as hidden units, and consistent with the UI (which uses visible/remembered cities).
  const mem = state.memory?.[viewerId];
  for (const c of state.cities) {
    if (c.owner === null || c.owner === viewerId) continue; // neutral/own cities don't block
    const known = !state.config.fogOfWar
      || (mem?.cities?.some(mc => mc.position.x === c.position.x && mc.position.y === c.position.y) ?? false);
    if (known) add3x3(c.position.x, c.position.y);
  }
  // Completed enemy NODES exert a 3×3 AOI too (their territory is a zone of control).
  for (const n of state.nodes ?? []) {
    if (n.building || n.owner === viewerId) continue;
    add3x3(n.position.x, n.position.y);
  }
  return set;
}

// The Wyrm may not Burrow or Erupt on a city, mountain, or building tile.
function canBurrowEruptAt(state: GameState, pos: Coord, registry: DataRegistry): boolean {
  const tile = state.map.tiles[pos.y]?.[pos.x];
  if (!tile) return false;
  if (tile.isCity) return false;
  if (registry.terrainTypes[tile.terrain]?.id === 'mountain') return false;
  if (state.buildings.some(b => b.position.x === pos.x && b.position.y === pos.y)) return false;
  return true;
}

// Clone a unit for a viewer, keeping only the marks that viewer is allowed to see.
function withVisibleMarks(state: GameState, unit: Unit, viewerId: PlayerId, registry: DataRegistry): Unit {
  const c = clone(unit);
  if (c.marks?.length) {
    c.marks = c.marks.filter(m => markVisibleTo(state, unit, m, viewerId, registry));
    if (c.marks.length === 0) delete c.marks;
  }
  return c;
}

export function getVisibleState(state: GameState, playerId: PlayerId, registry: DataRegistry): VisibleState {
  if (!state.config.fogOfWar) {
    // No fog — everything visible EXCEPT cloaked enemy units (cloak ≠ fog).
    const visibility: TileVisibility[][] = [];
    for (let y = 0; y < state.map.height; y++) {
      visibility[y] = [];
      for (let x = 0; x < state.map.width; x++) {
        visibility[y][x] = 'visible';
      }
    }
    return {
      config: state.config,
      map: clone(state.map),
      units: state.units.filter(u => !unitHiddenByCloak(state, u, playerId, registry)).map(u => withVisibleMarks(state, u, playerId, registry)),
      players: clone(state.players),
      cities: clone(state.cities),
      buildings: clone(state.buildings),
      nodes: clone(state.nodes ?? []),
      unitHomeCity: clone(state.unitHomeCity),
      currentPlayer: state.currentPlayer,
      turn: state.turn,
      visibility,
      phase: state.phase,
      winner: state.winner,
      winConditionMet: state.winConditionMet,
      actionLog: clone(state.actionLog),
    };
  }

  // Current sight ('visible' / 'hidden'), then overlay persistent fog memory:
  // a tile seen before but not currently visible shows as 'explored' (fog), where
  // the player sees its LAST-SEEN snapshot (frozen terrain/structures, no enemy
  // units); a tile never seen is 'hidden' (cloud).
  const current = computeVisibility(state.map, state.units, state.cities, playerId, registry);
  const mem = state.memory[playerId];

  const visibility: TileVisibility[][] = [];
  const tiles = [];
  for (let y = 0; y < state.map.height; y++) {
    visibility[y] = [];
    const row = [];
    for (let x = 0; x < state.map.width; x++) {
      if (current[y][x] === 'visible') {
        visibility[y][x] = 'visible';
        row.push(clone(state.map.tiles[y][x])); // live truth
      } else if (current[y][x] === 'explored' || mem.tiles[y][x]) {
        // Fog: a remembered tile, OR one currently seen only as fog ("squinting eyes").
        visibility[y][x] = 'explored';
        row.push(clone(mem.tiles[y][x] ?? state.map.tiles[y][x])); // snapshot if we have it
      } else {
        visibility[y][x] = 'hidden';
        row.push(clone(state.map.tiles[y][x])); // covered by cloud, never read
      }
    }
    tiles.push(row);
  }
  // Prospecting (Refinement tech): reveal RESOURCE tiles within `revealResourcesRange`
  // (Chebyshev) of any friendly city as fog — the resource shows through the clouds, but
  // NOT any REB on it (buildings aren't added for these tiles) or ownership markers.
  const prospectRange = getModifier(state.players[playerId], registry, 'revealResourcesRange');
  if (prospectRange > 0) {
    const myCities = state.cities.filter(c => c.owner === playerId);
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        if (visibility[y][x] !== 'hidden') continue;
        const t = state.map.tiles[y][x];
        if (!t.isResourceTile) continue;
        if (!myCities.some(c => Math.max(Math.abs(c.position.x - x), Math.abs(c.position.y - y)) <= prospectRange)) continue;
        visibility[y][x] = 'explored';
        tiles[y][x] = { ...clone(t), owner: null, isCity: false, isRuin: false };
      }
    }
  }

  const composedMap = { width: state.map.width, height: state.map.height, tiles };

  const isVisible = (x: number, y: number) => current[y]?.[x] === 'visible';

  // Buildings: live ones on visible tiles, remembered ones on fog tiles.
  const buildings = [
    ...state.buildings.filter(b => isVisible(b.position.x, b.position.y)).map(clone),
    ...mem.buildings.filter(b => !isVisible(b.position.x, b.position.y)).map(clone),
  ];

  // Cities: live ones on visible tiles, last-seen snapshots on fog tiles (so a
  // captured/levelled enemy city you can't see still shows as you last saw it).
  const cities = [
    ...state.cities.filter(c => isVisible(c.position.x, c.position.y)).map(clone),
    ...mem.cities.filter(c => !isVisible(c.position.x, c.position.y)).map(clone),
  ];

  // Units: own units always; enemy units on currently-visible tiles, plus any tile a
  // blind unit "bumped" this turn (a temporary reveal that clears at end of turn).
  const revealed = state.revealedTiles?.[playerId] ?? [];
  const isRevealed = (x: number, y: number) => revealed.some(t => t.x === x && t.y === y);
  const visibleUnits = state.units.filter(u => {
    if (u.owner === playerId) return true;
    // A tile the player exposed THIS turn (a bump — incl. a cloaked enemy walked into)
    // overrides cloak: the bumped unit is shown until the player's turn ends.
    if (isRevealed(u.position.x, u.position.y)) return true;
    if (unitHiddenByCloak(state, u, playerId, registry)) return false; // cloak hides even on a visible tile
    return isVisible(u.position.x, u.position.y);
  });

  // Nodes: own nodes always; enemy nodes on currently-visible tiles (fog memory of enemy
  // nodes is deferred — their claimed territory still shows via tile ownership).
  const nodes = (state.nodes ?? []).filter(n => n.owner === playerId || isVisible(n.position.x, n.position.y)).map(clone);

  return {
    config: state.config,
    map: composedMap,
    units: visibleUnits.map(u => withVisibleMarks(state, u, playerId, registry)),
    players: clone(state.players),
    cities,
    buildings,
    nodes,
    unitHomeCity: clone(state.unitHomeCity),
    currentPlayer: state.currentPlayer,
    turn: state.turn,
    visibility,
    phase: state.phase,
    winner: state.winner,
    winConditionMet: state.winConditionMet,
    actionLog: clone(state.actionLog),
  };
}

// ── Game Result ──
export function getResult(state: GameState, registry: DataRegistry): GameResult | null {
  if (state.phase !== 'finished') return null;
  return {
    winner: state.winner,
    winCondition: state.winConditionMet || 'unknown',
    finalScores: computeScores(state, registry),
    turns: state.turn,
  };
}

// ── Replay: create game from action log ──
export function replayGame(
  config: GameConfig,
  registry: DataRegistry,
  factionIds: string[],
  seed: number,
  actions: Action[],
): GameState {
  let state = createGame(config, registry, factionIds, seed);
  for (const action of actions) {
    state = applyAction(state, action, registry);
  }
  return state;
}
