# Tactica — Cross-Module Overlap Log

Hand-off log for work that crosses module boundaries: when a change in one
contributor's module needs work, correction, or wiring in **another**
contributor's module, it's recorded here so the other owner can pick it up.

Triggered by saying **"commit to overlap"** (see `CLAUDE.md`). Append-only; each
entry is dated, attributed, and stays under **Open** until the owning module
marks it **Done**.

Format per entry: **[date] — author → affected module** · what / how / why / status

---

## Open

### 2026-06-28 — factions → Graphics / units (Patrick)
**Two new teams: Vanguard & Hive.** Replaced the old Ironclad Dominion / Sylvan
Accord with two factions selectable for both players in the setup menu:
- **Vanguard** (`id: "vanguard"`, colour `#3d7bb5`) — StarCraft-Terran style: humans,
  AI, robotics, tanks. Tech/industrial look.
- **Hive** (`id: "hive"`, colour `#8a4fa0`) — organic / swarm style (Zerg-ish).

**For Patrick:** unit **sprites/portraits per faction** when art is ready. New units
needing art: Vanguard **Lancer** (`lancer`); Hive **Scuttling** (`scuttling`, spawns in
pairs) and Hive **Scout** (`hive_scout`). NOTE: the rosters are still partly the *old
shared units reused* for both teams (we'll redesign units slowly). Some units now have
a `unitClass` ("light"), `conditions` (see `docs/conditions.md`), and pop/recruit
fields (`popCost`, `recruitCount`). Unit **ids still carry the old prefixes** (`ironclad_berserker`,
`ironclad_siege_tower`, `sylvan_ranger`, `sylvan_treant`) — those are just string ids
for now; renaming them is a later, deliberate step (touches economy.json upkeep keys,
UNIT_ICONS, etc.). The `faction` field on each unit and the faction `unitTypes` lists
are already repointed to vanguard/hive. **Status:** OPEN — awaiting art + unit redesign.

### 2026-06-28 — fog of war → Graphics (Patrick)
**Cloud & fog tile graphics.** Fog of war is now implemented and ON by default.
Tiles have three render states (in `apps/web/src/iso`):
- **Cloud** (`visibility === 'hidden'`, never discovered) — currently a flat **white
  diamond** drawn by `drawCloud()` in `drawOverlays.ts`. **Please replace with a
  painted "cloud" tile sprite.** It must fully hide terrain/structures beneath.
- **Fog** (`visibility === 'explored'`, seen before, not currently in sight) — a grey
  overlay (`drawFogExplored()` → `FOG_EXPLORED_OVERLAY`) drawn over the last-known
  terrain & buildings. Could be given a translucent fog texture if desired.
- **Visible** — full colour, no overlay.

The engine already supplies the per-tile state in `visibleState.visibility[y][x]`;
only the *art* for cloud (and optionally fog) is the open item. **Status:** OPEN.

### 2026-06-23 — economy → Map gen / fog-of-war (Patrick)
**Tech: Prospecting (Refinement branch, L1).**
- **What:** Prospecting reveals all resource tiles (ore outcrops, plasma vents)
  within **4 tiles (Chebyshev) of each of the player's cities** — but does **not**
  reveal a tile if an **opponent's REB** is built on it.
- **How (suggested):** the tech carries a generic effect `revealResourcesRange: 4`.
  The fog/visibility code (`computeVisibility` / `getVisibleState`) should, for the
  owning player, mark resource tiles within that range of owned cities as visible,
  excluding tiles occupied by an enemy building.
- **Why:** the economy branch scaffolds the tech (it exists, is researchable, and
  carries the effect), but the actual revealing lives in the **fog system**, which
  is Patrick's module. Fog is currently OFF (`config.fogOfWar: false`), so this is
  inert until fog is enabled.
- **Status:** OPEN — awaiting fog wiring on the Map gen side.

### 2026-06-23 — tech (Armory branch) → Combat & units (Patrick)
The Armory tech tree unlocks units and combat mechanics that live in Patrick's
module. The tech branch scaffolds the gates/effects; the guts below are his.

**New units for `units.json` (stats left BLANK — Patrick to fill HP / move / attack /
defence / range / sight, plus the noted abilities):**
- **Marksman** — light, ranged. (unlocked by Small Arms)
- **Medic** — light. Ability: heal a friendly unit; remove certain statuses (e.g. Trace). (Triage)
- **Tank** — heavy. Supports "assault mode" (see Advanced Projectiles). (Forge)
- **Stalker** — heavy. Has the Tracer Rounds action (see below). (Mech Bay)

**Combat / status / fog mechanics:**
- **Combined Arms (L1):** focus fire — when 2+ of a player's units hit the same
  target in one turn, the 2nd/3rd/4th… hit each deals **+10%** damage (per-shot
  bonus, NOT cumulative). The tech exposes a `focusFireBonus` modifier; combat
  applies it during attack resolution.
- **Advanced Projectiles (L2):** Tank "assault mode" gives **+1 attack range**.
  Switching into or out of assault mode costs a full turn (can't move/attack that
  turn). Needs a per-unit mode flag (new unit state) + combat range read. Tech
  exposes `assaultRangeBonus`.
- **Reactive Plating (L3):** Tanks & Mechs get **+10% defence**. Tech exposes
  `heavyDefenceBonus`; combat applies it to those unit types.
- **Tracer Rounds (L3):** a Stalker action **separate from attack** that applies
  **Trace** to a target. A traced unit's **position** (not its FOV) is visible to
  the enemy; works on cloaked units once revealed and persists as they move; can be
  attacked by normal units. Trace can be healed (TBD). Needs: a new action, a status
  effect, and a **fog/visibility** hook.

**Tech-side (already on the economy/tech branch, no action needed from Patrick):**
the techs exist + research + branch-unlock; unit unlocks are via tech `unlockUnit`
effects; the `*Bonus` modifiers are read via `getModifier(...)`.

**Current state / expected quirk:** the Armory L1/L2 techs are *researchable but
inert* until you wire the units + effects — researching them currently does nothing.
Side effect: greedy **self-play sims go drawish** (the bot wastes ore researching
these no-payoff techs and under-builds units). This is a bot artifact, **not an
engine bug** — 36 tests pass and determinism holds. It resolves as you implement
the units/effects. (Decision: leave L1/L2 researchable for now rather than locking
the branch.)

**Status:** OPEN — awaiting units + combat/status/fog work on the Combat & units side.

### 2026-06-23 — tech → UI (tech-tree view)
**Locked / preview techs.** Some techs carry `"locked": true` (currently the three
Armory L3s: Reactive Plating, Tracer Rounds, Replicator). They are NOT researchable
yet (the engine blocks them). When the tech-tree UI is built, it should still **show**
these techs but render them **greyed out / disabled**, clearly labelled as a locked
preview ("for show, not yet available"). Read the flag from `tech.locked`.
**Status:** OPEN — awaiting the tech-tree UI.

## Done

### 2026-06-28 — economy (city levels) → Combat (self-resolved)
**Fortified cities give a defensive bonus.** The L3 "Fortify" reward now works end
to end. Implemented directly in `combat.ts` (Patrick had no in-flight combat work,
so no hand-off needed). Design: economy mirrors `city.fortified` onto the city-centre
`tile.fortified`; `combat.ts getDefenseMultiplier` reads the tile and applies an
extra `FORTIFY_MULTIPLIER = 1.5` **on top of** the base city ×1.5 → fortified city =
**×2.25** to the defender's force. "Inside" = the **city centre tile** (where the unit
stands). Tunable via the `FORTIFY_MULTIPLIER` constant. **Status:** DONE.
