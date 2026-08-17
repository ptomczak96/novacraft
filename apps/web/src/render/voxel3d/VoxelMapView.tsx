import React from 'react';
import type { Action } from '@tactica/engine';
import { getAbilityUnitTargets, isExpansionTileEligible, previewAttack } from '@tactica/engine';
import { coherentSubset, volleyPicker, strikePicker } from '../../game/pickers.js';
import { previewPercussive, previewRam } from '../../game/attackPreview.js';
import type { AttackPreviewData } from './AttackPreview.js';
import { useGameStore } from '../../store/gameStore.js';
import { VoxelArena } from './VoxelArena.js';
import { VoxelErrorBoundary } from './VoxelErrorBoundary.js';
import type { CombatFx, Facing, TileHighlight, UnitGhost, UnitView } from './types.js';
import { TEAM_COLORS } from './palette.js';
import { attackStyleFor, impactDelayFor } from './units/attackStyles.js';
import { abilityImpactDelay } from './fx/AbilityVfx.js';
import { FxShowcasePanel } from './fx/BattlefieldVfx.js';

interface Targets {
  move: Map<string, Action>;
  attack: Map<string, Action>;
  slash: Map<string, Action>;
  ability: Map<string, Action>;
}

/**
 * Store adapter for the voxel3d renderer. Reads engine state from the game
 * store and derives the VoxelArena props. Built fresh for the voxel pipeline —
 * intentionally shares no code with the 2D iso renderer.
 *
 * Highlight semantics: legal moves → 'move' (green), attack/slash targets →
 * 'threat' (red), the selected unit's own tile → 'select' (cyan), armed-ability
 * targets → 'path' (amber).
 */
