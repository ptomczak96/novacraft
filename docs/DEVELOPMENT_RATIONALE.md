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

### 2026-06-28 — Artisan Ornaments — founder/capturer re-homes to the new city

- **A unit that founds or captures a city becomes homed at that city**, freeing the
  pop slot at its original home. `applyFoundCity` sets `unitHomeCity[founder] = newCity`;
  `applyCaptureCity` sets `unitHomeCity[capturer] = capturedCity` (after the loop that
  releases the *previous* owner's units homed there, so it isn't wiped). *Why:* the
  unit now lives at/garrisons the new city, so its upkeep-of-pop should count there,
  not back at the city it was recruited in — otherwise founding/capturing wouldn't free
  capacity to recruit a replacement at the origin city. Also re-homes a previously
  stateless unit (e.g. one whose home was captured) onto the city it takes.
- Consequence for the prior capture test: the captured city now reports **1** unit
  homed (the capturer) rather than 0; the enemy's released ghost is still gone.

### 2026-06-28 — Artisan Ornaments — two teams: Vanguard & Hive

- **Replaced Ironclad Dominion / Sylvan Accord with Vanguard & Hive.** New faction ids
  `vanguard` (Terran/industrial, `#3d7bb5`) and `hive` (organic/swarm, `#8a4fa0`),
  selectable for both players in the setup menu. *Direction:* Vanguard = humans/AI/
  robotics/tanks; Hive = swarm. Unit **rosters are unchanged for now** — the same
  shared + ex-Ironclad/ex-Sylvan units are reused under the renamed factions, to be
  redesigned slowly.
- **Unit ids kept** (`ironclad_berserker`, etc.) deliberately — they're just string
  ids; renaming them later avoids a churny multi-file rename (economy upkeep keys,
  UI icon maps) right now. The unit `faction` fields and faction `unitTypes` lists were
  repointed to vanguard/hive; all `'ironclad'`/`'sylvan'` faction-id references across
  tests/sim/store/setup were updated. Graphics + unit redesign handed to Patrick via
  `docs/overlap.md`.

### 2026-06-28 — Artisan Ornaments — combat audited against canonical spec

Audited the combat code against a provided Polytopia-style spec and corrected two
things; *supersedes the earlier Fortify ×2.25 entry.*

