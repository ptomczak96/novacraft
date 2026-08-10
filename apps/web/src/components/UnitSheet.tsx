import React from 'react';
import { getDefenseMultiplier, grantedConditions } from '@tactica/engine';
import { useGameStore } from '../store/gameStore.js';

// Category taxonomy for a unit's named rules (see docs/conditions.md):
//   condition — a limit/debuff. Either inherent to the unit, OR applied by another
//               unit during play (e.g. corrosive_1 from a Corrosive attack).
//   active    — an opt-in ability the unit MAY use (placeholders for now).
//   passive   — an always-on ability the unit has by default.
type AbilityCategory = 'condition' | 'active' | 'passive';
interface AbilityDef { name: string; desc: string; category: AbilityCategory; effect?: string }

const ABILITY_REGISTRY: Record<string, AbilityDef> = {
  // ── Conditions (limits / debuffs) ──
  mountain_restricted: { category: 'condition', name: 'Mountain Restricted', desc: 'Cannot move onto mountain tiles (this is the default for all units).' },
  low_horizons: { category: 'condition', name: 'Low Horizons', desc: 'Mountains block its line of sight — it sees the mountain but nothing beyond it.' },
  impotent_founder: { category: 'condition', name: 'Impotent Founder', desc: 'Cannot found cities.' },
  sacrificial_founder: { category: 'condition', name: 'Sacrificial Founder', desc: 'Dies when it founds a city.' },
  blind: { category: 'condition', name: 'Blind', desc: 'Sees only its own tile; can move into clouds and bumps into hidden enemies to reveal them.' },
  squinting_eyes_1: { category: 'condition', name: 'Squinting Eyes I', desc: 'Sees its 3×3 as fog only (terrain, not units).' },
  squinting_eyes_2: { category: 'condition', name: 'Squinting Eyes II', desc: '3×3 fully visible; the surrounding 5×5 ring shown as fog.' },
  stumble: { category: 'condition', name: 'Stumble', desc: 'While inside an enemy’s area of influence (the 3×3 around it — i.e. adjacent to an enemy), its movement is capped at 1.' },
  corrosive_1: { category: 'condition', name: 'Corrosive I', effect: '−20% DEF', desc: 'Defence reduced by 20% (from a Corrosive attack). Persists until removed.' },
  corrosive_2: { category: 'condition', name: 'Corrosive II', effect: '−30% DEF', desc: 'Defence reduced by 30% (from a Corrosive attack). Persists until removed.' },
  infected: { category: 'condition', name: 'Infected', desc: 'When this unit dies it spawns 2 scuttlings for the infector (one on its tile, one adjacent).' },
  bile_enemy: { category: 'condition', name: 'On Infected Tile', effect: '−20% DEF', desc: 'Standing on an enemy Spray Bile tile: defence −20% (and a movement penalty — TBD). Clears when it leaves the tile.' },
  stunned: { category: 'condition', name: 'Stunned', desc: 'Cannot move or attack for 1 turn (from a Wraith’s Stun). Recovers at the end of its next turn.' },
  slowed: { category: 'condition', name: 'Slowed', desc: 'Movement capped at 1 (from a Medic’s Slow). Lasts 3 turns.' },
  burrowed: { category: 'condition', name: 'Burrowed', desc: 'Underground: invisible to enemies (unless a Detect unit is adjacent), can move under enemy units and can’t attack. ATK/DEF 0 — very fragile if revealed. Surface with Erupt.' },
  shielded: { category: 'condition', name: 'Shielded', desc: 'Kinetic Shield: absorbs 100% of the next hit, then is consumed.' },

  // ── Active abilities (opt-in casts) ──
  infect: { category: 'active', name: 'Infect', desc: 'Cast on a LIGHT unit (range 3). It becomes Infected — when it dies it spawns 2 scuttlings for you.' },
  spray_bile: { category: 'active', name: 'Spray Bile', desc: 'Infect a tile for 5 rounds (range 2): friendly units on it get ATK ×1.2 & DEF ×1.2; enemies get DEF ×0.8 (and a movement penalty — TBD).' },
  burrow: { category: 'active', name: 'Burrow', desc: 'Submerge underground (spends the turn): invisible to enemies (unless a Detect unit is adjacent), MOV 2, but ATK/DEF 0 and can’t attack. Surface again with Erupt.' },
  erupt: { category: 'active', name: 'Erupt', desc: 'Burst up to the surface (spends the turn), instantly killing any enemy on this tile. Can also erupt on an empty tile just to surface.' },
  ram: { category: 'active', name: 'Ram', desc: 'Shove an adjacent enemy LIGHT unit one tile straight away. Into an obstacle → collide (2 dmg, stays); into a void (water/lava) → it dies. Heavy units are immune.' },
  raid: { category: 'active', name: 'Raid', desc: 'Steal resources from an enemy REB and damage/destroy it. Coming soon — mechanics TBD.' },
  self_destruct: { category: 'active', name: 'Self Destruct', desc: 'Detonate: the Burstling dies and deals a 2-attack hit (resolved vs defence/cover) to every unit (friend or foe) in its 3×3.' },
  percussive_shells: { category: 'active', name: 'Percussive Shells', desc: 'Impact any tile in range 2: a LIGHT unit there takes a hit, and LIGHT units around the impact are shoved outward (obstacle → 2 dmg; void → death). Heavy units are immune.' },
  ballistic_volley: { category: 'active', name: 'Ballistic Volley', desc: 'Bombard a 2×2 square at range 2–3: every unit inside — friend and foe — takes a 2-attack hit (resolved vs defence/cover, no retaliation). Pick the 4 tiles, then Confirm. A Kinetic Shield negates the hit.' },
  kinetic_shield: { category: 'active', name: 'Kinetic Shield', desc: 'Give a friendly unit (range 2) a shield that absorbs 100% of the next hit, then vanishes.' },
  assault_mode: { category: 'active', name: 'Assault Mode', desc: 'Toggle Assault Mode — spends a turn each way. Assault: ATK 5, DEF 2, MOV 0, range 2–3, VIS 3.' },
  stun: { category: 'active', name: 'Stun', desc: 'Instead of attacking, stun an enemy within range 3 — it can’t move or attack for 1 turn. Does not reveal the Wraith.' },
  plant_explosives: { category: 'active', name: 'Plant Explosives', desc: 'Tag an enemy (range 3) with explosives (blinking red). Detonate for a 5-attack hit at the end of 2 of its turns. Only you see it — the enemy needs Detect. An adjacent detecting ally can defuse it (costs an attack/cast). (Building damage pending the building-HP model.)' },
  heal_1: { category: 'active', name: 'Heal I', desc: 'Restore 8 HP to one adjacent friendly LIGHT unit (range 1). Spends the turn. Unlocked with Triage.' },
  heal_2: { category: 'active', name: 'Heal II', desc: 'Restore 10 HP to up to TWO adjacent friendly LIGHT units (range 1, distinct — can’t stack). Replaces Heal I with Advanced Biomed.' },
  cure: { category: 'active', name: 'Cure', desc: 'Remove ALL afflicting conditions (infected, corrosive, stunned, …) from one adjacent friendly unit (range 1, any class). Unlocked with Advanced Biomed.' },
  repair_1: { category: 'active', name: 'Repair I', desc: 'Restore 5 HP to one adjacent friendly HEAVY/GIANT unit (range 1). Spends the turn. Unlocked with Engineering. (Building repair pending the building-damage model.)' },
  repair_2: { category: 'active', name: 'Repair II', desc: 'Restore 8 HP to up to TWO adjacent friendly HEAVY/GIANT units (range 1, distinct — can’t stack). Replaces Repair I with Tactical Engineering.' },
  build_node: { category: 'active', name: 'Build Node', desc: 'Spend 100 ore to build a Node on a neutral tile within range 1 (its 3×3 must be clear of cities/ruins and any territory). Takes 2 turns; the Engineer must stay put (moving/acting cancels it, being killed destroys it). A finished Node claims its 3×3 as friendly territory (heal + zone of control).' },
  tracer_round: { category: 'active', name: 'Tracer Round', desc: 'Tag an enemy (range 3, blinking blue) for 3 of its turns: reveals its position and 3×3 sight to you. Only you see the tag — the enemy needs Detect. An adjacent detecting ally can strip it (costs an attack/cast).' },

  // ── Passive abilities (always-on) ──
  mountain_movement: { category: 'passive', name: 'Mountain Movement', desc: 'Can move onto mountains (no combat or sight bonus).' },
  mountain_defense: { category: 'passive', name: 'Mountain Defense', desc: 'Can move onto mountains; gains ×1.2 defence while standing on one.' },
  mountain_shooter: { category: 'passive', name: 'Mountain Shooter', desc: 'Can move onto mountains; gains ×1.2 attack while standing on one.' },
  mountain_shooter_2: { category: 'passive', name: 'Mountain Shooter II', desc: 'Can move onto mountains; while on one, gains ×1.2 attack AND +1 attack range.' },
  mobile: { category: 'passive', name: 'Mobile', desc: 'Ignores terrain movement penalties for forest and mountains. (Movement-cost hookup pending the pathing system.)' },
  mountain_sight: { category: 'passive', name: 'Mountain Sight', desc: 'Can move onto mountains; its visibility becomes 2 while standing on one.' },
  detect: { category: 'passive', name: 'Detect', desc: 'Reveals adjacent cloaked and burrowed enemy units (uncloaks them).' },
  detect_2: { category: 'passive', name: 'Detect II', desc: 'Reveals cloaked/burrowed enemy units within its 5×5 (range 2).' },
  overwatch_network_1: { category: 'passive', name: 'Overwatch Network I', desc: 'Friendly RANGED units within its 3×3 get +1 attack range.' },
  corrosive: { category: 'passive', name: 'Corrosive', desc: 'Its attack applies Corrosive 1 (−20% DEF) to a surviving target.' },
  slash: { category: 'passive', name: 'Slash', desc: 'Its attack is a sweeping strike at a 3-tile arc: the central tile takes 100% damage, the two side tiles 50%. Hits friendly units too (friendly fire); no retaliation.' },
  cloak: { category: 'passive', name: 'Cloak', desc: 'Invisible to enemy units unless an enemy Detect unit is adjacent, or it has been marked/exposed.' },
  repositioning: { category: 'passive', name: 'Repositioning', desc: 'Cannot attack if it has moved this turn (and cannot move once it has attacked). It must stay put to fire.' },
  twin_strike: { category: 'passive', name: 'Body Slam', desc: 'Its attack hits TWO tiles. Pick a first tile (it ticks), then a touching second tile, then Continue — you MUST pick two. If the only enemy is ringed by your own units, your second pick has to be a friendly (it gets slammed too). First tile 100% damage, second 50%; no retaliation. Can hit into fog/cloud (revealing it for the turn). Only if it has not moved.' },
  combined_arms: { category: 'passive', name: 'Combined Arms', desc: "Your LIGHT units' 2nd+ attack on the SAME target each turn deals ×1.2 (flat — does not compound). Granted faction-wide by the Advanced Weaponry tech." },
  aoi_none: { category: 'passive', name: 'No AOI', desc: 'Projects no Area of Influence — enemy units move freely through its zone (it does not stop their movement).' },
  death_burst: { category: 'passive', name: 'Death Burst', desc: 'When this unit dies (killed or self-destructs) it deals a 2-attack hit (resolved vs defence/cover) to every unit — friend or foe — in its 3×3.' },
  flying: { category: 'passive', name: 'Flying (Air)', desc: 'Air unit: ignores terrain and hovers over impassable tiles; cannot be hit by melee (range-1) attacks. Cannot share a tile with another unit (for now).' },
};

