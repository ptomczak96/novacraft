# Tactica — Development Rationale

A running log of **why** decisions were made — not just *what* changed, but the
reasoning/discussion behind it. Companion to `ECONOMY.md` / `MODULES.md` (which
describe the *current* state); this explains *how we got there*.

**Conventions (see `CLAUDE.md` for the binding rule):**
- **Append-only.** Never overwrite or delete prior entries.
- New entries carry a **date** and **author**. If a decision supersedes an
  earlier one, add a new dated entry noting it supersedes the prior — keep both,
  so two contributors' reasoning and the evolution over time are all preserved.

> The entries below are the **initial batch (2026-06-23)**, reconstructed from the
> design discussion to date. Dated/attributed entries begin after this batch.

---

## Process & collaboration

- **Work is split into modules, not "owned" branches.** Two people (the author +
  brother Patrick) work on separate machines and sync via GitHub. The goal is to
  avoid merge clashes. Key realization: *git branches don't isolate work — files
  do.* Two people clash only when they edit the same lines of the same file.
  → So features get their **own files**, edits to shared files stay small/additive,
  and we sync often. See `MODULES.md`.

- **New feature → new files; cross-references via an overlay.** The economy lives
  in its own `economy.ts` / `economy.json` / `economy.test.ts`, touching shared
  core (`types.ts`, `game.ts`) only with tiny additive hooks. When economy needed
  a per-unit plasma cost, it kept that in *its own* `economy.json` (`unitPlasmaCost`)
  rather than editing the combat module's `units.json`.
  → Avoids the highest-risk clash source (two people editing the same JSON objects).

- **Docs live in the repo so they sync and survive.** Local chat transcripts are
  on one machine only; committing design docs to GitHub is the durable, shared
  backup and the way to inform other sessions/contributors.

## Economy

- **Unit upkeep was explored, then parked (not deleted).** First idea for limiting
  army size was per-turn gold upkeep (economic pressure; bankruptcy → desertion).
  Once we chose Polytopia-style **unit slots** (a hard cap per city), upkeep became
  redundant — real Polytopia has no upkeep. Kept the code dormant
  (`upkeepMultiplier: 0`) rather than throwing it away.
  → Two mechanisms solving the same problem (limit army size) would double-punish;
  the slot cap does the job.

- **Polytopia-style economy chosen.** The author wanted an economy "almost
  identical to Polytopia": cities that produce currency per turn and level up, with
  unit capacity tied to city level.

- **Two resources: ore + plasma** (StarCraft minerals/gas analogy). Ore is the base
  currency for basic units/buildings; plasma is the advanced resource for high-tech
  units/buildings, gated behind tech.

- **`shard` → `ore` rename.** Ore became the primary-resource name. Flagged as a
  *shared-contract* change: mapgen (Patrick's side) must emit `resourceKind: 'ore'`/
  `'plasma'`, and the engine reads it with a safe fallback (untagged resource tiles
  treated as ore) so nothing breaks before mapgen catches up.

- **"pop" vs "supply" — a deliberate terminology split.** These were swapped from an
  earlier draft to match the author's mental model:
  - **pop** = unit *capacity* (how many units a city can support) = level + 1.
  - **supply** = the *leveling currency* accumulated from buildings; crossing
    thresholds raises the city's level (and therefore pop).
  → Getting this vocabulary fixed early prevents confusion across the codebase.

- **Supply thresholds 2 / 5 / 9 / 14 / 20 (incremental +2/+3/+4/+5/+6).** The cost
  to level rises each tier. Reasoning surfaced from the "8 surrounding tiles" math:
  a 3×3 territory can't hold enough basic buildings to reach high levels, so high
  levels must come from *deeper* sources (upgraded mines, refineries), not just more
  mines. This is intentional friction, to be eased later by a future supply building.

- **REBs do two things: produce a resource AND add supply.** Unlike Polytopia (where
  a lone resource building does nothing until it completes a level), our buildings
  generate income immediately *and* contribute to leveling.
  → Splits "income now" from "growth over time" and makes every build meaningful.

- **REB1 vs REB2.** REB1 (mine/extractor) = self output + supply by level. REB2
  (refinery/purifier) = output + supply *per adjacent same-city REB1*, i.e. they
  amplify nearby extraction. REB2 upgrades are pricier/steeper to gate power.

- **TTR (turns-to-return) as a balance lens.** "How many turns until a building pays
  for itself." Used to reason about pacing; TTR rises with building level (2 → 4 → 6)
  so higher tiers pay back slower — throttles snowballing. Tech-gating REB1 upgrades
  is the other throttle.

- **Bug fix — capture makes units stateless.** When a city is captured, the previous
  owner's units homed there have their home-city link cleared, so they don't occupy
  the new owner's unit slots. No stat penalty yet (a penalty for stateless units is
  on the backlog).