- **Retaliation formula fixed to canonical `defenseResult`.** The old code modelled
  retaliation as a *fresh counter-attack* (defender's ATTACK vs attacker's DEFENSE,
  using the defender's post-damage HP). The spec (and real Polytopia) instead derives
  BOTH results from a single force split using pre-damage HP:
  `attackResult = round((attackForce/total)·A.attack·4.5)`,
  `defenseResult = round((defenseForce/total)·D.defense·4.5)`. Retaliation is now
  `defenseResult` — driven by the **defender's DEFENSE**, not its attack. New
  `computeForces()` returns both; `resolveCombat` applies attack, then retaliation
  unless the defender died, the attacker is outside the defender's range, **or
  defenseResult rounds to 0**. Attack damage is unchanged (same formula); retaliation
  numbers change (generally smaller, defense-based).
- **Fortify = ×3 ("walls").** Per decision, a unit in a **fortified** city gets ×3
  defense force (it represents walls — there is no wall-building action). This
  **replaces** the previous "city ×1.5, fortify stacks to ×2.25" model: a normal city
  now grants **no** inherent defense bonus (only its terrain), and Fortify is a flat
  ×3 (not stacked with terrain). `FORTIFY_DEFENSE_MULTIPLIER = 3.0` in combat.ts.
- **Kept:** deterministic, integer, round-half-up at the final step; HP scaling; melee
  move-on-kill; ranged-no-retaliation. Attack keeps a `minimumDamage` floor (house
  rule beyond the spec) so a hit always lands; retaliation honours the spec's
  rounds-to-0 skip.
- **Deferred (spec features needing systems we haven't built):** splash, healing
  action, veteran promotion, BOOST, POISON/PLAGUE (def ×0.7 + forced bonus 1.0), ACID/
  armor-strip, STIFF/SURPRISE skills, and stealth-based retaliation skip. Also noted:
  terrain bonus is a flat ×1.5 for any `defenceBonus > 0` (magnitudes unused), and
  `retaliationMultiplier`/`damageVariance`/`hpScaling` config fields remain inert.

### 2026-06-28 — Artisan Ornaments — Vanguard unit pass + special-conditions system

- **Non-fortified city defense restored to ×1.5.** A plain city tile gives ×1.5
  again; fortified stays ×3. (Adjusts the prior "no inherent city bonus" decision.)
- **Vanguard unit stats** (warrior/scout are still shared rosters for now, so these
  apply to both teams until rosters split): **Warrior** → cost 20, HP 10, atk 2, def 2,
  mov 1, rng 1, vis 1, class "light". **Scout** → cost 30, HP 10, atk 0.5, def 2,
  mov 1, rng 1, vis 2, class "light", conditions [mountain_restricted, optics]. New
  **Lancer** (Vanguard) → cost 50, HP 15, atk 2, def 1, mov 1, rng 2, vis 1, light, no
  conditions. Stats now allow decimals (atk 0.5); combat already rounds at the end.
- **New `unitClass` + `conditions` fields** on unit types (both optional). `unitClass`
  is flavour/grouping ("light"); `conditions` is a list of named special rules.
- **Special-conditions system** (`docs/conditions.md`): a reusable, documented registry
  of named conditions a unit opts into via its `conditions` array; the engine applies
  the effect by id. First two:
  - **`mountain_restricted`** — can't move onto mountains (enforced in `pathfinding.ts`).
  - **`optics`** — mountains block the unit's line of sight (sees the mountain, not
    past it), orthogonally and diagonally (enforced in `fog.ts` via a `mountainsBlock`
    flag on the bresenham LOS; the endpoint is never the blocker).
  *Why a separate system from `traits`:* traits are baked-in movement/terrain flags;
  conditions are the named, documented, designer-facing rules tracked in one file.

### 2026-06-29 — Artisan Ornaments — Hive units: Scuttling + Hive Scout

- **Hive roster:** dropped Warrior and the shared Scout; added **Scuttling** and a
  Hive-specific **Scout** (`hive_scout`). Vanguard keeps the shared warrior/scout.
- **Scuttling** (cost 20, HP 10, atk 2, def 0, mov 1, rng 1, vis 0, light) is **created
  in pairs** and counts **0.5 pop each** (a pair = 1 pop; a lone survivor rounds up to
  1). New unit fields `recruitCount` (2) and `popCost` (0.5). Pairs spawn on **random
  passable territory tiles** (not the centre), picked via the game PRNG so it stays
  deterministic. Pop accounting is now weighted: `cityPopRaw` (Σ popCost) and
  `cityPopUsed` = `ceil(raw)`; capacity checks use `cityHasCapacityFor(addedPop)`.
  Conditions: **`sacrificial_founder`** (dies when founding a city) and **`blind`**.
- **`blind`** (vis 0): reveals only its own tile but may move into cloud/fog; the UI
  highlights a selected blind unit's move targets on cloud tiles.
- **Bump (now implemented).** A blind unit moving onto a tile with a hidden enemy
  **stays put**, reveals the tile + enemy for the turn, and may attack or stand. Chosen
  design (per the user): the unit does NOT move; the bumped tile enters fog memory
  (terrain persists) and the enemy shows only this turn. New `GameState.revealedTiles`
  (per-player, cleared in `applyEndTurn`) carries the temporary unit reveal;
  `pathfinding.ts` gains a `bumpEnemies` flag so blind units can *target* enemy tiles
  (without pathing through them); `applyMove` detects the bump; `getVisibleState` shows
  enemies on revealed tiles.
- **Hive Scout** (cost 20, HP 15, atk 0.5, def 1, mov 2, rng 1, light) has
  **`squinting_eyes_2`**: 3×3 fully visible, the surrounding 5×5 ring as **fog**
  (terrain/buildings, no enemy units) — the "1.5 visibility". Implemented by giving
  fog reveals a *level* (`visible` vs `explored`) with precedence; `recordSight` now
  snapshots fog tiles too, so squint-fog shows structures but never live enemy units.
- **City defense ×1.5 for a plain (un-fortified) city restored** earlier this session
  stands; nothing changed here.

### 2026-06-29 — Artisan Ornaments — condition: Impotent Founder

- New condition **`impotent_founder`** — the unit cannot found cities (`canFoundCity`
  returns false when the unit on the ruin has it). Assigned to **both teams' scouts**
  (`scout`, `hive_scout`) so recon units can't also settle. Documented in
  `docs/conditions.md`.

### 2026-06-29 — Artisan Ornaments — fog/LOS, bump highlight, combat-log stats

- **Vision is now a clean square; only Optics-mountains block.** Removed the general
  `blocksSight` (forest) line-of-sight blocking that was randomly hiding tiles inside a
  scout's 5×5. `hasLineOfSight` returns true immediately unless `mountainsBlock`
  (Optics), in which case only **mountains** block (forests no longer do).
- **Bump move highlight** on cloud tiles now draws flat (elevation 0) so the blue
  diamond sits on the white cloud instead of floating at the hidden terrain's height.
  (The bump action itself was already correct — its engine test passes; the in-browser
  symptom was a stale dev bundle + the misaligned highlight.)
- **Combat log** gained an attacker-vs-defender **stats block** (⚔ attack / 🛡 defence /
  ♥ HP for both) above the existing force/damage breakdown.

### 2026-06-29 — Artisan Ornaments — rename condition `optics` → `low_horizons`

- Renamed the special condition **`optics` → `low_horizons`** ("Low Horizons") — same
  effect (mountains block the unit's line of sight). Updated the unit data, the `fog.ts`
  check, tests, and `docs/conditions.md`. (Earlier entries still say "optics" — that was
  the prior name; this supersedes the label.)

### 2026-06-29 — Artisan Ornaments — fix diagonal retaliation + scuttling/scout tuning

- **Retaliation bug fixed.** Attack legality uses Chebyshev distance (`inRange`), but
  `resolveCombat` checked retaliation with **Manhattan** distance — so a *diagonal*
  melee attack (Chebyshev 1, Manhattan 2) wrongly skipped the counter, and since units
  move 8-directionally most fights are diagonal. Result: attackers took no damage back.
  Combat now uses **Chebyshev** for the retaliation range check too, restoring the
  Polytopia mechanic (warrior vs warrior on plains: both lose 5; the counter-attack
  then kills). Added a diagonal-retaliation test.
- **Scuttling → glass cannon:** HP 10→**5**, attack 2→**3**, defence 0. Now hits hard
  (8 to a warrior) but is **one-shot by any real combat unit** (a warrior does 9). Deals
  no defensive counter (def 0). 
- **Scouts → squishy:** Vanguard scout HP 10→**8**, defence 2→**1**; Hive scout HP
  15→**8**. They were too resistant; a warrior now removes ~6 of 8 HP in one hit.
  (Attack stays 0.5 — recon units, not fighters.)

### 2026-06-29 — Artisan Ornaments — Reaper + Scab, Dash/Corrosive, forest cover, turn flow

- **Light units get only ×1.2 forest cover** (heavier units keep ×1.5). `combat.ts`
  `getDefenseMultiplier` now takes the defender's `unitClass`; only `forest` is reduced
  (mountain/city/fortify unchanged). All current units are "light", so forest = ×1.2 now.
  *(Superseded same day — see below: mountains now give no cover, and heavy units get no
  forest cover either.)*
- **Turn-flow default changed:** a unit may move-then-attack, and **can't move/act after
  attacking** (previously a unit that attacked without moving could still move). Move
  legality is now `!hasMoved && !hasAttacked`.
- **New condition `dash_N`** (the exception to the above): after attacking, the unit gets
  a one-shot move of up to N tiles. Tracked via new `Unit.dashRemaining`. **Reaper** (Hive,
  new) has `dash_1`.
- **New condition `corrosive` + status system.** A `corrosive`-condition unit's hit
  applies a **`corrosive` status** (`Unit.statuses`) to a surviving target → **−20%
  defence**, non-stacking, persistent. **Scab** (Hive, new — renamed from "Caustic Dreg"
  per request) has `corrosive`. First real status-effect plumbing in combat.
- **New Hive units:** **Reaper** (cost 40 / 10HP / 3atk / 1def / mv2 / melee / dash_1) and
  **Scab** (cost 50 / 10HP / 2atk / 1def / mv1 / rng2 / vis2 / corrosive). **Removed the
  Archer from the Hive roster.** Placeholder icons: scuttling 🐛, lancer 🪖, reaper 🦅,
  scab ⚗️ (Patrick to replace — see overlap).

### 2026-06-29 — Artisan Ornaments — condition: Frazzled (Hive Scout)

- New condition **`frazzled`** on the Hive Scout: while inside an **enemy's area of
  influence**, its movement is capped at **1** (base 2). Enforced in `pathfinding.ts`
  (`getReachableTiles` caps `maxMove`). *(AOI definition revised below.)*

### 2026-06-29 — Artisan Ornaments — Reveal Map reward implemented; city-vs-forest display

- **Reveal Map (L2→3 reward) is now live** (was deferred pending fog). Picking it levels
  the city to 3 and discovers **~33% of the player's currently-visible tile count** as a
  connected blob of cloud tiles growing from the player's seen frontier toward the
  **nearest enemy city** (`fog.ts revealTowardEnemy`, frontier-growth biased to the
  enemy → rough "hill"). Revealed tiles enter fog memory (terrain + structures, not live
  units) so they show as fog afterward. Deterministic. Modal `reveal` set `ready: true`.
- **Confirmed city > terrain in combat** (already correct: `getDefenseMultiplier` checks
  fortified/city before forest, so a city tile is ×1.5 / fortified ×3 regardless of the
  forest underneath). The confusing part was the **UnitSheet label**, which now reads
  "City — 1.5×" / "Fortified City — 3×" instead of "Forest (City) — …". Added a test
  locking city-over-forest. Also corrected the Fortify modal text (×1.5 → ×3 "walls").

### 2026-06-29 — Artisan Ornaments — "Double Resources" testing toggle

- Setup-screen checkbox **"Double Resources (For testing)"** (below the win conditions),
  bound to `config.mapgen.doubleResources`. When on, mapgen applies a **×2 resource
  multiplier** to the scattered sprinkle density and the per-ruin ore/plasma counts
  (capped by available tiles). Default off; deterministic per seed. Capital resources
  unchanged.

### 2026-06-29 — Artisan Ornaments — AOI defined as the 3×3 (not attack range)

- **Area of Influence (AOI)** is now a general concept: unless a unit states otherwise, a
  unit's AOI is the **3×3 grid around it** (Chebyshev radius 1) — **attack range does not
  widen it** (a range-2 unit still has a 3×3 AOI). Supersedes the prior Frazzled note that
  used attack range; Frazzled now triggers only when **adjacent** to an enemy. Documented
  as a glossary entry in `docs/conditions.md`.

### 2026-06-29 — Artisan Ornaments — drop Vanguard archer; L2 income reward +30→+20

- **Removed the Archer from the Vanguard roster** (Vanguard = scout, warrior, lancer,
  defender/Bulwark). Archer definition left in units.json, just unbuildable.
- **L1→L2 city-income reward lowered +30 → +20** (`applyLevelUpCity` 'income') for both
  teams. UI label + ECONOMY.md + tests updated.

### 2026-06-29 — Artisan Ornaments — mountain conditions, roster trim, Bulwark, UI fixes

- **Mountains are impassable by default** — no unit may climb a mountain unless it has a
  `mountain_*` condition. Three new conditions, each granting access plus a bonus on a
  mountain: **`mountain_defense`** (×1.2 def — *Bulwark*), **`mountain_shooter`** (×1.2
  atk — *Lancer*), **`mountain_sight`** (visibility 2 — *Scab*). Enforced in pathfinding
  (access), combat (`getDefenseMultiplier` now takes the full unit type for conditions;
  `resolveCombat` scales attack), and fog. `mountain_restricted` is now redundant.
- **Defender → "Bulwark"** (Vanguard): cost 60, 20HP, 1atk, 3def, light, `mountain_defense`.
  **Scab** visibility 2→1 (range still 2) + `mountain_sight`. **Lancer** + `mountain_shooter`.
- **Roster trim.** Hive = {scuttling, hive_scout, reaper, scab} (removed defender, catapult,
  ranger, treant). Vanguard = {scout, warrior, lancer, archer, defender/Bulwark} (removed
  catapult, berserker, siege tower). Unused unit *definitions* left in units.json (just
  off the rosters, so unbuildable).
- **UI:** condition tooltips replaced the unreliable native `title` (which only showed a
  `?`) with a custom hover box that actually explains each condition. **Hive Scout** got a
  big-eye sprite (was a generic circle). UnitSheet terrain-def line now uses the engine's
  real multiplier per unit (already fixed earlier).

### 2026-06-29 — Artisan Ornaments — mountains give no cover; forest cover light-only

- **Mountains no longer grant a defensive bonus** (×1.0). Zeroed `mountain.defenceBonus`
  in `terrain.json` and simplified `getDefenseMultiplier`: the only terrain cover left is
  **forest, and only for LIGHT units (×1.2)**. Heavy/other units get **no forest cover**
  (×1.0). City still ×1.5, fortified ×3. (`defenceBonus` is now effectively informational
  — combat keys off the forest tile id + unit class.)

### 2026-06-29 — Artisan Ornaments — scout HP back to 15, Hive starts with scuttlings

- **HP kept in multiples of 5.** Reverted the scout HP tweak: Vanguard scout and Hive
  scout both back to **HP 15** (def is the durability lever instead). Vanguard scout
  **def 1**, **Hive scout def 0** (takes full damage — a warrior does 9). Scuttling
  stays HP 5 / atk 3 / def 0.
- **Faction starting units are now data-driven** (`factions.json startingUnits`).
  **Hive starts with 2 Scuttlings** (1 pop) instead of a warrior, and warrior was
  already off the Hive build roster — so Hive can't field warriors at all. Vanguard
  still starts with 1 warrior. `createGame` places multiple starting units on the
  capital tile then free passable neighbours (deterministic). Capture test rewritten
  to set up its own defender (no longer assumes player 1 starts with one warrior).
## 2026-06-28 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Added a "Map Generation" tile-art theme selector: Default vs. AI Sprite (Ashen Wastes).**

*What changed.* The setup screen now has a **Map Generation** dropdown with two
options: `Default` (the hand-built grassland/stone tileset) and `AI Sprite —
Ashen Wastes` (the AI-generated volcanic set produced by the
`AI_Isometric_Art_Generator` project). Selecting AI Sprite re-skins the board
with those tiles, resources, and base sprites. New/changed files:
`apps/web/public/tiles/ashen/*` (copied art), `apps/web/src/iso/tileSprites.ts`
(rewritten as a multi-theme loader), `drawTile.ts` (theme-aware sprite
placement + themed resource/base objects), `projection.ts` + `constants.ts`
(top-overhang reserve), `gameStore.ts` (`tileTheme` state), `SetupScreen.tsx`
(the dropdown), `IsoCanvas.tsx` (applies the theme + threads city level to the
base sprite).

*Why this way.*
- **Render-only, engine untouched.** Tile art is cosmetic per the architecture
  rules, so `tileTheme` is a **web view setting**, never part of the
  deterministic `GameState`/`GameConfig`. The engine still generates
  `plains`/`forest`/`mountain`; the theme only changes which sprite each maps to.
  Same seed → identical game regardless of theme.
- **Natural biome, no lava flood.** Requirement was "make it natural, don't end
  up 80% lava." Because the engine already clusters terrain via smooth noise and
  never generates lava terrain (`ENABLE_WATER_LAVA = false`), mapping
  plains→ash_ground/scorched_dirt, forest→scorched_dirt/basalt_plate,
  mountain→basalt_plate yields a varied wasteland with **zero** lava floor. The
  `lava` sprite is loaded but reserved for if lava terrain is ever re-enabled.
- **Asset QA.** Of the five generated terrain tiles, only three had consistent
  cube geometry. `cracked_ash` was a flat diamond (no body — would sit at a
  different height and break the floor) and `obsidian_ground` generated nearly
  blank/transparent; both are **excluded**. (Brother confirmed `cracked_ash` was
  a bad generation.)
- **Alignment.** Ashen art is 96×128 with anchor (48, 87) vs. the default
  148×164; a per-theme `topOffsetY`/`spriteW` plus a shared `SPRITE_TOP_OVERHANG`
  reserve makes the AI tiles tessellate on the existing iso grid without clipping
  the back row. Verified by rendering the real app under both themes.
- **Bases by level.** The five `base_level_01..05` sprites map 1:1 onto city
  levels 1–5, so the themed base shows the right tier; an owner-coloured ground
  ring indicates the team (the base art itself isn't recoloured yet — the
  manifest reserves accent zones for future per-team tinting).

*Deferred:* per-team tinting of base accent zones; themed ruin/prop art (ruins
still use the vector pillar marker); additional AI biomes beyond Ashen Wastes.

## 2026-06-28 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Implemented the two deferred ashen-theme polish items: per-team base tinting
and themed volcanic ruins.** (Follows up the earlier 2026-06-28 entry.)

- **Per-team base tinting** (`tileSprites.ts` `getTintedCitySprite`). The base art
  is recoloured to the owner's team colour by *colourizing* its bright accent
  zones: a smoothstep luminance gate (0.30→0.62) selects only bright pixels, then
  each is replaced by the team colour scaled by its own brightness. First attempt
  blended toward the team colour proportional to luminance², but that mixed with
  the art's native orange accents — blue read fine, red was nearly invisible.
  Replacing (not blending) the hue makes both teams clearly distinct. Bakes are
  cached per (sprite, colour). The owner-coloured ground ring is kept as a second,
  always-legible team cue. Base art isn't recoloured wholesale — only accents —
  honouring the generator manifest's "reserve accent zones for team tint" intent.
- **Themed volcanic ruins** (`drawTile.ts` `drawRuinAshen`). No ruin/prop PNGs
  were ever generated, so rather than ship the pale tan vector pillars on a
  volcanic board, the ashen theme draws ruins procedurally as broken basalt/
  obsidian columns with a molten-glow base, glowing cracks, and embers. Selected
  via `getActiveTheme()`; the default theme keeps its original stone pillars.

*Still deferred:* generating real ruin/prop art; additional AI biomes; themed
unit sprites (the generator has since produced some unit PNGs, but units still
render as geometric shapes — out of scope here).

## 2026-06-29 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Swapped the ashen terrain/resource tiles for the regenerated 192×256 set and
expanded the terrain variety to all five tiles.** (Supersedes the 96×128 art
from the 2026-06-28 entries; the wiring/theme system is unchanged.)

*What changed.* The generator re-output the Ashen Wastes terrain, lava, and
resource tiles at **192×256** (was 96×128) against a precise alignment contract
(canvas 192×256; surface diamond centred at 96,87, 157×73; surface anchor 96,124;
base anchor 96,228). Copied the new `ash_ground / cracked_ash / scorched_dirt /
basalt_plate / obsidian_ground / lava / ore / plasma` into
`apps/web/public/tiles/ashen/`, overwriting the old ones. Bases were **not**
regenerated, so the previous 96×128 `base_level_*` art is kept.

*Why / decisions.*
- **All five terrain tiles are now usable.** The earlier batch had a flat
  `cracked_ash` and a blank `obsidian_ground`; the regen enforces "isometric
  rectangular prism" geometry, so both are now proper cubes. Variant mapping
  widened to plains→ash/cracked/scorched, forest→scorched/basalt, mountain→
  obsidian/basalt. The lava-cracked `basalt_plate` is deliberately kept a
  **minority** in each bucket so the board never reads as mostly lava.
- **Draw params derived from the manifest, not guessed.** `spriteW` sizes the
  157px surface diamond to ~1.12× the grid cell (slight overlap hides seams);
  `topOffsetY = HH − surfaceCenterY·scale` lands the art surface on the grid
  diamond. Result: `spriteW 148`, `topOffsetY −40`, `aspect 256/192`. Verified
  with the offscreen alignment harness (grid overlay) before touching the app.
- **Resources now draw 'fulltile'.** The new ore/plasma are authored to the tile
  contract (ground contact on the surface anchor), so they're drawn with the
  exact terrain placement instead of the old "stand on surface centre" object
  scaling — they plant perfectly and extend upward. Added a `'fulltile'`
  `resourceMode`; the legacy `'object'` path remains for the 96×128 bases.
- **Projection reserves bumped.** The taller/wider art (≈148×197 drawn) needed
  larger overhang reserves; `projection.ts` now sizes them from a 150×200 max so
  the back/front rows aren't clipped. Generous for the default theme — harmless
  extra margin; default rendering re-verified unchanged.

*Known cosmetic gap:* the kept 96×128 bases look slightly softer than the crisp
192×256 terrain. They still tessellate, team-tint, and place correctly; will
sharpen once the generator re-outputs bases at 192×256.

## 2026-06-29 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Fixed ashen tiles "stepping" along map edges — the AI art's surfaces weren't
vertically aligned. Added a normalization pre-process.**

*Symptom.* On the AI Sprite map the floor stepped up/down and the map's outer
edges weren't straight diagonals (the same artefact the user had hit building an
isometric tileset in Unity).

*Root cause.* The generator did **not** honour its own "hard alignment contract."
Measuring each raw 192×256 tile, the top-surface corner-line sat at a different
canvas Y per tile (≈91–104 for most, 148 for scorched, lava worse), and tiles had
very different depths (scorched ~51px, obsidian ~116px). On a fixed isometric grid
a single draw offset therefore can't line them up — surfaces step against each
other. (The Unity equivalent is every sprite having an inconsistent pivot.) The
manifest's stated geometry (surface diamond 157×73 @ 87) did not match the actual
pixels (~170×86 @ ~100, i.e. genuinely ~2:1, so aspect was fine — only *position*
was wrong).

*Fix.* Added `apps/web/scripts/normalize-ashen-tiles.py` (Pillow). It reads the
originals from the generator and bakes a consistent anchor into the copies under
`public/tiles/ashen/`: every terrain/lava tile's surface corner-line → canvas
y=100, every resource's ground-contact → y=120, all horizontally centred on x=96.
Detection is width-based (first row reaching ≥94 % of max width = the surface
corner-line), which is robust to per-tile shape differences. Re-run after any art
regen. Draw params then follow directly: `spriteW 130`, `topOffsetY = HH − 100·
scale ≈ −41`. Verified with a grid-overlay harness (surfaces sit exactly on the
grid diamonds) and in-app (map edges are now straight; floor is flat). Because the
art is genuinely ~2:1, no aspect/non-uniform scaling was needed.

*Note:* the lava tile is badly warped (left/right corners 48px apart) but is
reserved (engine doesn't generate lava), so its rough normalization is harmless.
The real long-term fix is the generator emitting correctly-anchored art; this
script makes the current art usable without waiting on that.

## 2026-06-29 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Supersampled the board canvas so high-res tiles stay crisp when zoomed.**

*Symptom.* The tile PNGs looked crisp in an image viewer but soft/blocky in-game,
especially when scroll-zoomed in.

*Cause (not the engine/mapgen, not a browser bug — a render-layer choice).*
`IsoCanvas` rasterizes the whole board once into a single canvas whose backing
store was `width × dpr`, then relies on CSS (`maxWidth/maxHeight: 100%` and
`transform: scale(zoom)`) to fit/zoom it. Those scale the *baked* bitmap, not the
source art, so zooming in magnified already-rasterized pixels → blocky. Each 192px
tile is also drawn at only `spriteW 130`, so detail was discarded before any zoom.

*Fix.* Render the backing store at `dpr × SUPERSAMPLE` (SUPERSAMPLE = 2) with the
drawing context scaled to match and `imageSmoothingQuality = 'high'`, while
keeping the CSS size at the logical dimensions. The board is now rasterized at up
to ~2× the display resolution, giving the browser real detail to sample when it
fits/zooms — so magnification reads as a smooth high-res upscale of the art rather
than blocky enlargement of baked pixels. Backing size is clamped (`MAX_DIM 8192`,
`MAX_AREA 30M`px) to stay within canvas/memory limits on large maps. Logical
coordinates are unchanged, so layout and mouse hit-testing are unaffected.

*Limit:* the source art is 192px, so extreme zoom is still bounded by that; this
removes the blocky pixelation and maximises the detail the current art has. A
sharper result at very high zoom would need either higher-res source art or
re-rendering the scene at the zoomed scale (instead of CSS-magnifying the bitmap).

## 2026-06-29 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Added a third Map Generation option, "Concrete" — the whole board rendered with
one pre-made isometric concrete cube.**

A new `concrete` tile theme (`tileSprites.ts`) maps every terrain
(plains/forest/mountain) to a single `texture_cube_concrete.png` (192×256, from
the downloaded "isometric cube" set). Unlike the AI-generated ashen tiles, this
cube is well-formed: solid faces, centred on x=96, surface corner-line at y=60 —
so no normalization is needed and, being a single uniform tile, every cell
tessellates exactly (verified against a grid overlay: surfaces sit precisely on
the grid diamonds; map edges are straight). Draw params follow the same model as
the other themes: `spriteW 132` sizes the ~166px surface diamond to the grid cell
with slight overlap, `topOffsetY = HH − 60·scale ≈ −14` lands the surface on the
diamond.

Decisions:
- **Minimal by intent.** The theme ships only the terrain cube. `resources` was
  made optional on `ThemeDef`; when a theme defines none, `getResourceIcon`
  returns null and the renderer falls back to the existing vector crystal/castle/
  ruin markers. Keeps "just this tile" literally that, with the rest still legible.
- Exposed as a `Concrete` entry in the SetupScreen dropdown alongside Default and
  AI Sprite — Ashen Wastes.

## 2026-06-29 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Concrete top-face flattening; added a fourth option, "Dark Earth".**

- **Concrete quilt fix.** The concrete cube has a baked bright-left/dark-right
  gradient on its top face; tiled, that repeats and reads as a quilt. Added
  `apps/web/scripts/flatten-top-face.py` — a masked flat-field correction over
  just the top diamond (estimate illumination via a large blur, divide it out,
  renormalise to the face mean) that removes the gradient while keeping the grain
  texture and leaving the side faces (depth) untouched. Cut the L/R difference
  from ~22 levels to ~3; the web `concrete.png` is the corrected output. (Stopped
  tuning further per request — diminishing returns.)
- **Dark Earth theme.** Added a `dark_earth` tile theme from a real tiling pack
  ("Isometric Tileset 4", `floor2_dark_earth_01_plain.png`). Unlike the cubes
  this is a flat floor slab: native **256×158**, isometric footprint **256×128**
  (2:1), ~30px depth, evenly lit (no gradient → no quilt). The pack manifest gave
  the geometry, from which the render params follow: `spriteW 110` maps the
  256-wide footprint onto the grid cell, `topOffsetY = HH − 54·scale ≈ 4` lands
  the surface line on the grid diamond. Verified against a grid overlay (surfaces
  centred on cells) and in-app (clean tessellation, units/cities centred). Single
  tile for all terrain; resources/cities use the vector markers. Exposed as a
  `Dark Earth` dropdown entry.

## 2026-06-29 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Added a fifth option, "Gemini" — a 3-tile theme with renderer-controlled
scatter (base + sparse mountains + sparse shard fields).**

Three hand-cleaned Gemini cubes (`base`, `mountain`, `shard`) share one 192×256
canvas and footprint (surface line ≈ y=93, bottom-centre pivot), so a single set
of draw params (`spriteW 130`, `topOffsetY ≈ −36`) aligns all three; the mountain
just extends its peak upward.

Distribution was the real ask ("mountains relatively sparse, sometimes in twos;
shard fields sparse"). Rather than tie it to engine terrain (whose density is
biome-dependent), the theme owns a custom `pick(x,y,hasFeature)` on `ThemeDef`:
- ~3% hashed mountain "seeds"; each seed may claim **one specific** neighbour
  (right or down) → singles plus the odd pair. Directional (not "any neighbour")
  so seeds can't chain into a range — the earlier any-neighbour rule produced a
  6-tile clump.
- ~5% isolated shard fields; everything else base.
- Features (cities/resources/ruins) always resolve to base so markers read clean.

To support custom pickers, `getTileSprite` now takes grid coords + a `hasFeature`
flag (the per-tile `variantHash` moved into `tileSprites`). Placement is hashed
off a `themeSeed` (set from the game PRNG in `IsoCanvas`) so each map differs
rather than being identical every game. Exposed as a `Gemini` dropdown entry.

**Follow-up — gemini stepping (aspect-ratio mismatch).** The gemini tiles' top
diamond is 1.88:1, but the grid is 2:1. Uniform width-match scaling left the
surface ~10px too tall per tile, so diamond edges didn't register on the grid and
the floor stepped/stacked toward the edges. (Concrete 2.13:1 and dark-earth 2:1
were close enough to tile by luck; gemini wasn't.) Fix: added an optional explicit
`spriteH` to `ThemeDrawParams` — when set, the tile scales NON-uniformly
(spriteW×spriteH) instead of preserving aspect. Gemini uses `spriteW 124 /
spriteH 156 / topOffsetY −30`, squashing its surface to a clean 2:1 (≈6% vertical,
imperceptible). Verified flat against a grid overlay and at the map edge.

## 2026-06-30 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Added four "FINAL - …" biome themes from the Codex MAPS set, each a 3-tile
biome (ground + two scattered features).**

Source: `AI_Isometric_Art_Generator/assets/downloaded/Codex/MAPS` — 4 biomes ×
3 tiles (all 192x256, shared footprint, base line y=245, centred x=96):
- **FINAL - Ancient Ruins** (`ruins`): ground + rubble (sparse, pairs) + temple (rare landmark).
- **FINAL - Volcanic** (`volcanic`): cracked-lava base + rocky-lava (frequent ground variant) + lava-mountain (sparse, pairs).
- **FINAL - Ice Tundra** (`ice`): snow ground + snowy mountain (sparse, pairs) + outpost (rare).
- **FINAL - Space Station** (`station`): metal platform + industrial machinery (sparse, pairs) + command tower (rare).

Distribution reuses a new shared `biomePick(ScatterCfg)` helper (generalised from
gemini): dominant base, a paired-scatter feature, plus an isolated rare/variant
sprinkle — all hashed off the per-game `themeSeed` so maps vary. Game features
(cities/resources/ruins) always resolve to base.

**Alignment.** Within each biome the ground surface line is consistent (features
just extend upward), but the ground-diamond aspect differs per biome (1.67-2.16,
none a clean 2:1). So each biome sets its own non-uniform `spriteH` (and matching
`topOffsetY`) to squash its ground diamond onto the grid's 2:1 — same technique as
gemini, applied per-biome. `spriteW` is shared (124) since all 12 tiles are 177px
wide. Per-biome: ruins `spriteH 141 / top -46`, volcanic `179 / -80`, ice `138 /
-54`, station `144 / -58`. All four verified tessellating against a 4-up
grid-overlay harness and in-app (flat floors, straight edges, all 3 tiles visible).

---

*Deferred ideas (the "we'll tweak this later" items) live in the memory backlog,
surfaced on request — they are design intentions, not yet decisions.*

---

## 2026-06-30 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Fixed the FINAL-biome floor "cascade/stepping" — corrected per-biome tile draw
geometry (`apps/web/src/iso/tileSprites.ts`).**

The 4 FINAL biomes (ruins/volcanic/ice/station) read as a quilted field that
"stepped down" front-to-back instead of a flat plane. Root cause was geometric,
not perceptual or stale-asset: the per-biome `spriteH`/`topOffsetY` were derived
by pinning the art's 94%-max-width row (`surf`) to the grid-diamond centre and
multiplying `scaleY` by an extra 1.06. `surf` sits ~4 art-px ABOVE the top
face's true centre / left-right vertices, and combined with the 1.06 inflation
this drew every top-face diamond ~14% too tall (back-half mapped to ~31px instead
of 27). Each tile's back edge therefore rose ~4px above its front neighbour's top
face, exposing a sliver of the baked side-wall between every interior row — the
reported cascade.

Corrected model (measured per ground tile in art pixels): map the TRUE top face
(apex row → front-vertex row, the latter detected as the top-face↔front-wall
luminance seam at the centre column) onto the grid diamond, centre→sy+27,
full height→54·k with k≈1.04 overlap to hide the rim:
`scaleY = 54·k/(front−apex); spriteH = round(256·scaleY); topOffsetY = round(27 − centre·scaleY)`.

New params (was → now): ruins spriteH 141→124, topOffsetY −46→−40; volcanic
179→156, −80→−69; ice 138→122, −54→−47; station 144→130, −58→−52. `spriteW`
stays 124 (horizontal overlap already correct).

Verified with a pixel compositor replicating the exact `drawTile` transform on the
real PNGs: before/after boards show the interior side-wall slivers disappear and
the floor reads as one slab; surface-seam period is exactly 54.00px (coplanar);
feature tiles (rubble/temple, rocky/mountain, ice mountain/outpost, command/
industrial) share the ground cube (178px footprint, y=245 ground contact, centre
within ±3 art-px) so they stay planted, peaks extending upward. Max per-row
surface deviation from the flat plane <0.5px. This supersedes the earlier
"derived per-biome and verified against a grid overlay" derivation, which used the
`surf`/×1.06 method that caused the error — apply the corrected bandTop/full-height
method to any offline script that regenerates these numbers.

---

## 2026-07-01 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Found and fixed the ACTUAL root cause of the floor "cascade/stepping":
non-uniform canvas CSS distortion on retina displays
(`apps/web/src/iso/IsoCanvas.tsx`). Supersedes the 2026-06-30 entry as the
primary cause.**

The 2026-06-30 tile-geometry correction was real and is kept — but it was not the
reason the user kept seeing stepping. The decisive bug: `render()` imperatively set
`canvas.style.width = `${width}px`` and `canvas.style.height = `${height}px`` every
frame, while the JSX also applied `maxWidth:100%` + `maxHeight:100%`. On a retina
display (devicePixelRatio 2) or any constrained viewport, the browser clamped the
two axes *independently*, scaling the canvas non-uniformly — measured 16–19%
vertical squash. That squash warps the 2:1 isometric grid so tiles can no longer
tessellate, producing the front-to-back cascade. Critically, my earlier puppeteer
verifications ran at dsf=1 in a large window where the clamp never triggered, so
they always reported "flat" — masking the bug the user (on retina) actually saw.

Fix: removed the imperative `canvas.style.width/height` assignments from
`render()`; display sizing is now owned entirely by the JSX style
(`width:'auto', height:'auto', aspectRatio:`${width} / ${height}`,
`maxWidth:100%`, `maxHeight:100%`). The backing store is still sized in device
pixels (`canvas.width = round(width·renderScale)`, ditto height) with
`ctx.setTransform(renderScale,…)`, so supersampled crispness is preserved.

Verified with a puppeteer driver forcing deviceScaleFactor=2 (true retina) across
viewports 1280×800, 1512×900 and dsf=1 1600×1100: backing aspect == displayed
aspect == 1.4964 at every condition, DISTORTION = 0.00% (was 16–19% on dsf=2).
Visual capture of the Ice Tundra biome at dsf=2/1280×800 shows a clean flat
diamond — sharp corners, no inter-row stepping. Lesson for future rendering work:
ALWAYS verify canvas sizing at deviceScaleFactor=2 and under max-size clamping,
not just at dsf=1 in a roomy window, or DPR/clamp distortion stays invisible to
the test harness while being the first thing a retina user sees.

---

## 2026-07-01 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Removed the experimental "Map Generation" tile themes, keeping only Default +
the four FINAL biomes.** The setup-screen "Map Generation" dropdown had grown a
set of WIP/evaluation themes — `ashen`, `concrete`, `dark_earth`, `gemini` —
alongside Default and the four shipping FINAL biomes (`ruins`, `volcanic`, `ice`,
`station`). The four experimental themes were prototyping artefacts (single-tile
slabs, AI-sprite evaluations, the Gemini set whose 1.77:1 top-face never
tessellated cleanly — see the prior Gemini cascade analysis). Removed them so the
menu only offers shippable options.

What changed:
- `tileSprites.ts`: dropped the four entries from `TileTheme` and the `THEMES`
  map; de-themed the comments that named them.
- `SetupScreen.tsx`: removed the four `<option>`s.
- `drawTile.ts`: deleted `drawRuinAshen` and its `getActiveTheme()==='ashen'`
  branch (the only theme-name-gated render path); ruins now always use the
  default `drawRuin`. Dropped the now-unused `getActiveTheme` import.
- Deleted the orphaned asset folders (`public/tiles/{ashen,concrete,dark_earth,
  gemini}`) and the two generator scripts that only served them
  (`scripts/normalize-ashen-tiles.py`, `scripts/flatten-top-face.py`).

Deliberately KEPT the generic city-base/tinting machinery (`getCitySprite`,
`getTintedCitySprite`, the `bases` field, the `'object'`/`'fulltile'`
resourceMode paths). Although only `ashen` ever exercised them, they are
data-driven (keyed on `def.bases`/`resourceMode`, not a theme name) and now sit
dormant — a future FINAL theme can opt in by adding `bases`. Ripping them out
would have expanded the change into the city/resource render paths and the
`cityLevel` plumbing for no functional gain. Typecheck (`tsc -p apps/web`) clean.

---

## 2026-07-01 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Added an author-time tile-consistency validator
(`apps/web/scripts/validate-tiles.py`, `npm run validate-tiles`).**

Context: the renderer places every tile in a theme with ONE shared anchor
(spriteW/spriteH/topOffsetY in tileSprites.ts), so a flat floor requires every
PNG in a set to agree on where its surface and ground-contact sit *inside the
image*. AI-generated tiles drift on exactly that, and the drift is invisible
until the floor cascades in-game. Rather than per-tile baked anchors (tedious,
and AI gen won't honour them), we catch the drift where it's cheap to fix —
at authoring time.

The script measures each PNG against a "tile contract": identical canvas size;
the top-face left/right vertices (widest opaque row = the surface anchor) on the
same row; the same ground-contact row (bottom-most opaque); matching footprint
extents. APEX is deliberately NOT checked — peaks legitimately rise above the
surface; only the cube they sit on must match. Reference tile defaults to the
flattest tile in the set (or one named ground/floor/platform/base); override with
--ref. Surface/contact/size mismatches FAIL (cause stepping / mis-planting);
footprint overhang WARNs. Exit 1 on any FAIL so it can gate a build/CI.

Running it on the current FINAL sets validated the approach: ruins and ice
ground/mountain are coplanar, but it flagged ice/outpost (+3px surface) and
station/industrial (+3px surface) as drifting — real inconsistencies the shared
anchor can't correct. This is the systematic replacement for the ad-hoc puppeteer
/PIL measurement harnesses used during the cascade bug hunt.

---

## 2026-07-01 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Removed the alternate map-generation tile themes; "Default" is now the only
option.** Supersedes the 2026-06-28 → 2026-07-01 themed-tileset work (ashen /
concrete / dark_earth / gemini / the four FINAL biomes ruins/volcanic/ice/
station). Per Patrick's request to strip all the code for these types.

Removed:
- `TileTheme` narrowed to just `'default'`; `THEMES` map, all FINAL biome defs,
  and the procedural-scatter machinery (`setThemeSeed`/`themeSeed`/`rand`,
  `ScatterCfg`, `biomePick`, per-theme `pick`) deleted from `tileSprites.ts`.
- Per-team base tinting (`getTintedCitySprite`/`hexToRgb`/tint cache) and
  `getCitySprite` — only the themed base sprites used them; the default theme has
  no base art and draws the vector castle. `ThemeDrawParams` slimmed to
  `spriteW`/`topOffsetY` (dropped `spriteH`, `aspect`, `resourceMode`, which
  existed only to fit the off-2:1 biome art).
- `drawTile.ts` themed branches: the `object`/`fulltile` resource modes and the
  tinted-base + owner-ring city path — leaving the default icon/vector rendering.
- `IsoCanvas.tsx` `setThemeSeed` call; SetupScreen dropdown down to Default only.
- Biome PNG dirs `public/tiles/{ice,ruins,station,volcanic}` (untracked copies;
  source art remains in the committed source packs and the sibling
  AI_Isometric_Art_Generator).
- The `validate-tiles.py` script + `npm run validate-tiles` added earlier the
  same day — with no multi-tile themed sets left it had nothing to validate.
  (Kept the tile-contract *reasoning* recorded in the prior entry for reference
  if themed sets are ever reintroduced.)

Default theme (flat `/tiles/*.png` grassland/stone cubes) is unchanged and still
renders. Typecheck passes.

---

## 2026-07-01 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Added a parallax starfield backdrop behind the game map, with drag-to-pan.**
Every generated map (all biomes / Map-Generation types) now renders over the same
space background: a black base + three sparse white-pixel star layers
(`apps/web/src/iso/Starfield.tsx`). Layers parallax at 0.15 / 0.30 / 0.45 of the
map's pan (nearer = larger fraction → depth), each also drifts slowly on its own
vector, and ~30% of stars twinkle (slow sine alpha). The field wrap-tiles from a
fixed cell (deterministic seeded PRNG) so any pan/drift keeps showing stars, and
runs its own rAF loop independent of the map raster.

Design decisions:
- **Separate backdrop canvas, not baked into the map canvas.** Parallax requires
  the star layers to move *against* the board, so they can't share the board's
  transform. The map canvas is now cleared transparently in game mode (was a
  solid `BG_COLOR` fill) so the starfield shows through tile gaps, unexplored
  tiles, and the margins around the isometric diamond. Editor keeps the solid
  backdrop (transparency there would expose the page, not stars).
- **Motion source = drag-to-pan + ambient drift** (chosen by the user over
  zoom-only / drift-only). The board had no panning — only wheel-zoom — so pan
  was added in `IsoCanvas` (`pan`/`onPanChange` props, owned by `MapView`).
  Drag is distinguished from click by a 4px move threshold; a completed drag sets
  a one-shot flag that swallows the trailing click so panning never selects a
  tile. Pan is clamped to the board's overflow + half a screen of slack.
- **Stacking:** the map canvas is now `position: relative` (no z-index) so it
  paints above the absolute `zIndex:0` starfield while remaining below the
  absolutely-positioned UI overlays (territory bar, city info, recruit) — all of
  which are already `position: absolute` and later in DOM, so they stay on top.

Scope: applied to the game `MapView` only; the map editor is unchanged. Typecheck
(`tsc -p apps/web`) clean.

---

## 2026-07-01 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Added a "Space Station" map-generation theme with an anchor-derived,
anisotropic tile transform — verified flat, zero cascade.**

Three tiles from the Codex MAPS "Space Station" biome set (192×256), one per art
category: `flat_terrain_01 → ground.png`, `rocky_cover_01 → rocky.png`,
`mountain_01 → mountain.png` under `apps/web/public/tiles/spacestation/`.

Key enabler: the set's `space_station_biome_split_manifest.json` authors every
tile to an IDENTICAL anchor — canvas 192×256, pivot (96,245), footprint width
178, ground-contact row 245 — so a single per-theme affine transform places all
three correctly (the mountain spire / rocky bumps simply extend above the surface
plane). Explicit per-tile anchor objects were considered and rejected as
redundant for a consistent set; instead the derivation provenance is recorded as
a comment block above the theme so the numbers can be recomputed if the art is
re-exported at another size.

Derivation (measured on the `ground` tile's top-face diamond: back vertex row
108, L/R vertices row 161 halfWidth 88.5, front vertex ~214.5):
  sx_scale = HW/88.5 = 54/88.5 = 0.610169 → spriteW = 192·sx_scale = 117.15
  sy_scale = HH/(161−108) = 27/53 = 0.509434 → spriteH = 256·sy_scale = 130.42
  topOffsetY = −108·sy_scale = −55.02
This is ANISOTROPIC scaling (spriteW×spriteH, not aspect-preserving) so the art's
near-2:1 top face becomes exactly congruent to the grid's 2:1 diamond. Params are
kept FRACTIONAL on purpose — rounding to ints drifts the 0.5 edge slope and
reopens seams. Multi-agent derivation panel (ultracode) reconciled three
independent derivations; the winner satisfies the hard invariant that the drawn
back-vertex→L/R distance = exactly 27px and matches the renderer's cy=sy+27
marker convention (an alternative that pinned the ground-contact pivot to the
grid front vertex was rejected — it floated the surface 15.5px above where units
stand).

Code: `tileSprites.ts` — TileTheme union widened to `'default' | 'spacestation'`;
`ThemeDrawParams.spriteH?` re-added (optional; omitted for default → unchanged
aspect-preserving behaviour); theme def added. `drawTile.ts` — `dh = dp.spriteH
?? dw*(naturalH/naturalW)`. `SetupScreen.tsx` — "Space Station" dropdown option.
gameStore/IsoCanvas needed no change (union flows through; theme load effect
already generic).

Verification (exact-transform PIL composite of the real PNGs at supersampled
scale): drawn back→L/R distance 27.001px (target 27), footprint half-width
53.999px (opaque edges land on sx±54 → no slivers), back-edge slope 0.5000,
surface-seam vertical period 54.000px across every row (coplanar). Visual
composites of a pure-ground slab and a mixed ground/rocky/mountain board both
read as one flat plane with features planted flush. No downscale blur:
dw·renderScale ≥ 117.15·2 = 234 > 192 native (upscaled into the supersampled
backing store). Default theme unchanged (spriteH omitted → same code path).

---

## 2026-07-01 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Space Station tiles: added a uniform overlap "bleed" to kill the residual
micro-cascade.** Refines the earlier same-day spacestation entry.

After shipping the exact-congruent transform (spriteW 117.15 / spriteH 130.42 /
topOffsetY −55.02), a real retina browser render still showed a faint per-tile
seam. Two causes: (1) the back-half-exact choice left the front vertex ~0.25px
past the next back vertex, and (2) — the bigger one — each source PNG has a darker
rim baked around its top face, so even perfect geometry tiles into a visible grid
of edges that reads as micro-stepping. Geometry tuning alone can't remove a baked
rim.

Fix (the "offset" Patrick asked for): rebase on the full-diamond-exact scale
(sy_scale = 54/106.5 so the front vertex lands exactly on the next back vertex),
then apply a UNIFORM bleed f=1.02 about the surface centre (sy+27):
  spriteW 117.15·f = 119.50, spriteH 129.80·f = 132.40, topOffsetY = −56.39.
Each tile now draws ~1.08px past the grid on every side, so its top face laps
OVER the tile behind it (painter order draws front tiles last), covering both the
sub-pixel seam and the baked rim. The bleed is a fixed per-tile expansion (same
for every tile) so it does NOT accumulate down the board; the surface centre stays
on sy+27 so units/markers/hit-testing are unaffected; edge slope stays 0.498≈0.5.
f is the tuning knob (1.0 = exact/no bleed); raise it for more seam coverage,
lower it if tiles visibly overlap. Verified by re-rendering the real board at
devicePixelRatio=2 — the seam grid is gone and the floor reads as one slab.
Remaining option if a hairline ever shows: shave the baked rim in the PNGs.

---

## 2026-07-01 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Space Station: per-sprite vertical nudge to seat the `rocky` tile on the floor
plane (removes the last residual cascade).** Refines the same-day spacestation
entries.

Patrick observed the remaining micro-cascade came specifically from the
rocky_cover tiles; ground and mountain looked fine. Width-per-row probe confirmed:
rocky's full-width wall band (its top-face L/R-vertex row → base bevel) sits ~2.5–3
art-px HIGHER in its 192×256 canvas than ground's, at the same contact row 245 —
i.e. rocky's cube is authored a few px taller. The theme's single transform was
derived from the ground tile, so rocky drew ~1.5px above the shared floor plane
and read as a local step. (Mountain is ~3px the other way but it's a sparse tall
feature whose surface is hidden by its spire, so its offset isn't visible.)

Fix: added an optional `nudge?: Record<string,number>` to ThemeDef — a per-file
vertical correction (px, added to topOffsetY). `getTileSprite` now returns
`{ img, nudge }` and drawTile applies it: `drawImage(..., sy + topOffsetY + nudge,
...)`. Set `spacestation.nudge = { rocky: 1.5 }`, seating rocky on the floor.
Verified by re-rendering the real board at devicePixelRatio=2 — the rocky/pipe
tiles now sit flush with the ground and the floor reads as one continuous plane.
The nudge is the tuning knob for any future tile authored slightly off the shared
surface plane; it also generalises the theme system without a per-tile anchor
object (still unnecessary since the base transform + a scalar nudge suffices).
Default theme unaffected (no nudge map → 0). Typecheck passes.

---

## 2026-07-01 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Space Station: real ore/plasma resource art (replaces the vector marker).**

Wired two Codex RESOURCES props into the spacestation theme: ore =
`ore_02_orange_crystal.png` → `ore.png`, plasma = `plasma_01_flame_vent.png` →
`plasma.png` (both 192×256, centred x=96, opaque base at y≈235). Added them to the
theme `files` + `resources: { ore, plasma }`.

Drawn 'object' style rather than the default 40px icon: new optional
`ThemeDrawParams.resourceMode: 'icon' | 'object'` (spacestation = 'object'; omit →
'icon', so default theme unchanged). In drawTile the object path scales the prop to
`spriteW * RESOURCE_OBJECT_SCALE` and plants its opaque base
(`RESOURCE_OBJECT_BASEFRAC` = 0.92 of art height) on the tile-surface centre + a
small `RESOURCE_OBJECT_LIFT`, so it stands upright within the tile. Tuned
RESOURCE_OBJECT_SCALE from 0.72 → 0.62 per Patrick ("not too big/small, sit within
the tile") — at 0.62 the prop opaque width is ~60–70% of the tile, clearly
readable and contained in the footprint. Verified on the real board at dpr=2.
SCALE/LIFT/BASEFRAC are the tuning knobs. Typecheck passes.

---

## 2026-07-01 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Space Station resources: centred on the tile surface + scaled down ~30%.**

The 'object' props were planted with their opaque BOTTOM edge at the tile-surface
centre, which pushed the whole prop into the diamond's back half — it read as
off-centre. Fix: plant the prop's base-FOOTPRINT CENTROID on the surface centre
instead. Measured both assets' footprint centroid (bottom-30px band midpoint) at
art-row ~220/256 = 0.859, so RESOURCE_OBJECT_BASEFRAC 0.92 → 0.86 and
RESOURCE_OBJECT_LIFT 2 → 0. Now the crystal/vent base straddles the tile centre.
Also RESOURCE_OBJECT_SCALE 0.62 → 0.434 (~30% smaller per Patrick) so the props
sit comfortably within the tile. Verified centred for both ore and plasma against
a drawn surface-diamond + centre crosshair, and on the real board at dpr=2.
Typecheck passes.

---

## 2026-07-01 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Space Station resources: nudged down on the tile.** Patrick found the props sat
a touch high. Bumped RESOURCE_OBJECT_LIFT 0 → 5px (positive = lower), seating the
crystal/vent bases a little further toward the tile front. Verified on the real
board at dpr=2. Typecheck passes.

---

## 2026-07-06 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Added 5 Ashen Wasteland biome themes + a recessed-terrain (water/lava) sink.**

Wired the "tileset for dave" split (20 tiles: 5 biomes × plain/mountain/rocky/
water, 192×256, pivot 96/245, footprint 178 — same contract as Space Station)
into 5 new map-generation themes: deep_sea, wasteland, shattered_purple,
volcanic_waste, frozen_waste. Assets copied to public/tiles/<biome>/{plain,
mountain,rocky,water}.png. A DRY `ashenBiome(base, nudge)` factory builds each
ThemeDef (shared spacestation transform 119.50/132.40/−56.39; variants map
plains→mostly plain+rocky, forest→rocky, mountain→mountain). Each biome carries a
per-file `nudge` aligning every tile's surface plane onto the shared floor
(reference art-row 160), measured from the top of each tile's full-width wall
band — without it the rocky/water tiles cascade a few px off the plain tile
(same bug class as spacestation rocky). Nudges e.g. wasteland {plain −1.55,
mountain −5.17, rocky −4.65, water 1.55}. SetupScreen dropdown gains the 5
options; TileTheme union widened.

Recessed terrains: new `TERRAIN_SINK` in drawTile sinks water/lava/river tiles
`TILE_H * 0.4` (≈21.6px, "2/5 of a tile step") below the land plane so they read
as sunken pools/basins — the whole tile + its markers shift down together
(`sy = syGrid + sink`), and front-row land tiles occlude the sunken front edge via
painter order. Verified with an exact-transform PIL composite: wasteland land
floor is flat (nudges hold) and a water block sits in a clean recessed basin with
the surrounding land walls forming the pit — the intended effect.

CAVEAT (flagged to Patrick): the engine currently has `ENABLE_WATER_LAVA = false`
(mapgen.ts), so water/lava terrain never generates — the water tiles and the sink
won't appear in-game until that's enabled. The sink rendering is ready for when it
is. Typecheck passes.

---

## 2026-07-06 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Enabled water/lava generation; rarer rocky; resources restricted to flat ground.**

1. `ENABLE_WATER_LAVA = false → true` (mapgen.ts) per Patrick — low elevation →
   water, hot peaks → lava, plus snow/sand bands. Combined with the recessed-
   terrain sink (prior entry) this gives sunken water/lava pools. NOTE: the
   classifier's seaLevel=0.34 yields ~24% water on a 16×16 — quite wet; tunable.
   Ashen biomes have no lava art, so `lava` maps to the biome's `water` tile (a
   sunken liquid stand-in). Verified by generating 8×(16×16): water/lava present.

2. Rocky spawn ~70% rarer: ashenBiome `plains` variant 1-in-4 rocky → 1-in-13
   (`[...Array(12).fill('plain'),'rocky']`, ≈7.7%).

3. Resources never on rocky/mountain/water/lava:
   - Engine: new `resourceEligible(x,y)` = passable && terrain ∉ {mountain,water,
     lava,river}, used for ruin-territory + scattered resources (city-perimeter
     resources are already on forced-plains). Verified: 434 resources across 8
     maps, 0 on forbidden terrain.
   - Render: `getTileSprite(...,hasFeature)` returns the base ground tile for any
     resource/city/ruin tile, so a feature never sits on a scattered `rocky` (or
     other) variant. drawTile passes hasFeature = isCity||isResourceTile||isRuin.

Blur question (answered, no code change): the softness is resampling, not a bug —
supersampling (dpr×2) + high-quality smoothing are already in place. Tiles render
smaller than their 192px native size when the board is fit to the viewport, and
painterly art loses crispness when resampled (the image viewer shows the PNG at
100%, hence sharper). 192×256 is near-optimal for retina at default zoom;
regenerating LARGER (~1.5–2×, e.g. 384×512, same bottom-aligned/centred contract)
gives headroom to stay crisp when zoomed in. DPI metadata is irrelevant to canvas;
only pixel dimensions matter. Engine + web typecheck pass.

---

## 2026-07-07 — Patrick Tomczak (patrick@artisanornaments.com.au)

**Render-at-display-resolution: eliminated the tile-resampling softness
(`apps/web/src/iso/IsoCanvas.tsx`).**

Problem: the backing store was a FIXED `dpr × 2` supersample regardless of how big
the board was actually shown. When the board is fit to the viewport (usual case),
each 192px tile was upscaled ~2.3× into that oversized buffer and then the whole
canvas was downscaled to fit — an up-then-down round trip that softened the
painterly art. (Supersampling helps zoom-IN but hurts default zoom.)

Fix: size the backing to the tile's true on-screen device pixels.
`renderScale = fitScale × renderZoom × dpr` (fitScale = uniform fit of the logical
board into `parentElement`), so each tile is drawn ~1:1 with its final size — one
clean resample, no round trip. CSS display size is now set imperatively and
UNIFORMLY (`canvas.style.width/height` from a single fitScale for both axes), which
is safe: the earlier 16-19% distortion came from per-axis logical-px + maxWidth/
maxHeight:100% clamping the axes independently; one shared scale can't distort.
Removed the JSX `aspectRatio`/`auto` sizing (now JS-controlled); kept maxWidth/
maxHeight:100% as a no-op overflow guard (explicit sizes are already ≤ container).
Re-renders on container resize / DPR change via a ResizeObserver + window resize
(viewTick). Zoom feeds `renderZoom`, a 120ms-debounced follower — `zoom` still
drives the CSS transform instantly (smooth), and the board re-rasterizes at the
new resolution once scrolling settles (so a fast wheel spin doesn't reallocate the
backing every tick; brief transient softness, then snaps crisp). Hit-testing is
unchanged (uses getBoundingClientRect, post-transform).

Verified headless at dpr=2: DISTORTION 0.00% at default zoom; backing = display ×
dpr exactly (1:1 device res, vs the old up-then-down); backing dynamically
retracks on resize (viewport 1400→800 ⇒ backing 2800→1600); wasteland biome
renders with no JS errors. Trade-off (accepted by Patrick): zoom is now a
re-render. Higher-res source art (~1.5-2×) would still help further when zoomed
past native, but is no longer needed for default-zoom crispness. Typecheck passes.

---

## 2026-07-07 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Removed all mapgen themes except Default; added "GEN 2 - Volcanic".**

Patrick asked to delete every map-generation option except `default` and add a
new one built from four volcanic tiles (13=lava molten surface, 14=mountain lava
peak, 15=plain dark basalt, 16=rocky basalt+boulders).

- `TileTheme` union collapsed to `'default' | 'gen2_volcanic'`. The Space Station
  theme and the five Ashen Wasteland biomes (deep_sea, wasteland,
  shattered_purple, volcanic_waste, frozen_waste) plus the `ashenBiome` factory
  were removed; their PNG dirs under `apps/web/public/tiles/` were deleted.
- New `gen2_volcanic` theme reuses the shared 192×256 iso transform derived for
  Space Station (spriteW 119.50, spriteH 132.40, topOffsetY −56.39). Tiles copied
  to `apps/web/public/tiles/gen2_volcanic/{plain,mountain,rocky,lava}.png` (from
  source 15/14/16/13). All share the 192×256 / footprint-178 / contact-245
  contract, so no new geometry was needed — only per-file `nudge` to align each
  surface plane onto the shared flat floor (measured surfTop → nudge): plain
  151→+4.65, mountain 155→+2.59, rocky 149→+5.69, lava 150→+5.17.
- Variants: plains is mostly `plain` with a sparse `rocky` accent (~1 in 13);
  mountain→lava-peak; water & lava terrain both draw the molten `lava` tile,
  which sinks via TERRAIN_SINK (TILE_H·0.4) so lava reads as a sunken pool with
  the surrounding land forming the basin. No ore/plasma art → vector crystal
  marker fallback.
- SetupScreen "Map Generation" dropdown reduced to Default + GEN 2 - Volcanic.

**Pixel-perfect rendering** ("make sure the engine renders the tiles pixel
perfect"): served by the existing render-at-display-resolution path — backing
store = CSS size × devicePixelRatio, one clean resample, verified DISTORTION=0.00%
(backing 2800×1798, display 1400×899, ratio 2.00) in a real retina browser render.

Verified: typecheck passes; no lingering refs to removed themes; live render shows
flat basalt floor, sparse rocky, lava-peak mountains, 0% distortion; offline
composite confirms the lava tile sinks into a molten basin with surrounding land
walls (the live RNG seed happened to spawn no water, so the basin was checked via
composite).

---

## 2026-07-07 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Added a 'material' (cube-drape) tile rendering mode; new "Space Station" theme.**

Context: repeated attempts to get GPT image models to generate pixel-consistent
isometric cube tiles failed — every generation invents its own camera angle, cube
height, top-face size and (for barriers) a recessed "swimming pool" rim, so the
tiles never tessellate. This is a fundamental limit of text-to-image: it can't be
a 3D engine.

Decision: **stop asking the AI for cubes.** The renderer now BUILDS the isometric
cube from grid geometry and drapes flat, seamless AI-painted MATERIALS onto its
top + two side faces. The AI's only job becomes painting flat textures, which it
does reliably; the cube is code, so every tile is identical and tessellates by
construction (no cascade, no per-tile alignment/nudges).

- `TileTheme` gains `'station'`; `ThemeDef` gains `mode: 'sprite' | 'material'`,
  `roles` (terrain → open/cover/elevated/barrier) and `materials`
  (ground/wall/cover/hazard file keys). New exports `getThemeMode`, `getTileRole`,
  `getMaterialImg`.
- `drawTile` branches on mode. New `drawMaterialCube` computes the top diamond
  from `tileToScreenShifted`, the side walls to a fixed base plane (elevated tiles
  rise `MAT_RISE` so they read as taller cliffs), and paints each face via
  `paintFace` (an affine `ctx.transform` that maps a per-tile source WINDOW of the
  material onto the face parallelogram — the window offset varies by (tx,ty) so the
  board doesn't visibly repeat). Side walls get a black-overlay shade
  (left 0.42 / right 0.20); the top face is expanded ×1.02 about its centre to lap
  seams. Cover tiles scatter a few clipped rock lumps. Barriers draw the hazard
  material flush (no sink) so adjacent barrier tiles merge into one pool with no
  rim — the "no swimming pool" behaviour the AI cubes never obeyed.
- Materials for the first set were cropped from a 2×2 contact sheet the model
  produced (it emitted one image instead of four files) into
  `apps/web/public/tiles/station_mat/{ground,rock,cliff,hazard}.png`. The 'cliff'
  material came back as a 3D scene rather than a flat wall, so walls currently reuse
  'ground' darkened; 'cliff' is loaded but unused pending a flatter regen.
- A companion generation prompt was rewritten to request flat, seamless, top-down
  MATERIAL swatches (1024², even lighting, no geometry) instead of cubes.

Verified: web typecheck passes; live retina browser render (station theme, real
materials) shows a continuous flat station floor, raised elevated blocks, scattered
cover, correct markers/units on top, backing 2800×1798, no material 404s. Barrier
(hazard) path proven via offline composite (this seed rolled no barrier tiles).

Follow-ups (open): elevated rise is subtle (tune `MAT_RISE`); regenerate a flat
'cliff' material to texture elevated walls distinctly; optional world-continuous UV
sampling for seamless panel flow across tiles; `gen2_volcanic` sprite theme could
later be reauthored as a material theme.

---

## 2026-07-07 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Added "Grassland (fantasy)" sprite theme from the Mocapot Unity isometric set.**

Patrick pointed at a purchased Unity asset pack (Mocapot Fantasy Tileset) and asked
for a grassy-biome mapgen option — flat grass, a bumpy tile, a tree tile, a water
tile — that tessellates perfectly, with draw params matched to the tile size.

Geometry: the pack's cube tiles are native 128×128 with a 128×64 top-face diamond
(top vertex canvas row 0, side vertices row 32, ~63px cube body below). A uniform
scale 108/128 = 0.84375 maps that diamond exactly onto the engine's 108×54 grid,
so `spriteW: 108, topOffsetY: 0` tessellates with no cascade (the art was authored
to tile; we just rescale it to the grid). This is why no anisotropic transform or
overlap-bleed was needed here — unlike the AI-generated sets, these tiles are
already geometrically exact.

Assets → `apps/web/public/tiles/grass_iso/`:
- grass = ground_05 (green), bumpy = stone_01 (cobble), water = water_13 (interior
  fill of the 48-tile water autotile set), sand = sand_01, snow = snow_01 — copied
  straight through (identical 128 diamond).
- tree_a/tree_b = tree objects composited onto a grass base on a taller 128-wide
  canvas (128×280), trunk planted on the diamond centroid. Their diamond sits at the
  canvas bottom, corrected with per-file `nudge = -(280-128)·0.84375 = -128.25`.

Theme mapping: plains = mostly grass + occasional bumpy; forest = tree tiles;
mountain = bumpy(rock); water/river/lava = water; sand/snow = their tiles.

Verified: offline tessellation preview (exact engine transform) shows a seamless
grass field, planted trees, flush water pond, cobble accents — no gaps/cascade;
web typecheck passes; live retina render (grass_iso theme) shows the same in-game
with markers/units on top, all 7 tile assets served 200. Water path proven via the
offline preview (this live seed rolled no water).

---

## 2026-07-07 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Grassland theme: water shore-autotiling + sink; trees downsized 50% and centred.**

Two follow-ups on the "Grassland (fantasy)" theme.

1. **Water autotiling.** The Mocapot pack ships a 48-tile water set (proper
   shorelines/foam). Reverse-engineered it by *foam-edge detection*: for each tile,
   sample "whiteness" just inside each of the four top-diamond edges; a foamy edge
   means LAND borders that side. That yields a 4-bit "NE SE SW NW" land-mask per
   tile (15 of 16 masks present + 8 open-water variants; the fully-enclosed 1111
   case falls back to 1110's tile). Stored as `ThemeDef.autotile { terrains, lookup }`
   on `grass_iso` (lookup = mask → candidate tiles, one picked per-tile by hash for
   variety). At render time `drawTile` receives a `terrainAt(x,y)` accessor from
   `IsoCanvas` and, for liquid terrains, computes the neighbour land-mask and selects
   the matching shore tile via `getSpriteByKey`. Pure render-time + deterministic
   (same map → same tiles); no engine change. Edge→neighbour mapping verified by an
   offline pond render (foam faces the shore, not the water). All 48 tiles copied to
   `public/tiles/grass_iso/water_00..47.png`.

   Water also **sinks below the land plane** (the existing global `TERRAIN_SINK` =
   0.4·TILE_H already applies to water/river/lava for non-material themes), so ponds
   read as recessed basins with the land occluding the front edge.

2. **Trees −50%, centred.** Rebuilt `tree_a/tree_b` compositing the tree object at
   half the previous size (target 64px wide of the 128 canvas → ~54px drawn) with the
   trunk base planted on the diamond centroid, so trees sit tile-sized and dead-centre
   instead of overflowing several tiles. Canvas/diamond geometry unchanged, so the
   `-128.25` nudge still holds.

Verified: web typecheck passes; offline render with the shipped assets shows correct
shorelines, sunk basin, and centred half-size trees; live retina render (grass_iso,
a water-heavy seed) shows autotiled shorelines with foam facing land and recessed
water, no JS errors, all assets served.

---

## 2026-07-07 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Added "GEN 3 - Desert" sprite theme from a 4-tile AI image (GEN 3 - DESERT.jpg).**

Source was one image with four cube tiles (flat sand, rocky cover, mountain, water)
on a near-white background. Pipeline to get it grid-ready:

1. **Extract**: keyed the desaturated/bright background to transparent, split the 2×2
   quadrants, cropped each to its opaque tile → `desert_{flat,rock,mountain,water}`.
2. **Normalise** (the AI cubes were inconsistent — footprints 475/535/485/529 and a
   ~1.7:1 top-face diamond, steeper than the grid's 2:1): uniform-scaled each tile to
   a common 475px footprint and composited onto one shared 475×500 canvas with their
   side-vertex rows aligned + centred. Now all four share ONE contract.
3. **Fit**: a single ANISOTROPIC draw maps the 1.7:1 top diamond onto the 2:1 grid —
   `spriteW 108` (footprint→108), `spriteH 96.43` (squash the 280px diamond height →
   54), `topOffsetY -13.5` (canonical back-vertex → grid sy). No per-file nudge needed
   after normalisation.

Assets → `apps/web/public/tiles/gen3_desert/{flat,rock,mountain,water}.png`. Theme:
plains = mostly flat + occasional rock; forest = rock (cover); mountain = mountain;
water/river/lava = the single water tile (sinks via TERRAIN_SINK into an oasis basin —
no shore autotiling since the set has only one water tile). SetupScreen dropdown gains
"GEN 3 - Desert".

Verified: web typecheck passes; offline tessellation preview shows a flat continuous
sand plane with aligned rocks/mountains and a sunk water basin; live retina render
(gen3_desert) shows the same in-game with markers/units on top, all 4 assets served.
Note: the cube bottom-vertex tips show at the board's front edge (normal iso — front
rows occlude them mid-board).

---

## 2026-07-07 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**GEN 3 - Desert: raised the water tile ~30%.** Per Patrick, the desert water sat
too deep. Added `nudge: { water: -6.5 }` to the `gen3_desert` theme (≈30% of the
0.4·TILE_H≈21.6px sink), so net sink ≈15px — a shallower oasis basin. Scoped to the
desert theme's water tile; other themes' water unchanged. Verified via offline
preview; typecheck passes.

## 2026-07-08 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Directional unit sprites: Vanguard warrior (4-view) replaces the vector warrior.**
Wired Patrick's AI-generated Vanguard warrior art (4 isometric views, 192×256 each,
from `vanguard_warrior_split_preview.png` and its pre-split direction files) into
the map as the visual for the basic `warrior` unit:

- New `apps/web/src/iso/unitSprites.ts` — a registry mapping unit `typeId` → a
  4-view sprite set (`ne/nw/se/sw.png` under `public/units/<set>/`), with source
  metrics (192×256, feet at row 236) and an on-map draw width (54px = half a tile).
  Unit types without a sprite set keep their existing vector drawers — this is an
  opt-in layer, not a replacement.
- The source art's compass names are rotated 45° from the screen diagonals; mapped
  north→NW, east→NE, south→SE, west→SW by inspecting each view.
- **Facing is render-side state, never engine state.** IsoCanvas already diffs unit
  positions to start glide animations; the same diff now derives a facing from the
  move delta (`facingFromDelta`: dominant axis; grid +x→SE, −x→NW, +y→SW, −y→NE)
  and stores it in a ref keyed by unit id. The engine stays pure — a unit's facing
  is cosmetic and re-derived from observed movement, so determinism and
  serialization are untouched.
- Sprite-drawn units get a subtle player-color rim ellipse at the feet (the art is
  not team-colored); shadow/selection/HP bar are shared with the vector path.
- Default facing for units that haven't moved: SE (front view).

Verified: offline composite (all 4 facings planted on grass tiles), then live
puppeteer runs — warrior spawns with the SE sprite, a down-left move switches it
to SW, an up-left move (after an End Turn round-trip) switches it to NW.
Typecheck passes. When a proper Vanguard faction lands, the registry key can move
from `typeId` to faction+type without touching the draw path.

## 2026-07-08 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Vanguard warrior sprite: +30% size, feet anchored to exact tile center.** Per
Patrick. `drawW` 54→70 in `unitSprites.ts`. Sprite-drawn units now plant their
feet on the diamond center (`groundY = cy`) instead of inheriting the vector
units' `FOOT_Y` forward offset — shadow, ownership rim, selection ring, and HP
bar all follow `groundY` so the whole ensemble stays centered. Vector units keep
their original offset (their proportions were tuned around it). Verified with an
offline composite (diamond outlines overlaid — feet land on the center point)
and a live screenshot.

## 2026-07-08 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Unit death fade-out (render-side).** Per Patrick: any unit that dies now fades
to transparency instead of popping off the board. Implementation lives entirely
in `IsoCanvas.tsx` next to the existing glide-animation machinery:

- The units effect already diffs the visible unit list each state change; it now
  also keeps a last-known snapshot per unit (`prevUnitsRef`). When an id vanishes,
  the snapshot (plus its last facing) goes into `deathsRef` and the shared rAF
  loop runs the fade (`DEATH_FADE_MS = 600`).
- After the painter loop, dying units are drawn at their final tile via the normal
  `drawUnitAt` with `ctx.globalAlpha = 1 − t` — so sprite units (Vanguard warrior)
  and vector units fade identically, shadow/HP bar included.
- Guard: if *every* known unit vanishes at once (new game / load), it's treated as
  a reset, not mass death — no ghost fades on the new map.
- Under fog, a unit that vanishes because it left our vision also fades at its
  last seen position (reads as "lost contact"); hidden tiles draw nothing.
- Engine untouched — death remains a state fact; the fade is pure presentation.

Verified live: removed a warrior from the store mid-game and burst-captured the
canvas — frames show opaque → ~half-transparent → gone over ~0.6s. Typecheck passes.

## 2026-07-08 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Vanguard warrior GEN 2 art + selected-unit green glow.** Per Patrick:

- Replaced the GEN 1 warrior sprites with the new generation
  (`TEAMS/GEN 2/Vanguard - Warrior.png`, white/bone armor with orange glow).
  The 1536×1024 sheet holds 4 views in quadrants (TL=SW, TR=NE, BL=NW, BR=SE —
  mapped by inspection). Build step normalizes them like the desert tiles: crop
  to alpha bbox, uniform-scale each figure to the median height (349px), center
  on a shared 315×373 canvas with feet on row 361. Same public URLs
  (`/units/vanguard_warrior/{ne,nw,se,sw}.png`), so only the registry metrics
  changed (`srcW/srcH/footY`, `drawW` 70→63 keeps the on-screen figure ≈70px).
- Selection effect for sprite units: a minimal light-green gradient rim around
  the unit's silhouette, done with canvas shadows (`shadowColor` rgba(130,255,170,.8),
  `shadowBlur` 9, two blurred passes under the crisp draw). Shadows follow image
  alpha, so the glow hugs the exact outline at any facing with no masking work.
  Vector units keep the plain white ring.

Verified live: unselected vs selected screenshots show the new art and the glow.
Typecheck passes.

## 2026-07-08 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**GEN 2 - Volcanic: raised the lava tiles.** Per Patrick ("move the lava tiles
upwards more"). Lava's nudge in the `gen2_volcanic` theme went 5.17 → −5.63:
the +5.17 plane-alignment component stays, minus a 10.8px raise (50% of the
0.4·TILE_H≈21.6px sink) — same approach as the GEN 3 desert water raise
(2026-07-07), just a deeper cut. Net effect: molten surface sits ≈10.8px below
the floor instead of ≈21.6px. Water/lava/river all share the lava art in this
theme, so the raise applies to all three terrain ids consistently. Verified
with a live screenshot; typecheck passes.

## 2026-07-08 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**GEN 2 warrior: fixed the "hovering / off-center" stance (body anchoring).**
Patrick spotted the unit floating up-left of its tile on the volcanic map. Root
cause: the GEN 2 extraction centered each view by its alpha *bounding box*, but
the drawn sword extends the bbox ~50 source px to one side per view — so
centering the bbox pushed the body ~11 screen px off the tile center (up-left
for SE, reading as a hover at zoom). Rebuilt the sprites with body anchoring:
"body" = columns whose alpha height exceeds 45% of the max (torso/legs; the
thin sword columns fall out), the canvas centers the body's centerline and pins
the boots' bottom row (not the bbox) to the shared foot row. New contract
425×372, footY 360, body 348px; drawW 63→85.5 keeps the figure ≈70px on screen.
Verified offline (all 4 facings straddle the tile centerline, feet on the
diamond center) and live on gen2_volcanic at the capital. Typecheck passes.

## 2026-07-08 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Warrior sprite → [variation] art, scoped to the Vanguard team only.** Per
Patrick: `TEAMS/GEN 2/Vanguard - Warrior [variation].png` is now the warrior
sprite, and only for the Vanguard team — the other team keeps the basic vector
figures. There is no "vanguard" faction id in the data yet, so the Vanguard
team maps to **Ironclad Dominion** (`ironclad`); remapping later (e.g. if a
proper vanguard faction lands) is a one-key change.

- `unitSprites.ts` registry keys are now `${factionId}:${typeId}` (team-scoped)
  or bare `typeId` (all teams); scoped entries win. The warrior set lives under
  `ironclad:warrior`.
- `drawUnitAt` takes an optional `factionId`; IsoCanvas resolves owner→factionId
  from `state.players` and passes it for both live units and death fades. No
  sprite set for your faction → vector drawer, as before.
- The [variation] sheet went through the body-anchored extraction (2026-07-08):
  contract 433×397, feet row 385, body 373px, drawW 81.3 (≈70px on screen).

Verified live: Ironclad warrior renders the variation art (selection glow
works); Sylvan warrior stays vector. Typecheck passes.

## 2026-07-08 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Generic combat animations (Into-the-Breach style): lunge, hit flash, damage
popups, flash-then-fade deaths.** Per Patrick — universal effects that need no
per-sprite animation art; they're transforms/overlays on whatever the unit
already draws (works for sprite AND vector units).

- Store publishes a `lastCombatEvent` per executed attack (ids, positions,
  damage, retaliation, kill flags — computed from the previewCombat call the
  combat log already made). Render-side only; engine untouched.
- IsoCanvas consumes it: attacker lunges ~35% toward the target and back
  (200ms sin bump through the existing posOverride path) and turns to face it;
  the victim flashes white at the lunge apex (220ms decay); floating "−N"
  numbers rise and fade (750ms) for damage and, offset 120ms, retaliation.
- Hit flash implementation: redraw the unit through `ctx.filter =
  'brightness(0) invert(1)'` — turns every opaque pixel white while keeping the
  alpha mask, so it hugs any silhouette (sprites and vector figures alike).
- Units killed in combat get flash-then-fade: the death fade's first 30% now
  carries a decaying white flash (deaths not caused by combat — e.g. lost to
  fog — still fade plainly). All timers run on the one shared rAF loop, which
  was consolidated (`kickAnimLoop`) and self-stops when idle.

Verified live by store-driven attacks: defender white-flash + "−6" popup,
retaliation "−24" popup on the attacker, attacker killed by retaliation fades
out with the flash. Typecheck passes. Natural next steps if wanted: projectile
tracers for ranged units, screen shake on kills.

## 2026-07-08 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Variety tiles pack: 5 new mapgen themes parsed from one sheet.** Per Patrick,
from `~/Desktop/Variety tiles.png` — a single 1536×1024 sheet holding 5 color
themes (Neon Blue, Toxic Green, Violet Ash, Ember Red, Frost Teal) × 4 tiles
(plain / mountain / rocky terrain / water), each row with a scene preview on the
left and the isolated tiles on the right.

- Parsing: cells auto-detected in the right half via content columns/rows (the
  text labels under each tile are separated by a gap and dropped). Background
  keying by flood-fill from the border: interior dark pixels stay opaque (the
  tile tops are near-black), and the outer neon glow halo gets soft alpha
  (α = luminance), so glows blend over the starfield and neighbouring tiles
  instead of stamping black boxes.
- Normalisation (same recipe as GEN 3 Desert): body footprint (glow excluded,
  α≥250) uniform-scaled to 176px, side-vertex rows aligned at row 80 on a shared
  192×169 contract — one contract for all 20 tiles since the sheet's geometry is
  near-identical across themes. Anisotropic draw maps the ~1.9:1 top diamond
  onto the 2:1 grid: spriteW 108, spriteH 100.84, topOffsetY −20.73.
- Code: `varietyTheme(name)` helper builds the five ThemeDefs (they differ only
  in asset path); variants mirror the volcanic mapping (plain + sparse rocky for
  plains, rocky for forest/cover, water serves water/river/lava with the
  standard sink). Five new dropdown options in SetupScreen.

Verified: offline tessellation previews (ember, neon blue — clean seams, ponds
recess correctly) and live in-game shots of Ember Red and Frost Teal. All 20
assets served; typecheck passes.

## 2026-07-08 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Mapgen: impassable tiles budgeted to ~5% of the map.** Per Patrick. Water and
lava (the only impassable terrains) previously came from fixed thresholds
(seaLevel 0.34, lava = hot peaks), which made their share swing wildly per seed
— some maps were 20%+ molten/flooded. Now:

- New `MapGenOptions.impassableFraction` (default **0.05**), split 80% water /
  20% lava.
- Sea level is a **quantile** of the actual elevation field — exactly the
  lowest waterFrac of tiles flood, every seed. The field is smooth, so the low
  set stays blobby (coherent lakes), never scattered singles.
- Lava is capped after classification: hottest tiles keep their budget, the
  rest demote to mountain (same elevation band, passable, defence bonus).
  Deterministic ordering (temperature desc, then y/x) — no extra PRNG draws, so
  the random stream is unchanged.
- Measured over 300 seeds × 3 sizes: share min 0–3.1%, avg 3.5–4.6%, max never
  above 4.9% (capitals carving 3×3 plains eat into the budget, hence the slight
  undershoot).

Note: same seed now yields different terrain than before this change, so saves
made earlier replay onto a different map (they re-run mapgen). Prototype-
acceptable. All 55 tests pass; web typecheck passes; verified live (ember red,
seed 42: previous lava fields reduced to one small lake + pond).

## 2026-07-13 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**GEN 5 - Desert theme (from Patrick's Tileset_Script pipeline) + menu cleanup.**
Per Patrick:

- New `gen5_desert` theme from `~/Tileset_Script/out_desert` — 9 normalised
  tiles (3× open scrub, 3× cover rock piles, 3× barrier mesas) produced by his
  own tile_normalizer.py. Its manifest.json supplied exact geometry: 512×256
  top-face diamond (exactly the grid's 2:1 → plain uniform scale 108/512, NO
  anisotropic squash), top vertex at row 32 → topOffsetY −6.75. The two tall
  mesas (512×768 canvases, top vertex row 416) get nudge −102.6 = −81 (canvas
  offset) − 21.6 (cancels TERRAIN_SINK — they're rock towers standing ON the
  plane, not sunken pools). Mapping: open→plains/sand/snow/resource,
  cover→forest, short mesa→mountain, tall mesas→water/lava.
- **Removed the five Variety options from the Map Generation menu** (added
  2026-07-08; this supersedes that entry's menu wiring). The variety theme code
  and assets remain in the repo, dormant — re-adding a menu line brings any of
  them back.
- **Deleted the Space Station theme and the whole material (cube-drape) render
  mode** (added 2026-07-07; superseded): station ThemeDef, 'station' TileTheme
  id, mode/roles/materials fields, getThemeMode/getTileRole/getMaterialImg,
  drawTile's material branch (drawMaterialCube, paintFace, MAT_* constants) and
  /tiles/station_mat assets. Every remaining theme is a sprite theme; the
  generic resourceMode:'object' prop support stays (theme-agnostic).

Verified: offline tessellation preview (mesas on-plane, no sink), live in-game
shot on seed 99, and a live dropdown probe showing exactly
default/gen2_volcanic/grass_iso/gen3_desert/gen5_desert. Typecheck passes.

## 2026-07-13 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Mapgen: mountains budgeted way down; forest generation enabled (all GEN 5
assets now actually appear).** Per Patrick ("way less mountain tiles… use all
of the assets"):

- Mountains previously came from a fixed elevation threshold (e > 0.76) that
  grabbed ~24% of the map. Now budgeted like the impassable pass: new
  `MapGenOptions.mountainFraction` (default **0.08**) takes only the top
  quantile of the elevation field as the peak band. Measured over 300 seeds:
  mountain avg 6.5%, max 7.4%.
- The active classifier never produced FOREST, so cover-role tiles (GEN 5's
  three rock-pile tiles, grassland's trees, volcanic's rocky clusters) never
  appeared in any generated map. The moisture field (already generated, unused
  by this classifier) now drives it: moist temperate land → forest (same 0.62
  threshold as the old biome classifier). Forest ≈13% of tiles.
- Resulting distribution (300×16×16): plains 35%, sand 21%, snow 20%, forest
  13%, mountain 6.5%, water 3.7%, lava 0.5% — impassable still capped ≤5%.
  With sand/snow/plains → the three open scrubs, forest → three covers,
  mountain → short mesa, water/lava → two tall mesas, all nine GEN 5 assets
  are exercised.
- No PRNG draws added/removed (quantile + existing fields) — determinism holds.

All 55 tests pass; verified live on gen5_desert (dense mesa fields replaced by
scattered outcrops + cover piles).

## 2026-07-13 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**GEN 5: even scrub-variant mix.** Patrick flagged the map as "not using all
the tiles". Empirical count (seed 99, 12×12) showed all 9 files DO render, but
the mapping skewed hard to open_01 (~50% of tiles): sand was pinned to
open_01/02, snow to open_03, features/river to open_01. Every open terrain
(plains/sand/snow/river/resource) now draws from all three scrub variants via
the per-tile hash, so the ground mixes ~evenly. Verified live.

## 2026-07-13 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**GEN 5: mountains rotate all three mesas; featured tiles mix scrubs;
flushLiquids flag.** Patrick observed the map still used "1 surface tile and 1
mountain tile" — confirmed: mountain was mapped to barrier_01 only, and
feature-carrying tiles (resources/ruins/cities, ~25% of tiles via the sprinkle)
were pinned to open_01. Fixes: (1) new ThemeDef.flushLiquids — the theme's
water/lava draw with NO TERRAIN_SINK (GEN 5's "liquid" is mesa towers standing
on the plane); this let the tall-mesa nudge drop its baked-in sink cancellation
(−102.6 → −81) so barrier_02/03 can serve both mountains and impassable tiles.
(2) mountain variants = all three barriers. (3) new ThemeDef.featureVariants —
featured tiles hash-pick across the three scrubs. Verified by auditing the LIVE
renderer (in-page probe of the running module): seed-555 board draws all nine
files (opens 44/30/37, covers 11/5/4, barriers 2/7/4). Lesson recorded: after
HMR edits, a plain dynamic import can create a SECOND module instance — restart
Vite before in-page module probes.