// Small int → Roman numeral (levelled ability names use Roman numerals: Corrosive I/II, Dash I/II…).
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
function toRoman(n: number): string { return ROMAN[n] ?? String(n); }

// Upgrades a unit COULD gain but that are gated behind un-researched tech. Shown greyed
// in the Unit Info panel (hover for the required tech chain + effect). `techId` is the
// engine tech that grants it (hidden once researched).
interface GatedUpgrade { name: string; desc: string; techId: string; chain: string[] }
const GATED_UPGRADES: Record<string, GatedUpgrade[]> = {
  stalker: [
    { name: 'Mountain Shooter II', techId: 'precision_targeting', chain: ['Forge', 'Mech Bay', 'Precision Targeting'], desc: 'On a mountain: ×1.2 attack and +1 attack range.' },
    { name: 'Composite Plating (+20% DEF)', techId: 'composite_plating', chain: ['Forge', 'Mech Bay / Crucible', 'Composite Plating'], desc: 'Permanent ×1.2 defence.' },
  ],
  tank: [
    { name: 'Assault Range 2–4', techId: 'advanced_projectiles', chain: ['Forge', 'Crucible', 'Advanced Projectiles'], desc: 'Assault-mode range becomes 2–4 (default 2–3).' },
    { name: 'Composite Plating (+20% DEF)', techId: 'composite_plating', chain: ['Forge', 'Crucible / Mech Bay', 'Composite Plating'], desc: 'Permanent ×1.2 defence.' },
  ],
  medic: [
    { name: 'Heal II (2 targets, 10 HP)', techId: 'advanced_biomed', chain: ['Small Arms', 'Triage', 'Advanced Biomed'], desc: 'Replaces Heal I: heal up to 2 light allies for 10 HP each.' },
    { name: 'Cure (active)', techId: 'advanced_biomed', chain: ['Small Arms', 'Triage', 'Advanced Biomed'], desc: 'Remove all afflicting conditions from a friendly unit (range 1).' },
    { name: 'Tracer Round (active)', techId: 'advanced_biomed', chain: ['Small Arms', 'Triage', 'Advanced Biomed'], desc: 'Tag an enemy: reveals it for 3 turns while in your detection range. (Coming soon.)' },
  ],
  engineer: [
    { name: 'Repair II (2 targets, 8 HP)', techId: 'tactical_engineering', chain: ['Small Arms', 'Engineering', 'Tactical Engineering'], desc: 'Replaces Repair I: repair up to 2 heavy/giant allies for 8 HP each.' },
    { name: 'Build Node (active)', techId: 'tactical_engineering', chain: ['Small Arms', 'Engineering', 'Tactical Engineering'], desc: 'Build a Node buff/debuff structure. (Coming soon.)' },
  ],
};
GATED_UPGRADES['tank_assault'] = GATED_UPGRADES['tank'];