- **Bug fix — REB2 is same-city only.** A refinery/purifier counts only adjacent
  REB1s belonging to its own city (cross-city drawing deferred to a future tech).

- **Removed vestigial gold/income config.** The old tile-based income system
  (`cityIncome`, `resourceIncome`, `startingGold`, `calculateIncome`) was replaced by
  city-production income, so it was deleted — "no more mention of gold."

- **Refinery rename + extractor cap removed (latest).** REB2 ore building renamed
  `processor` → `refinery`. The "extractor: max 1 per city" cap was removed — building
  counts should be governed by how many ore/plasma tiles the map spawns, not a hard
  per-city cap.

## Tech

- **Tech = data + a generic modifier system, not code scattered across modules.**
  Tech is cross-cutting (one tech can affect combat, economy, units, pathing). To stop
  it sprawling and causing clashes: the tech tree is *data* (`tech-tree.json`), effects
  are a *small generic vocabulary* read via `getModifier()`, and each module names the
  tech it cares about *in its own data, by string id* (e.g. economy's `techRequired`).
  → **The one rule:** never hardcode a tech id inside a module's logic; always go
  through the generic modifier/unlock check.

- **Old tech tree cleared to start fresh.** The existing 8 techs were mostly inert
  (their modifiers weren't read by any code). Deleted the dead `taxation`/`diplomacy`
  first, then cleared the rest to design a real tree from scratch.

- **6 branches × 3 levels; identical for both teams (for now).** Branches:
  Refinement, Logistics, Intel, Maneuver, Armory, Assault. Teams share the tree
  initially; per-faction tweaks come after testing. (Branch 1 was called "Economy"
  during design, renamed to "Refinement" to avoid confusion with the economy module.)

- **Branch-based prerequisites (for now).** Researching any level-1 tech in a branch
  unlocks all level-2 in that branch; any level-2 unlocks all level-3. Simple to start;
  richer prereqs (e.g. some L3 needs 2 L2) are on the backlog.

- **Tech cost scales with city count (anti-tech-rush).** Polytopia model. Base cost
  L1/L2/L3 = 50/60/70 with one city, +10/+20/+30 per additional city, computed at
  research time. → Prevents rushing tech; expanding makes future tech pricier
  (a deliberate tradeoff between expansion and research).

---

## Dated entries

### 2026-06-23 — Artisan Ornaments — tech system + Refinement branch (L1–L2)

- **Built the tech engine.** `TechDef` now carries `branch` + `level` (flat
  `cost` removed — cost is derived). New `tech-config.json` holds the cost curve
  (base 50/60/70 by level, +10/+20/+30 per extra city). New `engine/src/tech.ts`
  module owns `getModifier` (moved out of game.ts so all modules share one reader),
  `techCost`, and `isTechAvailable` (the branch-unlock rule: any L(n-1) in a branch
  unlocks all L(n)). *Why:* implement the confirmed framework while keeping tech as
  data + generic modifiers so it doesn't cross-cut into other modules.
- **Refinement branch (L1–L2).** Drilling, Prospecting (L1); Slag Wash, Plasma Tap,
  Refineries (L2). *Gating is owned by the economy data*, not tech code: mine's
  `upgradeTechRequired`, extractor's & refinery's `techRequired` name the tech ids —
  no tech id is hardcoded in economy logic. Slag Wash is a `mineOutputBonus` modifier
  the economy reads. L3 deferred for beta.
- **Prospecting scaffolded only.** Its reveal effect lives in fog/mapgen (Patrick's
  module) and fog is off; logged to `docs/overlap.md` for him to wire later.
- **Branch 1 renamed Economy → Refinement** to avoid confusion with the economy module.

### 2026-06-23 — Artisan Ornaments — Armory branch (tech scaffolding only)

- **Armory is mostly Patrick's module.** Of 9 techs, 8 unlock units or combat
  mechanics (Combat & units); only Replicator is economy. *Decision:* the economy/
  tech branch builds only the **tech scaffolding** (entries, unlock gates, generic
  combat modifiers as data); Patrick implements the combat/unit/status/fog guts from
  `docs/overlap.md`. Keeps tech non-cross-cutting.
- **Unit-unlock mechanism wired.** A unit is recruitable unless a tech `unlockUnit`
  effect names it and that tech is unresearched (Warrior/Scout stay always-available).
  Small Arms→Marksman, Triage→Medic, Forge→Tank, Mech Bay→Stalker. The units don't
  exist in `units.json` yet (Patrick), so they're simply unbuildable until added —
  forward-compatible.
- **Combat bonuses as generic modifiers** (`focusFireBonus`, `assaultRangeBonus`,
  `heavyDefenceBonus`) — data only; combat reads them via getModifier when built.
- **Locked/preview techs.** Added `TechDef.locked`; the engine never offers locked
  techs for research. The three Armory L3s (Reactive Plating, Tracer Rounds,
  Replicator) are locked previews — *why:* the user wants the full tree visible but
  these gated until their (heavy) implementations exist. UI greying logged to overlap.
- **Replicator deferred** to a dedicated task (first timed-construction + first
  out-of-city unit production) — backlog, not built.
- **Armory L1/L2 left researchable despite being inert for now** (decision: leave
  as-is; Patrick will plug in the units + stats shortly). Known side effect: greedy
  self-play sims go drawish because the bot wastes ore researching not-yet-implemented
  Armory techs — a bot artifact, not an engine bug (36 tests pass, determinism holds).
  Resolves once Patrick wires the units/effects.

### 2026-06-27 — Artisan Ornaments — map distributions (ruins, ore, plasma)

The map's ruin/resource generation, now locked in (mapgen.ts):

- **Territory spacing.** Every city/ruin owns a **3×3 territory** and territories
  **never overlap** — the minimum centre-to-centre distance is **3** (the two 3×3
  squares just touching). New ruins target a centre distance of **3 / 4 / 5** from
  the nearest existing centre, weighted **25 / 50 / 25**, and fill the map at that
  spacing (emergent count). *Why:* the whole pop/supply economy assumes one tile
  belongs to exactly one city, so overlapping territories are disallowed.
- **Per-capital resources** (unchanged): **2 ore + 1 plasma** vent in the capital's
  territory.
- **Ruin ore:** number of ore tiles in a ruin's territory = **0/1/2/3/4** with
  weights **10/20/50/25/5**. (Those sum to 110, so they're applied as *relative
  weights*, normalised — preserving the intended shape: mostly 2 ore.)
- **Ruin plasma:** plasma vents in a ruin's territory = **0/1/2** with weights
  **35/50/15**.

All generation is deterministic via the map PRNG (same seed → identical map).

### 2026-06-27 — Artisan Ornaments — territory ownership & resource capture

- **Founded cities claim their full 3×3 territory** (ownership only — terrain and
  resources preserved), matching capitals. Previously only the centre tile was
  owned, so the red territory border rendered as a single square.
- **Removed lone-resource capture on move.** Stepping a unit onto a resource tile
  no longer sets ownership. *Why:* it was leftover from the old tile-income economy
  and now only drew a stray 1-tile territory border. Resources are owned by being
  inside a city's claimed territory, not by standing on them.

### 2026-06-27 — Artisan Ornaments — melee advance & delayed city capture

- **Melee advance on kill.** A melee unit (attackRange 1) that kills its target
  moves onto the target's tile (Polytopia-style). Ranged units don't advance.
- **City capture is no longer instant.** Moving onto an enemy/neutral city no
  longer captures it. Instead, a unit standing on an enemy city can capture it via
  an explicit `captureCity` action — but only when it *didn't move onto the city
  that turn* (eligibility = on enemy city AND `!hasMoved`), so capture becomes
  available the **following** turn. In the UI, selecting the unit shows a
  "Capture City?" box. Capturing transfers the city, its 3×3 territory, and its
  buildings to the captor (buildings keep their cityId, so output follows the new
  owner); the previous owner's units homed there go stateless.
  *Tech-on-capture handling is deferred — see the memory backlog.*

### 2026-06-27 — Artisan Ornaments — per-city recruiting & scroll-zoom

- **Per-city recruiting.** Recruiting is now city-specific: click an owned city to
  select it, then a "Recruit" button + menu appear, and the unit you build belongs
  to (and counts against the pop of) *that* city. Replaces the single global recruit
  button that didn't let you choose the city.
- **Scroll-to-zoom.** Mouse wheel zooms the board (CSS transform; clicking stays
  accurate via the on-screen bounding box). Out-capped so a small map can't shrink
  away; in-capped at ~a handful of tiles. (Pan-while-zoomed is a follow-up.)

### 2026-06-28 — Artisan Ornaments — scattered resources, starting ore, mine costs

- **Resources now sprinkle OUTSIDE the 3×3 territories**, not just on the perimeter
  of cities/ruins. Density ≈ 66% of a city 3×3 (a city places ~3 resources across 8
  perimeter tiles, so `sprinkleP = 0.66 × 3/8 ≈ 0.2475` per eligible off-territory
  tile), mix ~2:1 ore:plasma to match capitals. *Why:* cities will gain border
  expansion later, so there should already be something worth claiming nearby. The
  pass runs after city/ruin placement, skips any tile inside a territory
  (`minDistTo ≤ 1`), and threads the same PRNG so maps stay deterministic.
- **Starting ore per team: 0 → 20.** Gives a small opening buffer so the first
  mine (now pricier — see below) isn't an impossibly slow first build.
- **Mine build/upgrade cost: 20/40/60 → 50/70/90 (L1/L2/L3).** *Why:* the old scale
  made mines almost free relative to their payback; raising it lengthens TTR into a
  more deliberate range. **TTR** (cost ÷ marginal output/turn): L1 = 50/10 = **5**,
  L2 = 70/10 = **7**, L3 = 90/10 = **9** (was 2/4/6). Extractor cost left at 20/40/60
  for now — a deliberate asymmetry to revisit, flagged in ECONOMY.md.

### 2026-06-28 — Artisan Ornaments — extractor↔mine symmetry & supply retune

- **Extractor now mirrors the mine** on cost (50/70/90, TTR 5/7/9) and output
  (+10/20/30). Previously the extractor was on the old cheap 20/40/60 scale; making
  the two REB1s symmetric keeps ore and plasma extraction on equal economic footing.
- **Supply retuned** (a building's total leveling contribution at each level):
  mine = **1/2/4**, extractor = **2/3/4** (was 1/3/6 for both). Plasma extraction
  pulls slightly more weight per building toward city leveling than ore does.
- **Extractor tech gate removed.** It was gated behind `plasma_tap` (a refinement L2
  tech with empty effects), which — via the branch-unlock rule — made extractors
  effectively unbuildable in normal play ("can't build on a plasma vent"). Dropped
  the gate so an extractor builds on any owned plasma vent just like a mine on ore.
  `plasma_tap` is left in the tree as an inert/repurposable tech.

This is part of the larger **city-levels** work kicked off this session; subsequent
entries will cover the leveling modal, bonuses (income/pop/fortify/supply/reveal),
and territory expansion as each lands.

### 2026-06-28 — Artisan Ornaments — city info card (pop & supply readout)

- **Clicking any city** (owned, enemy, or neutral) now selects it and shows a small
  info card: **Population** 🧍 `used/max` and **Supply** 🏭 `current/needed`. Owned
  empty cities still get the recruit panel as before. Enemy/neutral pop counts are
  best-effort under fog (only visible homed units are counted) — acceptable for a
  readout; revisit if fog hides too much.
- **Supply is shown as a per-level counter that resets each level**, even though the
  stored `supply` is cumulative. New engine helper `citySupplyProgress(city)` returns
  `{current, needed, atMax}` where `current = supply − thisLevelThreshold` and
  `needed = nextThreshold − thisLevelThreshold`. This is why the existing cumulative
  thresholds `[2,5,9,14,20]` already encode the requested per-level costs 2/3/4/5/6:
  an L1 city shows 0/2→2/2, then 0/3 at L2, 0/4 at L3, etc. No data change needed —
  the reset is purely a display transform. (Leveling is still auto-derived from
  supply here; the choice-driven level-up modal is the next group.)

### 2026-06-28 — Artisan Ornaments — found-city turn delay (matches capture)

- **Founding a city now requires the unit to NOT have moved this turn** — i.e. you
  can only found on the turn *after* moving onto a ruin, identical to the existing
  city-capture rule. `canFoundCity` now finds the unit on the ruin and rejects if
  `unit.hasMoved`. Applying a found also sets the founder's `hasMoved` (founding
  consumes the unit's turn, so it can't found-then-move-away). *Why:* consistency —
  both "take this tile's settlement" actions (found, capture) should cost a turn of
  standing still, preventing move-and-claim in a single turn. UI needs no change:
  the on-canvas "Found City" box is driven by legal actions, so it now only appears
  the following turn automatically.

### 2026-06-28 — Artisan Ornaments — choice-based city leveling + level-up modal

- **Leveling is no longer automatic.** Previously `recomputeCities` derived a city's
  level straight from its supply. Now level only advances via a new **`levelUpCity`**
  action: when supply crosses the next threshold, `getLegalActions` offers the two
  rewards for that level, the "Congratulations" modal pops on the human's turn, and
  the player's pick both raises the level and applies the reward. *Why:* the design
  calls for a meaningful choice at each level, which a pure derivation can't express.
  `recomputeCities` now only recomputes `supply`; it never touches `level`.
- **New capture-invariant city fields:** `incomeBonus`, `popBonus`, `bonusSupply`,
  `fortified`. They live on `CityState`, so capture (which only flips `owner`)
  preserves them — satisfying "a city's economic value never changes when captured,
  it just transfers." `cityProduction` adds `incomeBonus`; `cityPop` adds `popBonus`;
  `recomputeCities` seeds supply from `bonusSupply`.
- **Rewards:** L2 → +30 income **or** +1 pop; L3 → Fortify **or** Reveal map; L4 →
  +3 supply **or** Expand territory. The three economy-pure rewards (income, pop,
  supply) and the **fortified** flag are wired now. **Reveal map** (needs fog) and
  **Expand territory** (needs the tile-picker UI) are deferred to their own groups and
  shown disabled in the modal. The fortify *combat* effect (×1.5 defence inside a
  fortified city) is handed to the combat module via `docs/overlap.md`.
- **Level cap at L4 for now** (`LEVEL_CHOICE_MAX = 4`): only L2–L4 rewards are
  designed. economy.json still says maxLevel 6, but the choice system stops at 4 and
  `citySupplyProgress` reports "MAX" there. L5/L6 reward design is a backlog item.
- **Supply display resets per level** (`citySupplyProgress`) even though stored supply
  is cumulative — see the prior 2026-06-28 city-info-card entry; the same helper now
  also bounds at the L4 cap.

### 2026-06-28 — Artisan Ornaments — territory expansion (L4 reward) + anti-snake rule

- **The L4 "Expand territory" reward is now live.** Choosing it opens a tile-picker:
  the player ticks 3 open tiles, and **Confirm** dispatches the new `expandTerritory`
  action which both levels the city to 4 and claims the tiles. Routing it through its
  own action (rather than `levelUpCity('territory')`) means cancelling the picker
  leaves the city un-levelled, so the player can still pick a different reward. Claimed
  tiles are **full territory** (buildable, owned, inside the border) — chosen over
  ownership-only so "borders expand" actually opens new build sites.
- **Anti-snake rule.** A candidate tile is eligible only if **≥2 of its 8 neighbours
  are already owned** by the city (base 3×3 + previous expansions + tiles ticked so
  far this turn). *Why:* without it, players could lay a single-tile-wide "pole" of
  territory snaking across the map to grab a distant resource — the ≥2 rule forces
  growth to stay blob-like and contiguous. Validation (`validateExpansion`) is
  order-independent: it greedily checks that *some* placement order exists, so the UI
  can accept ticks in any sequence. Expanded tiles are stored on `city.extraTerritory`
  and are capture-invariant; `territoryCityAt`/border rendering consult them.
- **Future faction idea logged** (per request): one faction could be allowed to expand
  in a **snakelike pattern** (bypassing the ≥2 rule) as a late-game economic
  powerhouse identity — see the economy backlog. It's an intentional asymmetry idea,
  not yet a decision.

### 2026-06-28 — Artisan Ornaments — Fortify wired into combat (stacks ×1.5 on cities)

- **Fortify (L3 reward) now applies its defence bonus in `combat.ts`.** Discovery
  that drove the design: `getDefenseMultiplier` *already* returns ×1.5 for **any**
  city tile, so a literal "Fortify = ×1.5" would be a no-op. To make Fortify a real
  upgrade, it **stacks** an extra `FORTIFY_MULTIPLIER = 1.5` on top of the base city
  ×1.5 → a fortified city gives **×2.25** to the defender's force. Flagged to the user;
  easily retuned via the one constant.
- **Wiring:** `city.fortified` (canonical, capture-invariant) is mirrored onto the
  city-centre `tile.fortified` when Fortify is chosen; combat is tile-based and reads
  `tile.fortified`, so no need to thread the city list into the combat module. "Inside
  the city" = standing on the **centre tile**. Implemented by the economy side directly
  since Patrick had no in-flight combat work (overlap entry moved to Done).
- **Reveal Map** stays disabled ("coming soon") pending fog of war, which is the next
  thing to be built.

### 2026-06-28 — Artisan Ornaments — fog of war + unit "visibility" stat

- **Unit `visibility` stat (renamed from `sightRange`).** Each unit has a `visibility`
  radius read only when fog is on: **0** = own tile only, **1** = 3×3, **2** = 5×5, …
  i.e. a **Chebyshev (square)** radius — changed from the old Manhattan/diamond reveal
  so "a 5×5 square around it" is literally a square. All existing units set to **1**.
  (Renamed the field rather than adding a second one, to avoid two competing sight
  concepts.)
- **Three tile states — the agreed vocabulary (commit-to-rationale):**
  - **Cloud tile** = never seen (`'hidden'`). Rendered as a white tile (placeholder
    for Patrick's cloud sprite). Hides everything beneath.
  - **Fog tile** = seen before but not currently in sight (`'explored'`). Greyed; you
    still see the **terrain and structures** as last known (enemy cities, REBs) but
    **NOT enemy units** — those appear only while a tile is currently visible.
  - **Visible** = currently within the visibility of one of your units or cities.
- **A city's whole territory is always visible to its owner** (base 3×3 + claimed
  extra tiles) — "territory of a city" counts as seen.
- **Persistent discovery.** Added `GameState.explored[playerId][y][x]` (serialized
  fog memory). `computeVisibility` returns only *current* sight; `getVisibleState`
  overlays `explored` to decide cloud vs fog. `applyAction` refreshes the acting
  player's (and, after endTurn, the next player's) explored grid; `createGame` seeds
  it from each player's opening sight. *Why store it in GameState:* it must persist
  across turns and survive save/load, and it keeps the engine the single source of
  truth (the previous `computeVisibility` had a `previousVisibility` param that was
  never passed, so fog memory didn't actually persist).
- **Enemy units filtered in `getVisibleState`** — shown only on currently-`visible`
  tiles, so a fog tile keeps its last-known terrain/buildings but never leaks live
  enemy unit positions. Territory borders are also suppressed under cloud.
- **Fog turned ON by default** (`config.json fogOfWar: true`); still toggleable on the
  setup screen, and sims/tests run with it off.
- *Known simplification:* fog tiles show **current** buildings/cities, not a true
  last-seen snapshot (a building added after you left would still show). Acceptable
  for now; a snapshot is a possible future refinement.

### 2026-06-28 — Artisan Ornaments — fog shows true last-seen snapshot + capital 5×5

*Supersedes the "known simplification" in the previous fog entry (which showed
current buildings under fog).* Fog tiles now show a **frozen last-seen snapshot**, not
live truth:

- **Per-player `GameState.memory`** (replaces the boolean `explored` grid). Each
  `PlayerMemory` holds the last-seen `tiles[y][x]` (null = never seen → cloud), plus
  last-seen `buildings` and `cities` by position. `recordSight` snapshots everything
  currently visible into memory each action; out-of-sight memory is never touched.
- **`getVisibleState` composes the view**: visible tiles use live truth; fog tiles use
  the memory snapshot (terrain, resources, buildings, city owner/level as last seen);
  cloud tiles render nothing. *Result:* a building destroyed, a city captured, or a REB
  built while you're not looking does **not** update under fog — you see it as you left
  it. Enemy **units** are still never remembered (shown only while currently visible),
  so fog never leaks live positions. The renderer is unchanged — it just draws the
  composed `visibleState`.
- **Capital reveals 5×5** by default: new `economy.json city.capitalSightRadius = 2`
  (a normal city still reveals its `territoryRadius`). Wired through schema + type so
  it stays a data tuning value.
- *Trade-off:* memory is a full per-player snapshot in `GameState` (more state, more
  per-action cloning), accepted because it's the only way to honour "you don't see
  changes under fog" and it survives save/load deterministically.

### 2026-06-28 — Artisan Ornaments — drop "eliminate all units" win condition

- **Removed the "Win: Eliminate All Units" toggle from the setup menu** and defaulted
  `config.json winConditions.eliminateAllUnits` to **false**. *Why:* losing your last
  unit ending the game makes no sense once a side can hold multiple cities and simply
  recruit more defenders — a momentary unit wipe shouldn't be game over. Termination is
  covered by **capture-all-cities** (a player with no cities has truly lost) and
  **highest-score-at-turn-limit**.
- The engine check (`checkWinConditions`) still honours the flag if anyone sets it in
  data, so the capability isn't deleted — just off by default and no longer surfaced in
  the UI. (Also removes the old "elimination win fires when an enemy's only unit dies"
  foot-gun seen earlier in testing.)

---

*Deferred ideas (the "we'll tweak this later" items) live in the memory backlog,
surfaced on request — they are design intentions, not yet decisions.*