export function VoxelMapView() {
  const {
    visibleState, legalActions, selectedUnitId, abilityMode,
    selectUnit, executeAction, setSelectedCity, setInspectedTile,
    registry, lastCombatEvent, lastAbilityEvent, tileTheme, gameState,
    hoveredTile, setHoveredTile,
    volleySelect, setVolleySelect, strikeSelect, setStrikeSelect,
    targetSelect, setTargetSelect, territorySelect, setTerritorySelect,
  } = useGameStore();

  // GEN 8 — 3D Tileset: the Map Generation option that renders the board from
  // GLB tile blocks and spawns real GLB unit models. `?tileset=1` forces it
  // (dev harness, pairs with ?unitGallery=1 for reviewing the models).
  const tileset = tileTheme === 'gen8_tileset3d' ||
    new URLSearchParams(window.location.search).get('tileset') === '1';
  const breach = tileTheme === 'breach_ashwater';

  // Dev harness: ?unitGallery=1 lays out one of every unit kind on the board
  // (alternating teams) for reviewing the voxel models.
  const gallery = React.useMemo(
    () => new URLSearchParams(window.location.search).get('unitGallery') === '1',
    [],
  );

  const quality = React.useMemo<'high' | 'low'>(
    () => (new URLSearchParams(window.location.search).get('quality') === 'low' ? 'low' : 'high'),
    [],
  );

  // Polytopia-style resting facing: units always settle facing the CAMERA —
  // player 0's army rests SW, player 1's rests SE — and only turn away from
  // that to walk a path segment or strike (UnitMesh handles those overrides
  // and eases back afterwards).
  const unitViews = React.useMemo<UnitView[]>(() => {
    if (!visibleState) return [];
    return visibleState.units.map(u => {
      return {
        id: u.id,
        gridPos: { x: u.position.x, y: u.position.y },
        facing: (u.owner === 0 ? 'sw' : 'se') as Facing,
        teamColor: TEAM_COLORS[u.owner % TEAM_COLORS.length],
        kind: u.typeId,
        hostile: u.owner !== visibleState.currentPlayer,
        selected: u.id === selectedUnitId,
        hp: u.hp,
        maxHp: registry.unitTypes[u.typeId]?.maxHP,
        shielded: u.statuses?.includes('shielded') ?? false,
        statuses: u.statuses ?? [],
      };
    });
  }, [visibleState, selectedUnitId, registry]);

  // Target tiles for the selected unit / armed ability, straight from the
  // engine's legal-action list (the engine has no separate "threat map").
  const targets = React.useMemo<Targets>(() => {
    const t: Targets = { move: new Map(), attack: new Map(), slash: new Map(), ability: new Map() };
    if (!visibleState) return t;
    for (const action of legalActions) {
      if (action.type === 'move' && action.unitId === selectedUnitId) {
        // A bump move targets the impassable tile it reveals, matching engine rules.
        const to = action.bumpReveal ?? action.to;
        t.move.set(`${to.x},${to.y}`, action);
      } else if (action.type === 'attack' && action.unitId === selectedUnitId) {
        const target = visibleState.units.find(u => u.id === action.targetId);
        if (target) t.attack.set(`${target.position.x},${target.position.y}`, action);
      } else if (action.type === 'slash' && action.unitId === selectedUnitId) {
        t.slash.set(`${action.target.x},${action.target.y}`, action);
      } else if (
        abilityMode &&
        action.type === 'useAbility' &&
        action.unitId === abilityMode.unitId &&
        action.abilityId === abilityMode.abilityId
      ) {
        t.ability.set(`${action.target.x},${action.target.y}`, action);
      }
    }
    return t;
  }, [visibleState, legalActions, selectedUnitId, abilityMode]);

  // Tile-based economy actions (build a REB, upgrade one, found/capture a city) —
  // straight from the engine's legal-action list, keyed by the tile they act on.
  // The 2D iso canvas surfaces these as clickable boxes; the voxel renderer wires
  // them into tile clicks here. First-wins keeps the iso canvas's kind priority
  // (mine > extractor > refinery > purifier) when a tile allows more than one.
  const tileActions = React.useMemo(() => {
    const m = new Map<string, Action>();
    if (!visibleState) return m;
    for (const a of legalActions) {
      if (a.type === 'build' || a.type === 'upgradeBuilding' || a.type === 'foundCity') {
        const key = `${a.position.x},${a.position.y}`;
        if (!m.has(key)) m.set(key, a);
      } else if (a.type === 'captureCity') {
        const u = visibleState.units.find(uu => uu.id === a.unitId);
        if (u) m.set(`${u.position.x},${u.position.y}`, a);
      }
    }
    return m;
  }, [visibleState, legalActions]);

  // Multi-tile pickers (Ballistic Volley 2×2 / Wyrm strike pair / Cure-Repair
  // unit targets / city territory expansion): eligible tiles + current picks,
  // from the same shared helpers the 2D renderer uses.
  const picker = React.useMemo(() => {
    if (!gameState) return null;
    if (volleySelect) {
      return { eligible: volleyPicker(gameState, registry, volleySelect).eligible, picks: volleySelect.picks, pickKind: 'threat' as const };
    }
    if (strikeSelect) {
      return { eligible: strikePicker(gameState, registry, strikeSelect).eligible, picks: strikeSelect.picks, pickKind: 'threat' as const };
    }
    if (targetSelect) {
      return { eligible: getAbilityUnitTargets(gameState, targetSelect.unitId, targetSelect.abilityId, registry), picks: targetSelect.picks, pickKind: 'select' as const };
    }
    if (territorySelect) {
      const city = gameState.cities.find(c => c.id === territorySelect.cityId);
      if (!city) return null;
      const eligible: { x: number; y: number }[] = [];
      for (let y = 0; y < gameState.map.height; y++) {
        for (let x = 0; x < gameState.map.width; x++) {
          if (isExpansionTileEligible(gameState, registry, city, { x, y }, territorySelect.picks)) {
            eligible.push({ x, y });
          }
        }
      }
      return { eligible, picks: territorySelect.picks, pickKind: 'select' as const };
    }
    return null;
  }, [gameState, registry, volleySelect, strikeSelect, targetSelect, territorySelect]);

  const highlights = React.useMemo<TileHighlight[]>(() => {
    const list: TileHighlight[] = [];
    const push = (key: string, kind: TileHighlight['kind']) => {
      const [x, y] = key.split(',').map(Number);
      list.push({ x, y, kind });
    };
    if (picker) {
      for (const c of picker.eligible) list.push({ x: c.x, y: c.y, kind: 'path' });
      for (const c of picker.picks) list.push({ x: c.x, y: c.y, kind: picker.pickKind });
      return list;
    }
    for (const key of targets.move.keys()) push(key, 'move');
    for (const key of targets.attack.keys()) push(key, 'threat');
    for (const key of targets.slash.keys()) push(key, 'threat');
    for (const key of targets.ability.keys()) push(key, 'path');
    // Buildable / upgradeable / found / capture tiles (unless arming an ability).
    if (!abilityMode) for (const key of tileActions.keys()) push(key, 'build');
    const selected = visibleState?.units.find(u => u.id === selectedUnitId);
    if (selected) list.push({ x: selected.position.x, y: selected.position.y, kind: 'select' });
    return list;
  }, [targets, tileActions, abilityMode, visibleState, selectedUnitId, picker]);

  // Same interaction contract as the 2D renderer's click priority:
  // picker tick/untick → ability target → move → attack/slash → unit select
  // → city → inspect.
  const onTileClick = React.useCallback((x: number, y: number) => {
    const key = `${x},${y}`;

    // Multi-tile pickers consume ALL clicks while active (mirrors IsoCanvas).
    if (gameState && (volleySelect || strikeSelect || targetSelect || territorySelect)) {
      const t = { x, y };
      if (volleySelect) {
        const picks = volleySelect.picks;
        const idx = picks.findIndex(p => p.x === x && p.y === y);
        if (idx >= 0) setVolleySelect({ ...volleySelect, picks: picks.filter((_, i) => i !== idx) });
        else if (picks.length < 4 && volleyPicker(gameState, registry, volleySelect).eligible.some(c => c.x === x && c.y === y)) {
          setVolleySelect({ ...volleySelect, picks: [...picks, t] });
        }
      } else if (strikeSelect) {
        const picks = strikeSelect.picks;
        const idx = picks.findIndex(p => p.x === x && p.y === y);
        if (idx >= 0) setStrikeSelect({ ...strikeSelect, picks: idx === 0 ? [] : picks.slice(0, 1) });
        else if (picks.length < 2 && strikePicker(gameState, registry, strikeSelect).eligible.some(c => c.x === x && c.y === y)) {
          setStrikeSelect({ ...strikeSelect, picks: [...picks, t] });
        }
      } else if (targetSelect) {
        const picks = targetSelect.picks;
        const idx = picks.findIndex(p => p.x === x && p.y === y);
        if (idx >= 0) setTargetSelect({ ...targetSelect, picks: picks.filter((_, i) => i !== idx) });
        else if (
          picks.length < targetSelect.maxTargets &&
          getAbilityUnitTargets(gameState, targetSelect.unitId, targetSelect.abilityId, registry).some(c => c.x === x && c.y === y)
        ) {
          setTargetSelect({ ...targetSelect, picks: [...picks, t] });
        }
      } else if (territorySelect) {
        const city = gameState.cities.find(c => c.id === territorySelect.cityId);
        if (city) {
          const picks = territorySelect.picks;
          const idx = picks.findIndex(p => p.x === x && p.y === y);
          if (idx >= 0) {
            const remaining = picks.filter((_, i) => i !== idx);
            setTerritorySelect({ cityId: city.id, picks: coherentSubset(gameState, registry, city, remaining) });
          } else if (picks.length < 3 && isExpansionTileEligible(gameState, registry, city, t, picks)) {
            setTerritorySelect({ cityId: city.id, picks: [...picks, t] });
          }
        }
      }
      return;
    }
    const act = targets.ability.get(key) ?? targets.move.get(key)
      ?? targets.attack.get(key) ?? targets.slash.get(key);
    if (act) {
      executeAction(act);
      return;
    }
    // Economy action on this tile (build a REB / upgrade / found / capture). Skipped
    // while arming an ability so the ability's own click flow isn't hijacked.
    if (!abilityMode) {
      const econ = tileActions.get(key);
      if (econ) {
        executeAction(econ);
        return;
      }
    }
    // Select a unit on the tile. When more than one co-occupies it (e.g. YOUR
    // burrowed Wyrm under an enemy), sort burrowed units LAST so the first click
    // picks the surface unit and each further click cycles to the next — so a second
    // click reaches the burrowed unit (to erupt / move it).
    const here = (visibleState?.units ?? []).filter(u => u.position.x === x && u.position.y === y);
    if (here.length > 0) {
      const isBurrowed = (u: typeof here[number]) =>
        registry.unitTypes[u.typeId]?.conditions?.includes('burrowed') ? 1 : 0;
      const ordered = [...here].sort((a, b) => isBurrowed(a) - isBurrowed(b));
      const idx = ordered.findIndex(u => u.id === selectedUnitId);
      const next = ordered[(idx + 1) % ordered.length];
      if (next && next.id !== selectedUnitId) {
        selectUnit(next.id);
        return;
      }
    }
    const tile = visibleState?.map.tiles[y]?.[x];
    if (tile?.isCity) {
      setSelectedCity({ x, y });
      return;
    }
    selectUnit(null);
    setInspectedTile({ x, y });
  }, [
    targets, tileActions, abilityMode, visibleState, selectedUnitId, executeAction, selectUnit, setSelectedCity, setInspectedTile,
    gameState, registry, volleySelect, setVolleySelect, strikeSelect, setStrikeSelect,
    targetSelect, setTargetSelect, territorySelect, setTerritorySelect,
  ]);

  const galleryUnits = React.useMemo<UnitView[]>(() => {
    if (!gallery || !visibleState) return [];
    const perRow = Math.max(1, Math.floor((visibleState.map.width - 1) / 2));
    return Object.keys(registry.unitTypes).map((kind, i) => ({
      id: 100000 + i,
      gridPos: { x: 1 + (i % perRow) * 2, y: 1 + Math.floor(i / perRow) * 2 },
      facing: 'sw' as Facing,
      teamColor: TEAM_COLORS[i % TEAM_COLORS.length],
      kind,
      hostile: i % 2 === 1,
    }));
  }, [gallery, visibleState, registry]);

  // Combat FX + death ghosts. Ghosts are created ONLY from combat kill events
  // (units disappearing into fog of war must not play a death). The previous
  // frame's unit views provide the dead unit's last appearance.
  const prevViewsRef = React.useRef<UnitView[]>([]);
  const [ghosts, setGhosts] = React.useState<UnitGhost[]>([]);

  // Kills → corpses. Each corpse HOLDS (stands as it was) until the killing
  // blow's projectile/impact actually arrives — its `delay` mirrors the FX
  // timing — then falls over along `dir` (away from the killer) and fades.
  const spawnGhosts = React.useCallback((dead: UnitGhost[]) => {
    if (dead.length === 0) return;
    setGhosts(g => [...g, ...dead]);
    const keys = new Set(dead.map(d => d.ghostKey));
    const maxDelay = Math.max(...dead.map(d => d.delay ?? 0));
    setTimeout(() => setGhosts(g => g.filter(x => !keys.has(x.ghostKey))), (maxDelay + 1.6) * 1000);
  }, []);

  const combatSeq = lastCombatEvent?.seq;
  React.useEffect(() => {
    const ev = lastCombatEvent;
    if (!ev) return;
    const dead: UnitGhost[] = [];
    const attacker = prevViewsRef.current.find(u => u.id === ev.attackerId);
    const dist = Math.hypot(ev.defenderPos.x - ev.attackerPos.x, ev.defenderPos.y - ev.attackerPos.y);
    const impact = impactDelayFor(attackStyleFor(attacker?.kind ?? ''), dist);
    const len = dist || 1;
    const dir = { x: (ev.defenderPos.x - ev.attackerPos.x) / len, z: (ev.defenderPos.y - ev.attackerPos.y) / len };
    const ghost = (id: number, pos: { x: number; y: number }, delay: number, d: { x: number; z: number }) => {
      const v = prevViewsRef.current.find(u => u.id === id);
      if (v) dead.push({ view: { ...v, gridPos: { ...pos } }, ghostKey: `${ev.seq}:${id}`, delay, dir: d });
    };
    if (ev.defenderKilled) ghost(ev.defenderId, ev.defenderPos, impact, dir);
    // Retaliation lands a beat after the attack connects.
    if (ev.attackerKilled) ghost(ev.attackerId, ev.attackerPos, impact + 0.2, { x: -dir.x, z: -dir.z });
    spawnGhosts(dead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combatSeq]);

  const abilityKillSeq = lastAbilityEvent?.seq;
  React.useEffect(() => {
    const ev = lastAbilityEvent;
    if (!ev?.killed?.length) return;
    const dead: UnitGhost[] = [];
    for (const k of ev.killed) {
      const v = prevViewsRef.current.find(u => u.id === k.id);
      if (!v) continue;
      let idx = ev.targets.findIndex(t => t.x === k.pos.x && t.y === k.pos.y);
      if (idx < 0) idx = 0;
      const delay = abilityImpactDelay(ev.abilityId, ev.casterPos, k.pos, idx);
      const dx = k.pos.x - ev.casterPos.x, dz = k.pos.y - ev.casterPos.y;
      const len = Math.hypot(dx, dz);
      // Self-kills (self_destruct) have no direction — fall pseudo-randomly.
      const a = (k.id * 2.399) % (Math.PI * 2);
      const dir = len > 0.01 ? { x: dx / len, z: dz / len } : { x: Math.sin(a), z: Math.cos(a) };
      dead.push({ view: { ...v, gridPos: { ...k.pos } }, ghostKey: `a${ev.seq}:${k.id}`, delay, dir });
    }
    spawnGhosts(dead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abilityKillSeq]);
  React.useEffect(() => {
    prevViewsRef.current = unitViews;
  }, [unitViews]);

  const combat = React.useMemo<CombatFx | null>(() => {
    const ev = lastCombatEvent;
    if (!ev) return null;
    return {
      seq: ev.seq,
      attackerId: ev.attackerId,
      defenderId: ev.defenderId,
      attackerPos: ev.attackerPos,
      defenderPos: ev.defenderPos,
      damage: ev.damage,
      retaliation: ev.retaliation,
      defenderKilled: ev.defenderKilled,
      attackerKilled: ev.attackerKilled,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combatSeq]);

  // Ability casts → render-side cast animations (heals, bolts, barrages…).
  const abilitySeq = lastAbilityEvent?.seq;
  const abilityFx = React.useMemo(() => {
    const ev = lastAbilityEvent;
    if (!ev) return null;
    return {
      seq: ev.seq,
      abilityId: ev.abilityId,
      unitId: ev.unitId,
      casterPos: ev.casterPos,
      targets: ev.targets,
      killed: ev.killed,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abilitySeq]);

  // Board hover (guarded — only writes the store when the TILE changes).
  const onTileHover = React.useCallback((x: number | null, y?: number) => {
    const cur = useGameStore.getState().hoveredTile;
    if (x === null) {
      if (cur) setHoveredTile(null);
    } else if (!cur || cur.x !== x || cur.y !== y) {
      setHoveredTile({ x, y: y! });
    }
  }, [setHoveredTile]);

  // Into-the-Breach outcome telegraph for the hovered attack / push-ability
  // target — numbers straight from the engine's preview helpers. Ability
  // pushes are forecast from VisibleState so hidden units never gain arrows.
  const preview = React.useMemo<AttackPreviewData | null>(() => {
    if (!gameState || !visibleState || !hoveredTile) return null;
    const key = `${hoveredTile.x},${hoveredTile.y}`;
    const atk = targets.attack.get(key);
    if (atk && atk.type === 'attack') {
      const attacker = gameState.units.find(u => u.id === atk.unitId);
      const res = previewAttack(gameState, atk.unitId, atk.targetId, registry);
      if (attacker && res) {
        const style = attackStyleFor(attacker.typeId);
        const trajectory = style.kind === 'melee'
          ? 'none'
          : (style.shape === 'shell' || style.shape === 'glob' || style.shape === 'arrow' ? 'arc' : 'straight');
        return {
          kind: 'attack',
          attacker: { ...attacker.position },
          target: { ...hoveredTile },
          trajectory,
          damage: res.attackerDamage,
          retaliation: res.defenderRetaliation,
          lethal: res.defenderKilled,
          attackerLethal: res.attackerKilled,
        };
      }
    }
    const cast = targets.ability.get(key);
    if (cast && cast.type === 'useAbility') {
      const caster = visibleState.units.find(u => u.id === cast.unitId);
      if (caster && cast.abilityId === 'percussive_shells') {
        const p = previewPercussive(visibleState, registry, caster, hoveredTile);
        return {
          kind: 'percussive',
          attacker: { ...caster.position },
          target: { ...hoveredTile },
          trajectory: 'arc',
          centerDamage: p.centerDamage,
          pushes: p.pushes,
        };
      }
      if (caster && cast.abilityId === 'ram') {
        const p = previewRam(visibleState, registry, caster, hoveredTile);
        if (p) {
          return {
            kind: 'ram',
            attacker: { ...caster.position },
            target: { ...hoveredTile },
            trajectory: 'none',
            pushes: [p],
          };
        }
      }
    }
    return null;
  }, [gameState, visibleState, hoveredTile, targets, registry]);

  if (!visibleState) return null;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {gallery && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20, padding: '4px 12px', borderRadius: 4,
          background: 'rgba(255, 45, 149, 0.9)', color: '#fff',
          fontFamily: 'monospace', fontSize: 12, pointerEvents: 'none',
        }}>
          UNIT GALLERY (dev preview — units are not playable). Remove ?unitGallery=1 from the URL.
        </div>
      )}
      <VoxelErrorBoundary>
        <VoxelArena
          map={visibleState.map}
          units={gallery ? galleryUnits : unitViews}
          highlights={highlights}
          quality={quality}
          onTileClick={onTileClick}
          visibility={gallery ? undefined : visibleState.visibility}
          tileset={tileset}
          breach={breach}
          onTileHover={onTileHover}
          preview={preview}
          combat={combat}
          ability={abilityFx}
          ghosts={ghosts}
        />
      </VoxelErrorBoundary>
      {breach && <FxShowcasePanel map={visibleState.map} hovered={hoveredTile} />}
    </div>
  );
}