export function abilityDef(id: string): AbilityDef {
  const dash = /^dash_(\d+)$/.exec(id);
  if (dash) {
    const n = Number(dash[1]);
    return { category: 'passive', name: `Dash ${toRoman(n)}`, desc: `After attacking, may move up to ${n} tile${n === 1 ? '' : 's'} (units normally can't move after attacking).` };
  }
  return ABILITY_REGISTRY[id] ?? { category: 'condition', name: id.replace(/_/g, ' '), desc: '' };
}

export function UnitSheet() {
  const { visibleState, selectedUnitId, registry, unitLabels, abilityMode, setAbilityMode, setVolleySelect, setStrikeSelect, setTargetSelect, executeAction, selectUnit } = useGameStore();
  if (!visibleState || selectedUnitId === null) return null;
  const unitCode = unitLabels[selectedUnitId] ?? '';

  const unit = visibleState.units.find(u => u.id === selectedUnitId);
  if (!unit) return null;

  const unitType = registry.unitTypes[unit.typeId];
  if (!unitType) return null;

  const tile = visibleState.map.tiles[unit.position.y][unit.position.x];
  const terrain = registry.terrainTypes[tile.terrain];

  const hpPercent = (unit.hp / unitType.maxHP) * 100;
  const hpColor = hpPercent > 60 ? 'var(--success)' : hpPercent > 30 ? 'var(--warning)' : 'var(--danger)';
  const playerColor = unit.owner === 0 ? 'var(--p0-color)' : 'var(--p1-color)';
  const faction = registry.factions[visibleState.players[unit.owner]?.factionId];

  // Actual defensive multiplier for THIS unit on THIS tile (matches combat exactly).
  // Inside a city the city/walls bonus applies and terrain (e.g. forest) is ignored.
  const defMult = getDefenseMultiplier(tile, terrain, unitType);
  const defenseLabel = tile.fortified
    ? `Fortified City — ${defMult}×`
    : tile.isCity
      ? `City — ${defMult}×`
      : `${terrain?.name ?? 'Unknown'} — ${defMult}×`;

  // Group the unit's named rules into the three display buckets. Conditions +
  // passives are opted-in via `conditions`; active abilities live in `abilities`.
  // Applied statuses (from play, e.g. corrosive_1 / infected) are always conditions.
  // Tech-granted passives (e.g. Adrenal Glands → dash_2/aoi_immune) are folded in so they show.
  // Under fog an enemy's PlayerState is `redacted` (no tech list), so an enemy sheet
  // shows only the unit's baseline kit — what the viewer is actually entitled to know.
  const ownerState = visibleState.players[unit.owner];
  const techsKnown = !!ownerState && !ownerState.redacted;
  const granted = techsKnown ? grantedConditions(ownerState, unit.typeId, registry) : [];
  const inherent = [...(unitType.conditions ?? []), ...granted.filter(g => !(unitType.conditions ?? []).includes(g))];
  const applied = unit.statuses ?? [];
  const conditionIds = [...inherent.filter(id => abilityDef(id).category === 'condition'), ...applied];
  // Positional debuff: standing on an ENEMY's Spray Bile tile (−20% DEF). Derived
  // from the tile (not stored on the unit), and clears when the unit moves off.
  if (tile.bile && tile.bile.owner !== unit.owner) conditionIds.push('bile_enemy');
  const passiveIds = inherent.filter(id => abilityDef(id).category === 'passive');
  // Cast buttons are shown only for the current player's own, still-actionable unit.
  const isOwnActiveUnit = unit.owner === visibleState.currentPlayer && !unit.hasAttacked;

  // Locked upgrades — gated abilities this unit doesn't have yet (own units only).
  const researched = new Set(techsKnown ? ownerState.researchedTechs : []);

  // Tech-gated abilities (e.g. Medic's Slow needs Advanced Biomed) are hidden until
  // researched; superseded ones (e.g. Cure I once Advanced Biomed gives Cure II) are hidden
  // once their upgrade tech is in. Hidden ones appear under "Locked Upgrades" instead.
  // With the owner's techs unknown (redacted enemy), show only the tech-free baseline.
  const abilities = (unitType.abilities ?? []).filter(a =>
    (!a.requiresTech || researched.has(a.requiresTech)) &&
    (!a.supersededByTech || !researched.has(a.supersededByTech)));
  const lockedUpgrades = unit.owner === visibleState.currentPlayer
    ? (GATED_UPGRADES[unit.typeId] ?? []).filter(up => !researched.has(up.techId))
    : [];

  const renderGroup = (title: string, ids: string[], chipClass: string) => {
    if (ids.length === 0) return null;
    return (
      <div className="unit-sheet-traits">
        <span className="stat-label">{title}</span>
        <div className="unit-sheet-trait-list">
          {ids.map((id, i) => {
            const info = abilityDef(id);
            const label = info.effect ? `${info.name} (${info.effect})` : info.name;
            return (
              <span key={`${id}-${i}`} className={`unit-sheet-chip ${chipClass}`}>
                {label}
                {info.desc && <span className="cond-tip">{info.desc}</span>}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="side-panel unit-sheet">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Unit Info</h3>
        <button
          onClick={() => selectUnit(null)}
          title="Close"
          style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px' }}
        >
          ▶
        </button>
      </div>

      <div className="unit-sheet-header">
        <span className="unit-sheet-name">
          {unitCode ? <span className="unit-sheet-code">{unitCode}</span> : null}{unitType.name}
        </span>
        <span className="unit-sheet-owner" style={{ color: playerColor }}>
          {faction?.name ?? `Player ${unit.owner + 1}`}
        </span>
      </div>

      {/* HP */}
      <div className="unit-sheet-hp-section">
        <div className="hp-label">
          <span>HP</span>
          <span>{unit.hp} / {unitType.maxHP}</span>
        </div>
        <div className="hp-bar-track">
          <div className="hp-bar-fill" style={{ width: `${hpPercent}%`, background: hpColor }} />
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-grid-item"><span className="stat-label">Attack</span><span className="stat-value">{unitType.attack}</span></div>
        <div className="stat-grid-item"><span className="stat-label">Defence</span><span className="stat-value">{unitType.defence}</span></div>
        <div className="stat-grid-item"><span className="stat-label">Movement</span><span className="stat-value">{unitType.movement}</span></div>
        <div className="stat-grid-item"><span className="stat-label">Range</span><span className="stat-value">{(unitType.minAttackRange ?? 1) > 1 ? `${unitType.minAttackRange}–${unitType.attackRange}` : unitType.attackRange}</span></div>
        <div className="stat-grid-item"><span className="stat-label">Visibility</span><span className="stat-value">{unitType.visibility}</span></div>
        {unitType.unitClass && (
          <div className="stat-grid-item"><span className="stat-label">Class</span><span className="stat-value" style={{ textTransform: 'capitalize' }}>{unitType.unitClass}</span></div>
        )}
        <div className="stat-grid-item"><span className="stat-label">Cost</span><span className="stat-value">{unitType.cost}g</span></div>
      </div>

      {/* Named rules, grouped by category — hover a chip for its explanation */}
      {renderGroup('Conditions', conditionIds, 'unit-sheet-condition-chip')}

      {/* Tracer / Explosives markers with turns-left (only marks the viewer may see) */}
      {(unit.marks ?? []).length > 0 && (
        <div className="unit-sheet-traits">
          <span className="stat-label">Markers</span>
          <div className="unit-sheet-trait-list">
            {unit.marks!.map((m, i) => (
              <span key={i} className="unit-sheet-chip unit-sheet-condition-chip">
                <span style={{ color: m.kind === 'tracer' ? '#3aa0ff' : '#ff5a5a' }}>●</span>{' '}
                {m.kind === 'tracer' ? 'Tracer Round' : 'Plant Explosives'} {m.turnsLeft}/{m.kind === 'tracer' ? 3 : 2}
                <span className="cond-tip">
                  {m.kind === 'tracer'
                    ? 'A tracer round: reveals this unit’s 3×3 to the enemy who placed it. Removed after its turns run out. Adjacent friendly Detect can remove it (costs an attack/cast).'
                    : 'Planted explosives: detonate for a 5-attack hit when its turns run out. Adjacent friendly Detect can defuse it (costs an attack/cast).'}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Body Slam (Wyrm): its attack is a mandatory 2-cell picker (passive). */}
      {isOwnActiveUnit && inherent.includes('twin_strike') && (
        <div className="unit-sheet-traits">
          <span className="stat-label">Attack</span>
          <div className="unit-sheet-trait-list">
            <button
              type="button"
              className="unit-sheet-chip unit-sheet-active unit-sheet-ability-btn"
              disabled={unit.hasMoved}
              onClick={() => setStrikeSelect({ unitId: unit.id, picks: [] })}
            >
              Body Slam{unit.hasMoved ? ' (moved)' : ' — pick 2 tiles'}
              <span className="cond-tip">{abilityDef('twin_strike').desc}</span>
            </button>
          </div>
        </div>
      )}

      {/* Active abilities — clickable cast buttons for your own actionable unit */}
      {abilities.length > 0 && (
        <div className="unit-sheet-traits">
          <span className="stat-label">Active Abilities</span>
          <div className="unit-sheet-trait-list">
            {abilities.map(a => {
              const info = abilityDef(a.id);
              const cd = unit.abilityCooldowns?.[a.id] ?? 0;
              const disabled = !isOwnActiveUnit || cd > 0 || !!a.disabled;
              const armed = abilityMode?.unitId === unit.id && abilityMode?.abilityId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`unit-sheet-chip unit-sheet-active unit-sheet-ability-btn${armed ? ' armed' : ''}`}
                  disabled={disabled}
                  onClick={() => {
                    if (!a.targetKind) {
                      // Self-cast (e.g. Assault Mode) — no target needed, fire immediately.
                      executeAction({ type: 'useAbility', unitId: unit.id, abilityId: a.id, target: { ...unit.position } });
                    } else if (a.targetKind === 'grid2x2') {
                      // Multi-tile cast (Ballistic Volley) — open the 2×2 tile picker.
                      setVolleySelect({ unitId: unit.id, abilityId: a.id, picks: [] });
                    } else if (a.targetKind === 'units') {
                      // Multi-unit cast (Cure / Repair) — open the target picker.
                      setTargetSelect({ unitId: unit.id, abilityId: a.id, name: a.name, maxTargets: a.maxTargets ?? 1, picks: [] });
                    } else {
                      setAbilityMode(armed ? null : { unitId: unit.id, abilityId: a.id });
                    }
                  }}
                >
                  {a.name}{a.disabled ? ' (soon)' : cd > 0 ? ` (${cd})` : armed ? ' — pick target' : ''}
                  <span className="cond-tip">{info.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {renderGroup('Passive Abilities', passiveIds, 'unit-sheet-passive')}

      {/* Locked upgrades — abilities this unit gains once the required tech is researched */}
      {lockedUpgrades.length > 0 && (
        <div className="unit-sheet-traits">
          <span className="stat-label">Locked Upgrades</span>
          <div className="unit-sheet-trait-list">
            {lockedUpgrades.map(up => (
              <span key={up.techId + up.name} className="unit-sheet-chip unit-sheet-locked-upgrade">
                🔒 {up.name}
                <span className="cond-tip">
                  <b>Requires:</b> {up.chain.join(' › ')}<br />{up.desc}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Traits */}
      {unitType.traits.length > 0 && (
        <div className="unit-sheet-traits">
          <span className="stat-label">Traits</span>
          <div className="unit-sheet-trait-list">
            {unitType.traits.map(t => <span key={t} className="unit-sheet-trait">{t}</span>)}
          </div>
        </div>
      )}

      <div className="unit-sheet-terrain">
        <span className="stat-label">Terrain (def)</span>
        <span className="stat-value">{defenseLabel}</span>
      </div>
      <div className="unit-sheet-terrain">
        <span className="stat-label">Position</span>
        <span className="stat-value">({unit.position.x}, {unit.position.y})</span>
      </div>
    </div>
  );
}
