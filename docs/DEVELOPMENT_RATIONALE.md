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

---

## 2026-07-01 — Click-to-inspect: unit → tile cycling + terrain info box (unknown)

**What changed (apps/web only):**

- Clicking a tile now **cycles**. First click on a tile that holds a unit selects
  the unit (as before). Clicking the **same** unit's tile **again** no longer
  deselects — it falls through to the tile itself, opening a terrain info box and
  (if the tile is a buildable ore/plasma tile) the build prompt. This fixes the
  reported issue that a **resource tile under a unit was unreachable** (unit
  selection always intercepted the click, so you could never build on / inspect it).
- Clicking an **empty** tile (no unit, no city) opens the same terrain info box
  directly and deselects any unit.
- New **tile info box** (`.tile-info`, reuses the `.city-info` card, gold accent):
  shows the terrain icon + name (e.g. Forest / Plains / Mountain), any resource
  (Ore ◈ / Plasma ✦), and short notes (impassable-to-most for mountains, +20%
  light-unit cover for forest, ruin = foundable, coords). Gated on fog: a `hidden`
  tile shows nothing (no terrain leak under clouds).
- The inspected tile gets a **gold diamond outline** on the canvas
  (`drawTileOutline` in `drawOverlays.ts`).
- Store: added `inspectedTile` + `setInspectedTile`. Selecting a unit or city, moving/
  attacking, undo, and starting a new game all clear it, so the box never lingers
  on stale state. City card and tile card share the top-left slot but are mutually
  exclusive (selecting one clears the other).

**Why:** the user asked for map tiles to be inspectable and for a unit standing on a
resource/terrain tile not to block access to the tile underneath — a two-click
"unit first, tile second" affordance rather than hiding the tile.

---

## 2026-07-01 — Economy breakdown UI + REB blocking rule (unknown)

**New engine rule — REB blocking (income only):** while an **enemy unit stands on
one of your REBs**, that building's resource output is not collected (excluded from
income) until it leaves. Supply/leveling is deliberately **unaffected** — the user
chose "income only" over "income + supply" to keep occupation a raiding tactic, not
a way to de-level a city. `buildingBlocked(state, building)` (occupant owner ≠ the
building's city owner; a friendly unit never blocks) is the predicate; `buildingIncome`
skips blocked REBs so `calculateOreIncome`/`calculatePlasmaIncome` (and thus the
end-of-turn settlement) reflect it automatically. Tests cover block/restore, friendly
non-block, and the breakdown flag.

**New engine helper — `playerEconomy(state, playerId, registry)`:** a structured,
per-city income breakdown (base city production + each REB, with per-kind indices,
gross amounts, and a `blocked` flag; totals exclude blocked). Added so all the UI
surfaces derive the *same* numbers from one deterministic pass rather than each
re-deriving. Types `EconomySource` / `CityEconomy` in `types.ts`.

**UI (apps/web):**
- **Top-bar income tooltips** now show a **comprehensive per-city breakdown** grouped
  by city — e.g. `Capital +50` then indented `City production +40`, `Mine 1 +10` —
  with a grand total. Plasma got its own hover tooltip too (previously ore-only). Old
  flat `oreBreakdown` loop in `GameScreen` replaced by `playerEconomy` + a shared
  `EconomyBreakdown.tsx` component.
- **City-info box** (top-left, own cities only) now shows the city's ore & plasma
  production breakdown beneath pop/supply.
- **Blocked REBs** render struck-through + "blocked" tag in the breakdowns, and a red
  **✕** at the tile's bottom-right on the map (`drawBlockedMark`), per the user's ask.
- **Build prompt** ("Build Mine?/Extractor?") now shows the **cost** on a second gold
  line (e.g. `50◈`) via an optional `sublabel` on `drawActionBox`.

**Why:** the user wanted the economy legible at a glance — what each city makes and
what produces it — and wanted enemy occupation of resource buildings to be a real,
visible economic lever.

---

## 2026-07-01 — REB economy rebalance + REB2 build-gate change (unknown)

**Rebalanced building numbers (`economy.json`):**
- **Extractor** (plasma REB1): cost 50/70/90 → **100/125/200**, output 10/20/30 →
  **5/10/20** (marginal +5/+5/+10), supply unchanged (2/3/4). It already output plasma
  (not ore); the user reconfirmed that and it's locked with a test.
- **Refinery** (REB2, ore): cost 50/120/200 → **100/150/250**, per-adjacent output
  10/20/30 → **20/40/80**, and supply moved from per-adjacent (1/3/5) to a **flat
  total 2/3/4**; now **1 per city**.
- **Purifier** (REB2, plasma): cost 50/120/200 → **300/400/750**, per-adjacent output
  10/20/30 → **5/15/30**, supply per-adjacent → **flat total 3/4/5**; 1 per city (as before).
- TTRs recorded inline in `docs/ECONOMY.md` per the econ-recalc rule.

**Semantic changes:**
1. **REB2 supply is now flat per level** (a fixed total), not multiplied by adjacent
   REB1s — the user specified fixed supply totals, which only make sense as flat values.
   Handled purely in data: `buildingSupply` already prefers `supplyByLevel` over
   `supplyPerAdjacentByLevel`, so the REB2 defs just switched fields. Output still uses
   `outputPerAdjacentByLevel` (per-adjacent, level-agnostic multiplier — unchanged logic).
2. **REB2 build gate changed** from "adjacent to an existing same-city REB1" to
   "its 3×3 contains ≥1 resource tile of the kind it refines that **this city owns**".
   New helper `hasResourceTileInCity` in `economy.ts`; `canBuild`'s `land` branch now
   calls it with `def.output` as the required resource kind. Rationale: the user wants
   the resource *tile* (in-territory) to be the prerequisite — you can pre-place a
   refinery beside a bare ore tile before mining it; output stays 0 until a mine exists.

**UI:** Refinery renders as 🏭, Purifier as 🚰 (plumbing/heavy-industrial) instead of
their text words, via a `BUILDING_ICON` map in `drawEconomy.ts` (emoji drawn larger;
mine/extractor keep their word labels). Build-cost line (added earlier) automatically
shows the new costs.

**Tests:** updated the refinery test (now +20/adj output, flat +2 supply) and added
coverage for the extractor plasma-not-ore output, the resource-tile build gate
(in-territory required; bare-ore-tile buildable; out-of-territory ore rejected), and
the 1-refinery-per-city limit. 100 tests pass; `validate-data` passes.

---

## 2026-07-01 — REB2 build prompts + always-visible (unaffordable) build sites (unknown)

**Bug:** the on-canvas build prompt only recognised `mine`/`extractor`; refinery and
purifier build actions existed in `getLegalActions` but the UI ignored them, so REB2s
couldn't be built. Fixed the click detector and prompt renderer to handle all four
building kinds (`Build Refinery?` / `Build Purifier?`, with cost line).

**Follow-up (root of "still can't build"):** the prompt was derived from
`getLegalActions`, which only contains *affordable* builds — so a valid REB2 site
where the player was short on ore showed nothing, reading as "can't build". Split the
engine predicate: new `canBuildLocation` (all checks except affordability) vs `canBuild`
(= location + affordability). The canvas now shows a build prompt on **any valid site**
via `canBuildLocation`; when the player can't afford it the box is dimmed with the cost
in **red** (mirroring the recruit menu) and clicking it is a no-op that keeps the prompt.
Legal-actions/apply still use `canBuild`, so affordability is still enforced by the engine.

**Why:** the user expected "clicking a tile where it's possible to build a REB2 shows
the box + cost." Tying visibility to affordability hid valid sites and made the feature
look broken; showing the site with a red cost tells them *what* they could build and
*why* they can't yet (not enough ore) — e.g. purifier now costs 300◈.

Also: internal `canBuild` edits and new engine exports in this project don't reliably
propagate through Vite HMR — the dev server must be restarted (cache cleared) for
engine changes to take effect in the browser.

---

## 2026-07-01 — REB2 gate reverted to adjacent-REB1 (supersedes resource-tile gate) (unknown)

Earlier today the REB2 build gate was set to "≥1 resource tile of the refined kind in
the 3×3, owned by this city." The user corrected this: a REB2 must require an actual
**adjacent same-city REB1 building** — a purifier needs an adjacent **extractor** (not
just a bare plasma vent), a refinery an adjacent **mine**. Symptoms that prompted it:
purifiers were buildable next to un-tapped plasma vents, and (because building a mine
doesn't consume the ore tile) the resource-tile gate made the refinery's appearance
depend on the vent/tile rather than the mine.

Reverted `canBuildLocation`'s `land` branch to `adjacentSameCity(pos, def.adjacentTo,
city.id) >= 1` (the original rule) and removed the `hasResourceTileInCity` helper. This
also keeps the gate consistent with the **output** calc, which already counts adjacent
same-city REB1s. Net effect: build the mine/extractor first, then the refinery/purifier
beside it. Tests updated accordingly (bare ore/vent → not buildable; buildable once the
REB1 exists; +1 purifier/refinery per city). This entry supersedes the resource-tile
gate decision from the same day.

---

## 2026-07-01 — Refinery tech gate removed; purifier cost confirmed ore (unknown)

**Refinery no longer requires the Refineries tech** (`refinery.techRequired: null`).
Root cause of "refinery still not appearing next to mines": the refinery was gated
behind the `refineries` tech while the purifier had no gate, so the purifier worked and
the refinery didn't until researched. The user expects the two REB2s to behave as a
pair, so the gate was dropped for parity — both now build as soon as their REB1 (mine /
extractor) is adjacent. The `refineries` tech still exists but gates nothing (kept to
avoid churning the tech tree). Updated `tech.test.ts` (was "Refineries gates the
refinery" → now "refinery has no tech gate") and dropped the research calls from the
refinery economy tests.

**Purifier cost:** verified it is **300 ore** (not plasma) — no building in economy.json
has a `plasmaCostByLevel`, `buildingCost` charges ore, and the only cost UI (the
on-canvas build box) renders `◈`. A stale browser bundle was the likely cause of the
"costs plasma" report; a clean dev-server restart + hard refresh resolves it. No code
change was needed for the cost itself.

---

## 2026-07-01 — "Rich start - for testing" setup toggle (unknown)

Added a setup-screen checkbox **"Rich start - for testing"** (next to Fog of War /
Double Resources). When ticked, every team starts with **2000 ore + 2000 plasma**
instead of the economy.json defaults — lets buildings/units be exercised without
grinding economy first. Implemented as an optional top-level `GameConfig.richStart`
flag (runtime UI toggle, carried straight to `createGame`; like `mapgen.doubleResources`
it isn't part of the validated config.json schema). `createGame` overrides the starting
ore/plasma when set. Test added.

---

## 2026-07-01 — David — Unit rules split into three semantic groups (Conditions / Active / Passive)

The Unit Info panel previously showed a flat "Status" + "Special Conditions" + "Traits"
list, which conflated two different kinds of named rule: genuine **debuffs/limits**
(blind, frazzled, impotent_founder…) and **abilities the unit has** (mountain bonuses,
dash, corrosive). We reorganised the display into **three groups**, matching how the
game actually reasons about units:

- **Conditions** — limits/debuffs, either *inherent* (in the unit's `conditions[]`) or
  *applied during play* by another unit (in `unit.statuses`, e.g. `corrosive_1`). Both
  now render together under Conditions.
- **Active Abilities** — opt-in abilities a unit MAY use. Registered as **placeholders**
  for now: `infect`, `spray_bile`, `slash`, `burrow`, `erupt` (mechanics TBD). Semantic
  rule established: an active that *applies* a condition (e.g. Infect) shows as an active
  on the user and as the resulting **condition** on the victim — the same
  ability-produces-condition split we made explicit for corrosive (below).
- **Passive Abilities** — always-on abilities: `dash_N`, the `mountain_*` passives,
  `detect`, `corrosive`.

Implementation is registry-driven, not a data-model change: the single `conditions[]`
opt-in array in `units.json` is unchanged; a new `ABILITY_REGISTRY` in
`apps/web/src/components/UnitSheet.tsx` tags each id with its `category` and the panel
groups by it. Engine enforcement never needed the category, so keeping the taxonomy in
the UI avoided touching engine data shapes.

**Corrosive rename (engine + data):** the applied debuff was renamed `corrosive` →
`corrosive_1` (−20% DEF) to make room for `corrosive_2` (−30% DEF, reserved) and to
separate it cleanly from the **`corrosive` passive** (the ability that *causes* it). The
scab keeps the `corrosive` passive; `applyAttack` now writes `corrosive_1`; `resolveCombat`
reads `corrosive_1`→×0.8 / `corrosive_2`→×0.7 (higher level wins, no stacking). Tests
(`combat.test.ts`, `hive.test.ts`) updated. Displays as **"Corrosive 1 (−20% DEF)"**.

**New passives:** `mountain_movement` — pure mountain *access* with no combat/sight bonus
(added to the mountain-access check in `pathfinding.ts`); this is now the default way to
let a unit climb without a bonus. `detect` — reserved passive to reveal cloaked/burrowed
units; **registered but not yet enforced** (no cloak/burrow units exist), to be wired
when the first cloak/burrow ability ships. `dash_2` needs no new code — the `dash_N`
parser already supports it; it's just now available to assign.

TTR: none — no economy stats changed.

---

## 2026-07-01 — David — Hive unit "Vindrace" + the Slash AoE attack (1st of 3 new Hive units)

Added the **Vindrace** (Hive, heavy): cost 100, HP 20, ATK 4, DEF 2, MOV 2, range 1,
vis 1, `conditions: ["slash"]`. First of three new Hive units the user is adding (other
two TBD).

**Slash** was promoted from an active-ability *placeholder* to a real **passive** — it is
the Vindrace's *only* attack ("main attack"). Mechanic: a swing at a **3-tile arc**. The
player targets a **central tile** (one of the 8 neighbours); the two side tiles are the
central tile's neighbours **along the 8-tile ring** around the unit. Central takes **100%**
damage, sides **50%** (floored at `minimumDamage`).

Key design decisions (user's calls, via prompt):
- **Enemies only** — friendly units in the arc are untouched (kinder to the Hive swarm).
- **No retaliation** — unlike a normal single-target attack, a Slash provokes no counter.
- **Slash-only** — it replaces the normal attack; a Slash unit is never offered a plain
  single-target attack in `getLegalActions`.

Geometry note: the side tiles are the **ring-neighbours** of the central tile, NOT every
tile adjacent to both the unit and the centre — the latter over-selects (4 tiles instead
of 2). Encoded as a fixed 8-entry ring in `getSlashArc`.

Implementation: new pure module `packages/engine/src/slash.ts` (`getSlashArc` +
`slashHitDamage`, both exported from the engine index and reused by the UI so the
damage-split preview matches the engine exactly). New `SlashAction` (`{type:'slash',
unitId, target}` where `target` is the central tile — the two sides are derived, so the
action stays minimal). `applySlash` in `game.ts` resolves each victim with the normal
force-ratio formula (respecting each target's own defence/terrain/corrosion) then applies
the 100/50 split, no retaliation; the unit stays put (AoE swing, no advance, no Dash).
UI (`IsoCanvas.tsx`): the central tiles highlight as attack targets; hovering one lights
the full 3-tile arc and previews the per-tile damage; clicking the central tile swings.
8 engine tests added (geometry incl. the over-selection guard, the 100/50 split,
enemies-only, no-retaliation, kill-removal, Slash-replaces-attack). 109 tests pass.

TTR: none — no economy stats changed.

---

## 2026-07-01 — David — Hive unit "Seercaust" + the active-ability system (Infect, Spray Bile, Detect)

Added the **Seercaust** (Hive, light support caster): cost 150, HP 15, ATK 2, DEF 1,
MOV 1, range 1, **vis 3**, `conditions: ["detect"]`, `abilities: [infect, spray_bile]`.
2nd of the three new Hive units.

**Built the active-ability (cast) system** — it was previously unimplemented (the
`UseAbilityAction` type existed but had no engine handler; existing ability data was inert).
Design decisions (all data-driven where they're balance numbers):
- **Casting model:** an active spends the unit's turn (gated like the attack action on
  `!hasAttacked`) and starts a per-unit **cooldown** (`unit.abilityCooldowns`, ticked down
  at end of the owner's turn). Chosen over free-action/plasma-cost (user's call).
- Ability metadata (`range`, `targetKind`, `targetClass`, `duration`, `cooldown`) added to
  `AbilityDefSchema` / the `AbilityDef` type so ranges/durations stay in JSON, not code.
- Effect logic is keyed by ability id in `applyUseAbility` (like conditions), not a generic
  effect-primitive VM — clearer for these specific, bespoke abilities.

**Infect** (`range 3`, target `light` unit, cd 2): user chose it can target **any** light
unit (not just enemies). Applies the **`infected`** condition + records `infectedBy`. On the
infected unit's **death**, `spawnScuttlingsFromInfected` spawns **2 scuttlings for the
infector** — one on the death tile, one on a random free 3×3 tile (deterministic PRNG).
Hooked into both `applyAttack` and `applySlash` after unit removal; the melee advance now
checks occupancy so it won't stack onto a spawned scuttling.

**Spray Bile** (`range 2`, target tile, `duration 5`, cd 2): marks a tile
`bile = {owner, expiresTurn}` for **5 rounds** (user chose rounds over player-turns; uses the
`state.turn` round counter, cleared in `applyEndTurn`). Combat effects in `resolveCombat`:
friendly (owner === bile.owner) ATK ×1.2 & DEF ×1.2; enemy DEF ×0.8. The **enemy movement
penalty is a deliberate placeholder** — it ties into the not-yet-built pathing system; a
memory note captures that the user will explain the pathing hookup later. Bile tiles get a
**purple tint**; clicking one shows the buffs/debuffs + a turns-left counter.

**Detect** — the previously-registered passive, now actually assigned (Seercaust). Still a
display/registration stub (no cloak/burrow units yet).

Also **corrosive_2** groundwork: `resolveCombat` already reads it (added with Vindrace);
bile stacks multiplicatively on the defence stat alongside corrosion and terrain.

UI: the Unit Info panel's **Active Abilities** group now sources from `unitType.abilities`
(not `conditions`) and renders **clickable cast buttons** (disabled when the unit has acted
or the ability is on cooldown, showing the cooldown counter; "armed" state highlights the
button). New store field `abilityMode` drives canvas targeting: valid target tiles get a
purple highlight, click to cast, click elsewhere cancels. 6 engine tests added; 115 pass.

TTR: none — no economy stats changed.

---

## 2026-07-01 — David — Fix: new units must be added to the faction roster to be recruitable

Vindrace and Seercaust weren't appearing in the Hive recruit menu (stuck at 4). Root cause:
recruitment is gated by each faction's **`unitTypes` roster** in `factions.json`, not by a
unit's own `faction` field. A unit with `"faction": "hive"` is still unrecruitable unless its
id is also listed in the hive faction's `unitTypes`. Added `vindrace` and `seercaust` to the
hive roster. **Checklist for any future unit:** (1) add to `units.json`, (2) add its id to the
owning faction's `unitTypes` in `factions.json`.

TTR: none.

---

## 2026-07-01 — David — Show the Spray Bile debuff under a unit's Conditions when it stands on a hostile bile tile

Bile effects are computed positionally in `resolveCombat` from `tile.bile` and are never
stored on the unit, so the Unit Info "Conditions" group (which reads `unit.statuses` +
inherent conditions) showed nothing when an enemy stood on an infected tile. Added a
**synthetic condition chip** (`bile_enemy`, "On Infected Tile", −20% DEF) that the
`UnitSheet` derives from the unit's current tile when `tile.bile.owner !== unit.owner`. It
isn't persisted — it appears while the unit is on the tile and disappears when it moves off,
which matches the actual mechanic. UI-only; no engine change.

Scope decision: only the **enemy debuff** is surfaced under Conditions (per the group's
definition = debuffs/limits). The **friendly buff** (ATK/DEF ×1.2) is intentionally NOT a
"condition" — it's already shown in the tile-info box; a positive effect doesn't belong in
the red debuff list.

TTR: none.

---

## 2026-07-04 — David — Vanguard unit "Mech" + Mountain Shooter 2 + Mobile (placeholder)

Added the **Mech** (Vanguard, heavy): cost 100, HP 25, ATK 3, DEF 1, MOV 2, range 2, vis 2,
`conditions: ["mountain_movement", "mountain_shooter_2", "mobile"]`. Also added to the
vanguard `unitTypes` roster (recruitable — per the two-step checklist from the prior fix).

**New passive `mountain_shooter_2`** — a superset of `mountain_shooter`: while on a mountain,
×1.2 attack (same) **plus +1 attack range**. The range bonus is modelled as an
**effective attack range** (`effectiveAttackRange(unitType, tile)` in `combat.ts`, exported):
base range off a mountain, +1 on one. It's applied in **both** directions — `game.ts`
`getLegalActions` uses it to offer attacks (so a peak-standing Mech reaches range 3), and
`resolveCombat`'s retaliation range check uses it (so it retaliates at the widened range
too). `mountain_shooter_2` also grants mountain access (added to the `pathfinding.ts` access
set) and the ×1.2 attack (added alongside `mountain_shooter` in `resolveCombat`).

**New passive `mobile`** — "ignores terrain movement penalties for forest & mountains." This
is a **deliberate placeholder**: `pathfinding.ts` currently charges a flat cost of 1 per
passable tile (no terrain move penalties exist), so `mobile` has no effect yet. Registered
for display + docs; a memory note captures the pathing hookup for later (same track as the
bile movement penalty). User explicitly asked to "make a note, will tidy this up in pathing."

Art: the Mech gets a **code-drawn placeholder sprite** `drawMech` (6-legged walker + cannon)
in `drawUnit.ts` and a 🕷️ recruit-menu emoji — flagged for Patrick in `overlap.md` (along
with the still-generic Vindrace/Seercaust sprites). UI registry entries added for both new
passives in `UnitSheet.tsx`. 4 engine tests added (effective-range math, range-3-only-on-
mountain, ×1.2-on-mountain, mountain access); 119 pass.

TTR: none — no economy stats changed.

---

## 2026-07-04 — David — Vindrace gains the Mountain Movement passive

Added `mountain_movement` to the Vindrace's `conditions` (now `["slash", "mountain_movement"]`)
so it can climb mountains (access only, no combat/sight bonus). Data-only change; the passive
is already fully implemented in `pathfinding.ts`.

TTR: none.

---

## 2026-07-04 — David — Vanguard unit "Tank" + Assault Mode toggle + banded attack range

Added the **Tank** (Vanguard, heavy): cost 150, HP 30, ATK 2, DEF 3, MOV 2, range 2, VIS 1
(added to the vanguard roster). Introduces two new engine mechanics:

**Banded attack range (`minAttackRange`).** New optional unit-type stat (default 1). A unit
with min > 1 can only fire in the band `[minAttackRange, attackRange]` — it cannot hit
*closer* than the minimum. Wired into `getLegalActions` (attack offering) and
`resolveCombat` (retaliation gate). Notation `range[min–max]`; shown as "min–max" in the
Unit Info Range stat. **Confirmed via a scan that the assault Tank is the FIRST banded unit**
— every existing ranged unit (scab/archer/lancer/catapult/siege-tower/ranger/mech, ranges
2–3) had no min and could already fire at range 1; `inRange` was a plain Chebyshev `≤ max`.

**Assault Mode (mode toggle).** Modelled as a **typeId morph** rather than an effective-stats
layer: enabling assault morphs `tank` → `tank_assault` (a companion unit type, NOT in the
recruit roster) and back, keeping id/HP/position. This leverages the data-driven design — all
existing code reads stats by `typeId`, so no combat/pathfinding/fog refactor was needed; the
assault stat profile lives entirely in `units.json`. Assault stats: ATK 5, DEF 2, MOV 0,
range **3–4 (banded)**, VIS 3. **Each toggle spends the turn** (it's an ability, gated like
attack; no cooldown, since the turn cost is the balance lever). Implemented via
`AbilityDef.morphTo` + a `morphTo` branch in `applyUseAbility`; offered as a **self-target**
ability (new branch in `getLegalActions` for abilities with no `targetKind`). UI: the
`UnitSheet` cast button fires self-cast abilities immediately (no target step).

Consequence worth noting: an assault Tank (min range 3) takes **no retaliation** from an
adjacent attacker — a deliberate trade-off of the deployed glass-cannon.

Art: code-drawn placeholder `drawTank` (both forms share it) + 🛞 recruit emoji; flagged for
Patrick in `overlap.md` (a distinct assault-form sprite would be nice). 5 engine tests added
(morph both ways + turn cost, the 3–4 band incl. no-retaliation, normal-tank range 1–2);
124 pass.

TTR: none — no economy stats changed.

---

## 2026-07-04 — David — Vanguard unit "Infiltrator" (Cloak, Detect, Stun; explosives + building-HP deferred)

Added the **Infiltrator** (Vanguard, light): HP 15, ATK 2, DEF 1, MOV 2, range 3, VIS 3.
**Cost 120 — a guess (user didn't specify); trivially tunable in `units.json`.** Added to the
vanguard roster.

**Cloak (passive).** A cloaked unit is filtered out of enemy players' `getVisibleState`
entirely — **even with fog OFF** (cloak ≠ fog; implemented as a separate `unitHiddenByCloak`
filter applied in both the fog-on and fog-off unit lists). Revealed only when (a) an enemy
`detect` unit is **adjacent** (range 1) or (b) the unit is **marked** (`statuses` includes
`marked` — a forward hook; no ability applies it yet). The owner always sees their own
cloaked units, rendered **ghosted** (0.5 alpha).

**Detect (passive) — now real.** Previously a no-op stub (Seercaust). Now un-hides adjacent
cloaked enemies. **Detect range = 1 (adjacent) "for now" per the user, flagged to revisit**
(may become the detector's sight radius later) — memory note + conditions.md capture this.

**Stun (active).** Clarified with the user: NOT a passive — it's a **special attack used
instead of attacking**. Select Stun → target an enemy within **range 3** (no cooldown) →
applies the **`stunned`** condition (can't move or attack for 1 turn; `getLegalActions` skips
a stunned unit, cleared at the end of its own turn). Does **not** reveal the Infiltrator.
Needed two new ability-data flags: **`targetEnemy`** (restrict unit-target to enemies) — Stun
uses it, whereas Infect targets any light unit.

**Plant Explosives (active) — DISABLED placeholder.** Per the user, left **greyed out**.
Added a general **`disabled`** ability flag: `getLegalActions` skips disabled abilities and
the UnitSheet renders them greyed ("(soon)"). Intended effect (2-turn fuse, 15 dmg to units /
2 hits to buildings) is unimplemented; open questions (does it follow a moving unit? how is it
removed?) noted for later.

**Building destruction — DEFERRED (hit-count model).** Per the user, buildings will NOT use
HP/force combat but a **hit count** (mine/extractor = 2 hits; each hit = 1 regardless of
damage). Hidden for now; captured in a memory note + a cross-module `overlap.md` entry
(buildings/economy module) + here.

UI: 🥷 recruit emoji + a code-drawn `drawInfiltrator` placeholder (flagged for Patrick).
7 engine tests added (cloak hidden/owner-visible/detect-adjacent/detect-far/marked; stun
targeting + 1-turn skip + recovery; disabled-ability not offered). 131 tests pass.

TTR: none — no economy stats changed.

---

## 2026-07-04 — David — Tank stays tech-gated behind "Forge" (name collision resolved) + recruit-panel wrap fix

The new `tank` unit's id collided with a pre-existing tech-tree plan: the **Forge** tech
(Armory L2) already had `unlockUnit: "tank"`. So `isUnitUnlocked` correctly hid the Tank from
recruit until Forge is researched — which read as "tank not showing" (Mech/Infiltrator have no
such tech, so they appeared). **Decision (user): keep the Tank gated behind Forge** — do NOT
make it base-recruitable. No code/data change: the gating already works (verified: with
`forge` researched, recruit returns `…mech, tank, infiltrator`). Path to unlock in-game:
research Small Arms (Armory L1) → Forge (L2) → Tank appears. Supersedes the implication in the
prior Tank entry that it was immediately recruitable — it's intentionally tech-gated.
(Reminder: the other `unlockUnit` techs point at not-yet-built units — `marksman`, `medic`,
`stalker` — so the tech tree still reserves those names.)

Separately, fixed a **latent recruit-panel bug** found while investigating: the panel was a
non-wrapping, centre-anchored (`translateX(-50%)`) flex row, so once a faction had enough
recruitable units the row overflowed and clipped cards off both screen edges — the same
"unit not showing" symptom. Added `flex-wrap: wrap`, `justify-content: center`,
`max-width: min(92vw, 900px)`, and `max-height/overflow-y` so cards wrap and stay on-screen.

TTR: none.

---

## 2026-07-04 — David — "Tech Tree on/off" setup toggle (default OFF = everything unlocked)

Per the user: keep the existing tech→unit links intact (Tank stays linked to Forge/Armory,
etc.), but add a **setup-screen toggle "Tech Tree (research to unlock — off = all unlocked)"**.
- **OFF** (default for now): the entire tech tree is unlocked from the start — every player
  begins with all **non-locked** techs pre-researched, so all units/tech/abilities are
  available immediately (the Tank shows in recruit without researching Forge).
- **ON**: normal research-gating (units unlock as their tech is researched).

Implemented as `GameConfig.techTreeEnabled`. Crucially, the engine treats gating as **ON
unless the flag is explicitly `false`** (undefined/true = gated). This means:
- `createGame` pre-researches all non-locked techs **only** when `techTreeEnabled === false`.
  All existing gating code (`isUnitUnlocked`, `getModifier`, `isTechAvailable`) then works
  unchanged — the tech→unit links are just pre-satisfied, not removed.
- Every existing test uses `defaultConfig` (flag undefined → gated), so **no test's behaviour
  changed** — no need to touch the tech/economy/combat suites. `tech.test.ts` keeps testing
  real gating; one new test covers the OFF path.

The web store defaults the config to `techTreeEnabled: false` (OFF), so games created from the
menu are unlocked by default; the checkbox (`checked = techTreeEnabled === true`) turns gating
ON. Locked/preview techs (`reactive_plating`, `tracer_rounds`, `replicator`) are excluded from
the OFF pre-research (they're not "active" tech yet).

This supersedes the practical concern from the prior Tank entry (a Forge-gated Tank being
unreachable without the tech UI): with the tree OFF by default, the Tank — and every other
tech-linked unit — is available now, while the linkage stays ready for when the tree is ON.

TTR: none.

---

## 2026-07-13 — David — Placeholder sprites/icons for Vindrace & Seercaust

Replaced the generic fallback figures with code-drawn placeholder sprites in `drawUnit.ts`
and gave them recruit-menu emoji in `MapView.tsx`:
- **Vindrace** → `drawVindrace` (ultralisk-style hulking armoured beast on four legs with two
  huge forward blades/tusks) + emoji 🦏.
- **Seercaust** → `drawSeercaust` (zerg-queen-style crowned caster with raised tendril-arms
  channelling a glowing purple spell orb) + emoji 🔮.

Web-only (canvas drawers + emoji map); still placeholders pending Patrick's real sprites
(overlap.md updated). No engine/data change.

TTR: none.

---

## 2026-07-13 — David — Bugfix: founding a city now fully ends the founder's turn (no attack after)

Reported: a Mech attacked after founding a city. Confirmed oversight. `applyFoundCity` set
only `founder.hasMoved = true` (its comment claimed it "mirrors capture"), but the attack
action is gated on `!hasAttacked` — so a founder could still attack after founding. Capture
(`applyCaptureCity`) correctly sets `hasAttacked = true`. Fixed founding to set BOTH
`hasMoved` and `hasAttacked`, so founding fully spends the turn (no move, no attack) for any
unit. Added a regression test (founder + adjacent enemy → no attack offered after founding).
Sacrificial founders (Scuttlings) are unaffected — they're consumed by founding.

TTR: none.

---

## 2026-07-13 — David — Hive unit "Wyrm" — Stage A: Burrow/Erupt, co-tile occupancy, hidden/detect (+ Tank MOV fix)

Added the **Wyrm** (Hive, heavy, cost 200): surface `wyrm` HP 30 / ATK 3 / DEF 3 / MOV 1 /
range 1 / VIS 1; burrowed `wyrm_burrowed` HP 30 / ATK 0 / DEF 0 / MOV 2 / VIS 0. Added to the
hive roster (only the surface form is recruitable). This is a big, multi-system unit built in
stages — **Stage A** (this entry) is Burrow/Erupt + co-tile occupancy + hidden/detect; **Stage
B** (the surface 2-tile "chain" attack) is deferred (memory note `wyrm-chain-attack-pending`).

User-confirmed rules:
- **Burrow** (self-cast, spends turn) morphs `wyrm` → `wyrm_burrowed` (reuses the Tank's
  `morphTo` mechanism). Burrowed = the Hive's cloak: hidden from enemies unless an adjacent
  enemy `detect` unit (range 1) or `marked` — reuses `unitHiddenByCloak` (now also triggers on
  `burrowed`). ATK/DEF 0 → very fragile if revealed (the counterplay). Can't attack (only Erupt).
- **Co-tile occupancy** (the hard part): a burrowed Wyrm may move **onto/under an enemy** unit
  (co-occupying), but not a friendly. Other units treat a burrowed **enemy** as invisible/
  non-blocking (they may unknowingly step on it) but a burrowed **friendly** still blocks.
  Implemented in `getReachableTiles` via an `isBurrowed` flag + excluding burrowed enemies from
  the blocking set. Burrowed can't move under buildings/resource tiles/cities/mountains (added a
  `buildings` arg to `getReachableTiles`; provisional — see `wyrm-burrowed-movement-future`).
- **Erupt** (self-cast, spends turn) morphs back to `wyrm` **and instantly kills any enemy on
  the Wyrm's tile** (regardless of HP — user's "for now" call), or just surfaces on an empty
  tile. Dedicated branch in `applyUseAbility` (kill co-located enemies + infected-death spawns,
  then morph).
- **Dirt mound:** the burrowed form renders as an owner-only dirt mound (`drawWyrmBurrowed`);
  enemies see nothing (it's filtered from their view), so the mound never gives it away.

Also per the user: **Tank normal-form movement 2 → 1** (assault form stays 0).

Deferred/noted: Stage B chain attack (100%/50%, **no retaliation — flagged for later review**),
burrowed-vs-building interactions (may attack REBs later), instant-kill-vs-damage on Erupt.
9 engine tests added (morph, hidden/detect, no-attack, co-tile both directions, terrain
restrictions, erupt kill/empty, tank MOV). 142 tests pass.

Known minor gap: two units co-located on one tile (burrowed Wyrm + enemy on top) share a
render slot — only relevant in the brief pre-Erupt window; acceptable for Stage A.

TTR: none — no economy stats changed.

---

## 2026-07-13 — David — Wyrm tweak: Burrow/Erupt forbidden on city/mountain/building tiles

Per the user: the Wyrm may not **Burrow** or **Erupt** while standing on a **city, mountain,
or building** tile. Added `canBurrowEruptAt` (checks `tile.isCity`, mountain terrain, and any
`state.buildings` on the tile); gates the `burrow`/`erupt` self-cast offers in
`getLegalActions` and is re-checked defensively in `applyUseAbility`. (Assault Mode and other
morphs are unaffected.) Tests added.

Separately flagged for the user (not yet built): the **blind/burrowed "bump into impassable
terrain" movement mechanic** — all cloud tiles show selectable, and moving onto a hidden
impassable tile makes the unit bump (stay/stop-short, reveal that tile as fog, waste the
movement), extended to scuttlings too. **The design logic is to penalise blind movement into
clouds** (blindly rushing into fog risks wasting moves on unseen mountains/buildings). Holding
implementation pending one clarification: the spec both says burrowed movement is "stopped at
a mountain (like scuttlings)" AND that the Wyrm "can move freely under" an impassable
intermediate tile — those conflict, and it determines the whole implementation.

TTR: none.

---

## 2026-07-13 — David — Blind/burrowed "bump into impassable terrain" movement + Wyrm pass-under

Built the movement mechanic for blind (scuttling) and burrowed (Wyrm) units. **Design logic:
penalise blind movement into clouds.** Because these units see only their own tile, showing
only *passable* cloud tiles as blue leaks terrain (you'd infer where mountains are). So now
**all** cloud tiles in range are selectable, and moving onto a hidden impassable tile
**bumps**: the unit lands on the last valid tile, the impassable tile is revealed as fog, and
remaining movement is wasted.

User-confirmed rules (two clarifying rounds):
- **Wyrm passes UNDER** impassable intermediate tiles (mountain/building/resource/city) to
  reach a valid tile beyond — those aren't revealed. It only **bumps** when the impassable
  tile is its actual **destination**. Scuttlings (surface) can't pass through, so they bump
  the first impassable tile.
- **Bump lands on the last valid tile** (partial advance). A MOV-1 scuttling bumping an
  adjacent mountain stays put; a MOV-2 Wyrm bumping a far mountain advances one tile first.

Implementation: `getReachableTiles` was reworked around **occupiable** (can stop) vs
**traversable** (can path through) predicates — burrowed traverses everything (passes under)
but can't stop on impassables/friendlies; others traverse only what they could occupy. A new
optional `bumps` out-param collects impassable-tile→land-tile pairs. `getLegalActions` turns
those into move actions carrying `bumpReveal` (new optional field on `MoveAction`: `to` = land
tile, `bumpReveal` = the tile to reveal). `applyMove` handles it (land + reveal to fog memory /
revealedTiles). UI: bump tiles highlight on their impassable (cloud) tile and are clickable;
`selectedUnitBlind` now also covers `burrowed` so the Wyrm's targets draw on clouds.

Also fixed the earlier note: burrowed movement is NOT "can't move under" impassables — it's
"passes under but can't stop on" them.

9 new engine tests (5 earlier + 4 bump: destination-bump, pass-under vs a blocked normal unit,
scuttling adjacent bump, apply-bump lands+reveals). 148 tests pass.

TTR: none.

---

## 2026-07-13 — David — Vanguard Armory tech-tree revamp + renames (Infiltrator→Wraith, Mech→Stalker)

**Renames (all references updated; old names deleted):** `infiltrator` → **`wraith`** and
`mech` → **`stalker`** across units.json, factions.json, the canvas drawers
(`drawInfiltrator`→`drawWraith`, `drawMech`→`drawStalker`), `UNIT_ICONS`, `UnitSheet`
descriptions, engine tests (files renamed to `wraith.test.ts` / `stalker.test.ts`),
conditions.md, overlap.md, and the memory notes. ("Mech Bay" the tech keeps its name.)

**Armory tech tree** (`packages/data/json/tech-tree.json`) rebuilt as two prerequisite
branches (Polytopia-style DAG via the per-node `prerequisites` field):
- **Small Arms** (L1) → unlocks Bulwark + Lancer. → **Combined Arms** (L1, needs Small Arms;
  repeat-shot ×1.2 upgrade — combat logic TBD). → **Infiltration** (L2) unlocks Wraith. →
  **Raiding** (L2, needs Infiltration; TBD).
- **Forge** (L1, pure prereq) → **Mech Bay** (L2) unlocks Stalker; → **Tracer Rounds** (L2,
  TBD), **Precision Targeting** (L2, grants Stalker Mountain Shooter 2 — TBD), **Sentinel**
  (L3, unlocks a missing Sentinel unit). **Crucible** (L2, needs Forge) unlocks Tank; →
  **Titan** (L3, missing unit), **Advanced Projectiles** (L3, Tank assault range 2–3→2–4 —
  TBD). **Composite Plating** (L3) needs **Crucible OR Mech Bay** → Stalker+Tank ×1.2 DEF (TBD).

**Engine changes to support it:**
- New **`prerequisitesAny`** field (OR-prereqs) + check in `isTechAvailable` — for Composite
  Plating (Crucible OR Mech Bay), which the AND-only `prerequisites` couldn't express.
- **Tank assault range default 3–4 → 2–3** (min 2, max 3), per spec; Advanced Projectiles will
  later bump the max to 4.
- **Tank/Bulwark/Lancer/Stalker/Wraith are now tech-gated** (via `unlockUnit` on their techs).
  With the Tech Tree toggle OFF (default), all are available; ON, they gate correctly.

**Removed** (not in the new spec): `triage`/medic, `marksman`, `reactive_plating`, `replicator`.

**Placeholders / missing** captured in memory note `vanguard-tech-tree-pending`: the Sentinel
& Titan units don't exist; Combined Arms / Raiding / Tracer Rounds / Precision Targeting /
Advanced Projectiles / Composite Plating effects aren't wired (need a general "tech grants an
ability/stat to specific units" mechanic). The tech-tree **UI** still renders tier-gated, not
the prereq DAG — a follow-up (its node ids were also realigned to the engine tech ids).

Tests: rewrote the Armory `tech.test.ts` cases to the new DAG (Mech Bay needs Forge; Composite
Plating OR-prereq; Small Arms → Lancer/Bulwark; Crucible → Tank); fixed a recruit test to run
tech-off. 148 tests pass.

TTR: none — no economy stats changed.

---

## 2026-07-13 — David — Recruit shows tech-locked units (greyed); Wraith tweaks; Roman numerals; dropped techs

Batch of tweaks alongside the Armory revamp:
- **Recruit menu shows ALL roster units**, greying out tech-locked ones (Tech Tree ON) instead
  of hiding them. `getRecruitOptions` now returns locked units with `locked: true` + `lockedBy`
  (the unlocking tech names); the panel renders them greyed/non-clickable with a "research X"
  tooltip + 🔒. Recruit *legality* (`getLegalActions`) still excludes locked units, so they
  can't be built. (Pop-full non-locked units are still hidden, as before.)
- **Tech Tree** setup toggle relabelled to just "Tech Tree" (dropped the explainer text).
- **Wraith:** visibility 3 → 2; added the **`impotent_founder`** condition (can't found cities).
- **Roman numerals:** levelled ability display names now use Roman numerals (Corrosive I/II,
  Mountain Shooter II, Dash I/II, …). Display-only — internal ids stay `corrosive_1` etc.
- **Dropped techs confirmed:** Triage/Medic, Marksman, Reactive Plating removed. **Replicator**
  also removed for now — the user may **bring it back in later testing**.

TTR: none.

---

## 2026-07-13 — David — Tech-tree UI redone as a Polytopia-style DAG (levels on rows + connector lines)

Rebuilt `TechTreeView` from tier-row card lists into a **branching DAG**: each level (L1/L2/L3)
sits on its own horizontal row, and **connector lines** are drawn from each tech to its
prerequisites (Small Arms → Infiltration, Forge → Mech Bay/Crucible, etc.). OR-prereqs
(Composite Plating ← Crucible OR Mech Bay) draw as **dashed** lines.

Implementation: `techTrees.ts` nodes gained `col` / `prereqs` / `prereqsAny`; new `layoutTree()`
computes absolute x/y per node (col × 152, row × 152) and edge endpoints (node centres);
`nodeState()` derives researched/available/locked from prereqs (falling back to tier-gating for
nodes without prereq data). `TechTreeView` renders an absolutely-positioned node layer over an
SVG line layer, with LVL labels down the left.

**Also fixed a latent disconnect:** the UI node ids were `arm_smallarms` etc. and never matched
the engine tech ids, so research state/among the tree was cosmetic. Aligned the Armory node ids
to the **engine ids** (`small_arms`, `mech_bay`, …), so `researched` and the `research` dispatch
now work end-to-end for Vanguard. (The Refinement tree still uses its old placeholder ids —
cosmetic — a follow-up. Node cost/affordability isn't shown yet; the engine still validates the
research action.)

TTR: none — UI only.

---

## 2026-07-13 — David — Vanguard #2–#5: push engine (Titan/Ram), Sentinel, Combined Arms, greyed upgrades

Built four interlocking Vanguard features.

**Shared push engine (`push.ts`).** `resolvePush` pushes a LIGHT unit one tile away
(heavy/air immune): empty passable tile → slides; obstacle (mountain/unit/building/map-edge)
→ 2 dmg and stays (a bumped LIGHT unit also takes 2, heavy 0); void terrain (water/lava,
`passable:false`) → dies. Used by:
- **Titan** (`titan`, HP 40) **Percussive Shells** — impact any tile in range 2: a light unit
  there takes a normal Titan hit, then the 8 surrounding light units are pushed radially out
  (`applyPercussiveShells`, snapshots neighbours first).
- **Vindrace `Ram`** — shove one adjacent enemy light unit away.

**Sentinel** (`sentinel`, air, ATK 0, cost 200) — `flying` trait (already handles water/lava
in pathfinding); can't attack (added an `attack > 0` gate in `getLegalActions`). Abilities:
- **Detect II** (`detect_2`) — `unitHiddenByCloak` now reads per-detector range (detect=1,
  detect_2=2).
- **Kinetic Shield** (`kinetic_shield` → `shielded` status) — absorbs 100% of the next hit;
  `tryAbsorbShield` in `applyAttack` (and the Percussive centre) zeroes the damage + un-kills.
  New `targetAlly` ability flag (friendly-only targeting).
- **Overwatch Network I** (`overwatch_network_1`) — a ranged friendly unit adjacent to it gets
  +1 attack range (aura bonus in the attack-offering range calc).

**Combined Arms** (tech `combined_arms`) — a LIGHT unit's 2nd+ attack on the SAME enemy this
turn gets **×1.2** (no stack). New `GameState.combinedArmsHits` (targetId→count, reset each
end-turn); `resolveCombat` gained an `attackMultiplier` param; `applyAttack` computes/tracks it.

**Greyed locked upgrades (#5)** — the Unit Info panel now shows a "Locked Upgrades" section for
your own units listing abilities gated behind un-researched tech (e.g. Stalker → Mountain
Shooter II), greyed, with a hover tooltip showing the required tech **chain** (Forge › Mech Bay
› Precision Targeting) + the effect. Driven by a `GATED_UPGRADES` map in `UnitSheet`, filtered
by the viewer's `researchedTechs`.

Titan/Sentinel added to units.json + the vanguard roster (gated by their L3 techs, so they
appear greyed in recruit until researched). Placeholder sprites: `drawTitan` (war-mech, 🗿) and
`drawSentinel` (satellite dish, 📡). 10 new engine tests (`vanguard2.test.ts`); 159 pass.

Known small gaps: Kinetic Shield only absorbs attack-path damage (not push-bump/percussive
splash); Raiding/Tracer Rounds/other tech upgrades still TBD (memory notes).

TTR: none — no economy stats changed.
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

## 2026-07-13 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Integration: rebased local batch onto the faction rework; sprite key
ironclad:warrior → vanguard:warrior.** The parallel branch replaced
Ironclad/Sylvan with Vanguard & Hive (c0199d2), which is exactly the faction
the warrior art was made for — the 2026-07-08 placeholder mapping to
`ironclad` is superseded. Merge notes: kept both sides of the mapgen options
(doubleResources multiplier + impassable/mountain budgets), kept the new
red-tint recruit roster over the old filtered list, and both rationale-log
tails were preserved per the append-only rule. All 93 tests pass post-rebase;
live smoke test shows the Vanguard warrior sprite on GEN 5 under the new fog.

## 2026-07-13 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Vanguard unit art v2 (Rigbound): all 4 recruitables, Polytopia-style duo
facings.** Per Patrick, from `~/Rigbound - Art Prototyping/Units/Vanguard/*`
("-A" picks). Each sheet held BOTH front views; split along the transparent
gap, facing judged per figure (weapon direction + visor), and named copies
saved back into his source folders (e.g. "Warrior SE.png" / "Warrior SW.png").

- Units mapped: Warrior→warrior, Scout→scout, Lancer→lancer, Bulwark→defender
  (the in-game name for defender IS Bulwark). Only these four — the game's
  recruit roster — get sprites; Tank/Stalker/Titan/Wraith/Sentinel folders are
  future units, and all Hive units keep vector drawers.
- New duo mode in unitSprites: only se/sw front views load; ne→se and nw→sw
  (Polytopia behaviour — no back views). If a side's file were missing, the
  other mirrors at draw time (ctx horizontal flip about the unit axis, wrapped
  around glow/main/flash passes) — unused for these sets since both views are
  real art (Bulwark's V emblem stays correct).
- Same body-anchored normalization as before, with a tweak: the foot row comes
  from columns ≥30% of max height (includes the scout drone's thin legs) while
  centering uses ≥45% columns (excludes sword/rifle). Old GEN 2 warrior set
  (/units/vanguard_warrior) deleted — superseded.
- Per-unit scale: warrior 70px, lancer 70, bulwark 76, scout 48 (drone).

Verified live: all four render on their tiles facing SE; shifting each one
tile in −x flips every unit to its SW art (sword/rifle/shield all switch
sides). Typecheck passes.

## 2026-07-13 — Patrick Tomczak (patrick.tomczak.1@gmail.com)

**Unit centering v2 + ownership ring removed.** Per Patrick: units sat slightly
off tile centers, and the player-color ellipse under sprite units was unwanted.
(1) Sprite anchoring switched from the body-column midpoint to the GROUND-
CONTACT CENTROID — the alpha-weighted center of the bottom ~7% band of the
figure (boots / drone feet / shield base). A 3/4-view figure's visual ground
footprint isn't centered under its torso, which was the visible offset.
Contracts rebuilt, registry metrics updated (on-screen body heights unchanged).
(2) The ownership rim ellipse is deleted from the sprite path — shadow, white
selection ring, glow, and HP bar remain; ownership reads from the HP-bar side
and territory colors. Verified live in both facings.

## 2026-07-14 — Patrick Tomczak

**Merged `economy` (David) into `main`.** One conflict in
`apps/web/src/iso/drawUnit.ts`: main's unit-art-v2 commit added a `flip` flag to
the sprite lookup (Polytopia-style mirroring for the missing SE/SW facings),
while economy added an owner-colored rim ellipse under sprite units (the sprite
art isn't team-colored, so without it you can't tell whose unit it is). The two
changes are orthogonal — resolution keeps both: the rim draws first, then the
sprite is destructured with `flip` and mirrored as before. Verified with the
full test suite (159 passing), `validate-data`, and a web-app typecheck.

## 2026-07-14 — Rigbound art for the full Vanguard roster; ownership-ring regression fix (Patrick Tomczak / patrick.tomczak.1@gmail.com, via Claude)

**What changed**
- Split the remaining "-A" sheets in `Rigbound - Art Prototyping/Units/Vanguard/`
  (Sentinel, Stalker, Tank, Titan, Wraith) into per-facing PNGs. Labelled copies
  (`<Name> SE.png` / `<Name> SW.png`) saved back into each source folder;
  ground-contact-normalized copies live in `apps/web/public/units/vanguard/<typeId>/`.
- Registered all of them in `unitSprites.ts` as faction-scoped duo (SE/SW-only,
  Polytopia-style) sets. `tank_assault` reuses the tank art. Every Vanguard unit
  class with art now renders sprites; Hive keeps vector drawers.
- Titan's sheet has only a SW view — its SE facing renders through the
  mirror-at-draw flip fallback. This is the first real user of that path;
  verified live that SE/SW are exact mirrors and the registry resolves
  se→sw.png+flip.
- Facing reference (how each sheet was read): Sentinel top=SW/bottom=SE,
  Stalker top=SW/bottom=SE, Tank top=SE/bottom=SW, Wraith left=SW/right=SE,
  Titan single=SW.

**Why / notes**
- The blue ownership ring under sprite units, removed in 914124d at Patrick's
  request, silently returned in merge a2842f0: David's branch predated the
  removal and touched the same hunk (cloak ghosting), so the merge kept his
  version of the block. Removed it again, preserving the cloak `baseAlpha`
  ghosting (Wraith renders at 0.5 alpha to its owner — intentional REB rule).
- Dev-server note: another local project (Lumin) now occupies Vite's default
  port 5173; Tactica verification ran on `npx vite --port 5190 --strictPort`
  from `apps/web`.

## 2026-07-15 — GEN 6 desert tileset (MJ "Scenario" set) as a Map Generation option (Patrick Tomczak, via Claude)

**What**
- Added `gen6_desert` tile theme: 20 sprites normalised from
  `Rigbound - Art Prototyping/Maps/GEN 2/DESERT - MJ_Scenario.png` by
  `Tileset_Script/tile_normalizer.py`, copied to `apps/web/public/tiles/gen6_desert/`
  (open/scatter/pebbles/cactus/rocks ground variants, boulders, two rock towers,
  one arch). Registered in `tileSprites.ts` and exposed in SetupScreen's
  "Map Generation" dropdown as "GEN 6 - Desert (Scenario)".

**Why / notes**
- Unlike gen5_desert (mixed 512×384 slab / 512×768 tall canvases needing per-file
  nudges), every gen6 sprite shares ONE 512×768 canvas with the anchor at
  (256,672), so a single `topOffsetY = -416·(108/512) = -87.75` places all 20
  files and the `nudge` table is unnecessary. Uniform canvases are the contract
  going forward for sets produced by tile_normalizer.
- Terrain mapping: plains draws from a weighted pool (plain open ×2 vs decor ×1)
  so boards read as ground with occasional cacti/rocks rather than clutter;
  forest → boulders + dense cacti (cover read); mountain → towers + arch;
  water/lava → towers (set has no liquid art, matching gen5's barrier approach,
  `flushLiquids: true`).
- This set's diamonds are ~1.43:1 in the source art; the normaliser warps them
  to the exact 2:1 / 512-wide contract, so no anisotropic `spriteH` is needed.

## 2026-07-15 — ITB desert tileset as a Map Generation option (Patrick Tomczak, via Claude)

**What**
- Added `itb_desert` tile theme: 20 sprites from
  `Rigbound - Art Prototyping/Maps/ITB/DESERT/Desert - ITB.png`, keyed and
  normalised by Tileset_Script, copied to `apps/web/public/tiles/itb_desert/`,
  registered in `tileSprites.ts`, exposed in SetupScreen as "ITB - Desert".

**Why / notes**
- Source sheet was RGB with a baked white background (no alpha); keyed via
  border flood-fill (tol 12) + alpha-unmix defringe before normalising.
- One tower's summit touched the tile above it on the sheet, merging them into
  a single alpha component; tile_normalizer now splits merged components via
  erode-until-split + nearest-core pixel assignment, so the tower kept its
  summit rather than being cut at the sheet's cell boundary.
- Slabs are thicker than the gen6 set (two block rows), so the shared 512×768
  canvas uses anchor (256,624) → single topOffsetY = −77.625, no nudges.

## 2026-07-15 — ITB desert: white edge-fringe fix (Patrick Tomczak, via Claude)

**What**
- Re-keyed and re-normalised all 20 `itb_desert` sprites; replaced in place.

**Why / notes**
- The first keying pass flood-filled only pixels within tol 12 of pure white,
  so the anti-aliased gradient between each tile's black outline and the white
  background (grays ~180–250) stayed fully opaque — a 1–3px white rim around
  every tile, most visible against fog. Fix (Tileset_Script/key_white_bg.py):
  in a 4px band around the background, alpha is now derived from darkness
  (edge art is always the dark outline) and the white contribution unmixed
  from the color. Verified: 0 near-white opaque edge pixels (was 191 on
  open_01) and clean borders in-game.

## 2026-07-15 — MTP resource props for gen6_desert + itb_desert (Patrick Tomczak, via Claude)

**What**
- Sliced `Rigbound - Art Prototyping/Resources/Resources - MTP.png` (ore crystal
  cluster + plasma orb, native alpha) into tight-cropped `ore.png`/`plasma.png`,
  copied into both `public/tiles/gen6_desert/` and `public/tiles/itb_desert/`,
  and wired `resources: { ore, plasma }` + `resourceMode: 'object'` into both
  ThemeDefs so resource tiles plant the themed props instead of vector crystals.

**Why / notes**
- Both desert themes share the same prop files (duplicated per theme dir since
  sprite lookup is `${theme}/${key}` off the theme's base path). Verified in
  game with Double Resources: props scale via RESOURCE_OBJECT_SCALE and sit
  centred on their tiles in both themes; console clean.

## 2026-07-16 — PIX Titan sprites + muted team colors via magenta mask (Patrick Tomczak, via Claude)

**What**
- Replaced the Titan's single SW view with the `-PIX Titan SW.png` pair
  (actually SW + SE despite the name), normalized by Tileset_Script's new
  `unit_normalizer.py` (class heavy, shared pair scale, 256×268 canvas,
  foot row 248). Both facings now render real art — no mirror fallback.
  Unit sprites are theme-independent, so this applies to every mapgen option.
- Added TEAM_COLORS (muted: #5f7a9a / #9a5f5f) in constants.ts. Unit art may
  carry MAGENTA mask panels (hue 270–335, sat ≥ 0.35); on sprite load,
  unitSprites.ts bakes one recolored canvas per team — team hue, saturation
  scaled by the mask's, pixel value scaled by the team color's value so
  shading survives and the result stays muted. getUnitSprite() takes the
  owner index; drawUnit passes unit.owner. Sprites without a mask render
  unchanged.

**Why / notes**
- Muted palette chosen deliberately (per Patrick) so two same-faction armies
  read as teams without neon. First cut (#ad7d7d + value floor 0.35) rendered
  washed-out pink; fixed by anchoring the brightest mask pixel exactly to the
  team color's value.
- Note for later: a generic death animation already exists (IsoCanvas
  DEATH_FADE_MS = 600ms fade-out, white flash on combat kills) — do not
  re-implement.

## 2026-07-16 — Titan foot anchoring + resource prop placement (Patrick Tomczak, via Claude)

**What**
- Titan floated above its tile: unit_normalizer anchored the sprite's lowest
  pixel (the drooping gun barrel tip, ~36px below the feet) to the ground row.
  Added body-aware anchoring (rows/cols under 30% of the max width are treated
  as protruding weapons and excluded from the foot row + horizontal centering,
  echoing the old "-A sheet" pipeline convention). Titan re-exported at
  260x252, footY 217; def updated with drawW 107.7 to preserve world scale.
- Resource props (MTP ore/plasma) hugged the top half of tiles:
  RESOURCE_OBJECT_BASEFRAC 0.86 -> 0.60 in drawTile.ts, so tight-cropped props
  (no baked ground shadow) straddle the diamond centre with a slight downward
  bias, matching how the tile art's own rocks sit. Only the two desert themes
  use object mode, so nothing else shifts.

## 2026-07-16 — Organic tile seams for gen5_desert (Patrick Tomczak, via Claude)

**What**
- Baked wobbly, hand-drawn-looking crack lines into the gen5_desert tile
  sprites (Tileset_Script/apply_tile_seams.py; originals kept clean in
  Tileset_Script/out_desert, seamed copies in out_desert_seamed).

**Why / notes**
- Reference: MJ render with organic dark separations between tiles. Trick for
  clean tessellation: each sprite carries a seam on its TOP-LEFT and TOP-RIGHT
  diamond edges only — painter's order means the front tile overdraws its back
  neighbours, so every interior boundary shows exactly one line, and per-variant
  random wobble (pinned at the shared corner vertices) makes boundaries vary
  by which tiles happen to meet. 5px stroke at the 512 master scale survives
  the ~5x downscale to ~1px in-game.
- Reusable on any tile_normalizer output dir if we want the same look for
  gen6_desert / itb_desert.

## 2026-07-17 — GEN 7 Industrial theme with theme-scoped Vanguard unit skins (Patrick Tomczak, via Claude)

**What**
- New "GEN 7 - Industrial" Map Generation option from asset_rhtfi4… (tiles
  sheet): 15 floor plates only (9 metal + 3 cracked + 3 rubble variants) —
  walls/buildings/crates/FX on the same sheet deliberately unused. Normalised
  by tile_normalizer (Tileset_Script/out_gen7), uniform 512×384, seamless.
  The three touching plate columns were auto-split; MTP ore/plasma props
  reused. This pack has no tall formation art: impassable terrain (mountain/
  water/lava) reads as heavy rubble tiles.
- NEW MECHANISM — theme-scoped unit skins in unitSprites.ts: registry keys may
  be prefixed `${tileTheme}::`; getUnitSprite resolves theme-scoped set →
  faction set → global set using getActiveTheme(). While GEN 7 is the active
  theme, all 9 Vanguard classes (plus tank_assault) render the stone-plated
  mech roster from asset_h3JH… (9 SW/SE pairs, split + body-anchored by
  unit_normalizer into public/units/vanguard_gen7/). Other themes keep the
  existing Rigbound art untouched.

**Why / notes**
- Sprite→class mapping by silhouette/role: sword→warrior, rifle→sentinel,
  spear→lancer, shield→defender, clawed→stalker, tank→tank, winged→wraith,
  bruiser→titan, small walker→scout.
- unit_normalizer gained a --dilate flag: four pairs sat close enough that the
  default 15px join-dilation merged the two facings into one figure.

## 2026-07-21 — voxel3d: Three.js arena renderer as a selectable render option (Patrick Tomczak / Claude)

**What changed**
- New self-contained 3D renderer at `apps/web/src/render/voxel3d/` (r3f v8 +
  drei + postprocessing on three 0.175.0), selectable via `?renderer=voxel3d`
  or an on-map 2D/3D toggle. The 2D iso canvas remains the default and was not
  modified. The three.js stack is lazy-loaded so the 2D path's bundle is
  unchanged. `?quality=low` tier and `?debugCam=1` OrbitControls exist.
- Scene: single MeshReflectorMaterial floor (procedural value-noise
  grime/puddle roughnessMap, replaceable via a `floorTextures` config object),
  shader-grid overlay quad, instanced neon edge rim (emissive-only strips, no
  per-neon lights), exactly three lights, instanced tile highlights
  (move/threat/select/path), box-built placeholder voxel units behind a
  `buildUnit(def) → Group` seam for later glTF, drei Clouds fog-of-war,
  instanced rain, procedural city-window billboards, bloom/vignette/noise.

**Why / key decisions**
- Kept the deterministic engine and mapgen output untouched: the renderer
  adapts `VisibleState` in `VoxelMapView` (units → UnitView, legalActions →
  highlights, clicks → the same store actions the iso canvas drives). "Threat"
  tiles are the selected unit's attack/slash targets — the engine has no
  standalone threat map.
- Built voxel3d fresh with zero imports from `src/iso/` (per Patrick's
  direction "don't adapt old mechanisms — assume the option is built off
  voxels"): own palette, own facing derivation, terrain as voxel block props
  (mountains/forests/cities/ruins/crystals). Supersedes nothing — the iso
  renderer stays; this is an additive option.
- Fog integrity: hidden tiles get NO terrain/prop placement at all; drei Cloud
  puffs (sprite vendored at `apps/web/public/voxel3d/cloud.png`) are drawn on
  top. Ecosystem libs preferred for reflections/weather/particles per
  Patrick's direction; rain stays a custom InstancedMesh (no maintained
  drop-in fits).
- three pinned to 0.175.0 via a root `overrides` (regenerated
  package-lock.json): the newest three (0.185) deprecation-warns on
  THREE.Clock (used internally by r3f v8) and PCFSoftShadowMap, and npm's
  workspace hoisting otherwise installed two three copies. 0.175 is the newest
  release that keeps the console clean with the r3f v8 / postprocessing 6.39
  lines (React 18 forces the r3f v8 line).
- Light intensities (ambient 0.65, key 1.7, corner point 60/dist 30) sit above
  the design spec's legacy-mode values (0.5 / 1.1 / 0.6) because three r155+
  physically-based lighting + ACES rendered the spec values unreadably dark.
- A `VoxelErrorBoundary` shows a fallback message when WebGL is unavailable
  instead of unmounting the whole app (found via headless testing, where
  context creation fails).

## 2026-07-21 — voxel3d: reference-image look pass (Patrick Tomczak / Claude)

**What changed** (after Patrick shared the cyberpunk arena reference image and
asked to match it as closely as possible): floor re-textured as per-tile worn
metal plates baked into the reflector's procedural albedo/roughness — chosen
over real per-tile slab meshes because the planar reflector must remain one
plane; seams/bevels in the albedo give the chunky-tile read, and interior tile
thickness isn't visible from the game camera anyway. Platform edge rebuilt
(flush lip, white-cyan perimeter dashes, railings, tiered hull + pillars +
greebles), procedural neon glyph signage (blocky strokes instead of shipping a
CJK font), background switched from flat billboards to 3D window-lit towers
behind tightened fog, unit visors glow in team colour, rain density cut 80%
(1500 → 300 streaks) on Patrick's request.

## 2026-07-21 — voxel3d: CC0 internet assets + AO/IBL pass (Patrick Tomczak / Claude)

**What changed** (Patrick asked what engines/packs could be pulled off the
internet to improve the renderer): vendored CC0 assets into
`apps/web/public/voxel3d/` — Kenney "Blocky Characters" GLBs now render the
human-scale units via the buildUnit seam (heavies keep the box mech), Poly
Haven night HDRI as subtle lighting-only IBL, ambientCG MetalPlates006 normal
map for floor micro-relief. Enabled N8AO (already bundled in
@react-three/postprocessing) for contact occlusion, high tier only.

**Why / notes**
- All CC0 (no attribution required; Kenney licence file vendored alongside).
  Assets are committed to the repo so builds and runtime stay fully offline.
- The pack's materials are KHR-unlit; converted on load to flat-shaded
  MeshStandardMaterial so the key light, shadows and AO apply, tinted toward
  the owner's team colour + a team visor glow added for bloom/allegiance.
- environmentIntensity 0.18: at 0.35 the IBL washed out the dark neon-noir
  mood the reference image calls for.
- Debugging note: the "floating orange wedge" Patrick may see near the west
  edge on some seeds is a LAVA tile partially occluded by a neon sign — real
  terrain, not a glitch; its pane was toned down to read as ground.

## 2026-07-21 — voxel3d: "Perfect Graphics.png" target pass (Patrick Tomczak / Claude)

**What changed**: Patrick placed the target frame at repo root
("Perfect Graphics.png") and asked for the renderer to match it. Closed the
remaining gaps: brighter violet world (ambient 0.95, purple shadows — the
reference has no true blacks), floor lifted to mid blue-grey plates with
bright seam grid + teal/magenta/rust splatter, richer tower facades
(per-building window scale, balcony bands, ad billboards, rooftop antennas
with red beacons), bokeh light dots, longer rain, bloom 1.3, pedestal crates
under glTF characters, decorative red scan cones under hostile heavies, and
the earlier Pixelation pass (granularity 5, ?pixel=N override) that puts the
whole frame on one fat-pixel grid.

**Remaining, out of renderer scope**: the reference's AP pips / turn banner /
portrait panel are game HUD (separate module), and per-unit outfit variety
needs authored voxel models via the buildUnit seam.

## 2026-07-21 — voxel3d: bespoke voxel models for all 24 units (Patrick Tomczak / Claude)

**What changed**: every unit id in units.json now has a hand-authored
box-voxel model in `apps/web/src/render/voxel3d/units/unitDefs.ts`, designed
from its stats/conditions/abilities (e.g. blind Scuttling has no eyes, just a
team marker; Tank's assault morph deploys outriggers + a spotting mast for its
vis 3; Seercaust's Spray Bile shows as glowing bile sacs). Kenney glTF
characters removed — the pack couldn't express per-unit roles. UnitPartDef
gained per-part rotation. `?unitGallery=1` renders one of each kind for
review. Scan-cone "heavy" list now matches unitClass: heavy in the data.
Models are data (parts arrays), so a future .vox/glTF pipeline can still
replace buildUnit behind the same interface.

## 2026-07-21 — desert biome: mapgen option + voxel3d desert theme (Patrick Tomczak / Claude)

**What changed**: 'desert' added to the engine's Biome union with its own
classifier (sand seas, budgeted mesa band, rare lava vents, moisture-spike
scrub oases). Discovery during this work: with ENABLE_WATER_LAVA=true the
biome dropdown had NO effect — all maps used waterLavaTerrain regardless of
the selected biome. Desert is routed explicitly around that flag so
grassland/stone behaviour stays byte-identical; whoever owns the classifier
flag may want to decide whether grassland/stone should regain meaning
(left as-is deliberately). voxel3d detects an arena theme from dominant
terrain (>30% sand → desert) and swaps its dressing (rust plates, mesas,
saguaros, warm dusk lights, no rain) while keeping the neon-noir identity.
SetupScreen gained a Desert option — NOT committed with this change because
the file carries Patrick's uncommitted tile-theme edits; it ships whenever
that file is next committed. Dev note: Vite pre-bundles workspace packages,
so engine edits need a dev-server restart + .vite cache clear to appear.

## 2026-07-21 — voxel3d review pass: desert coherence (Patrick Tomczak / Claude)

**What changed** (Patrick flagged that the desert floated in a neon city and
the tiles had a grate texture): desert now has a wasteland horizon (buttes +
two radio masts) instead of window towers/signage/bokeh/rain, which are
city-only; the metal diamond-plate normal map no longer applies to desert
floors (it read as a grate) and is softened in the city; desert floor
de-metallized (0.4 → 0.12) so only puddles mirror; desert edge dashes are
amber. Plus small code cleanups (dead texture fn, duplicate odd-width dash,
inline type import). Deliberately kept: the night-city HDRI as desert IBL
(lighting-only, generic), the >30% sand theme heuristic, and the floating-
platform framing itself — the arena-as-floating-stage is the game's visual
identity across biomes.

## 2026-07-21 — voxel3d: space backdrop replaces the neon city (Patrick Tomczak / Claude)

**What changed** (Patrick's direction: "remove all the asian neon elements,
just make it the tileset floating in space, parallax stars"): Signage,
CityBlocks towers, haze, bokeh, dust motes and rain deleted along with their
procedural texture generators; backdrop is now a deep indigo void with a
three-layer parallax starfield (layers follow fractions of the camera pan —
an orthographic camera has no natural translation parallax). Removing the
scene fog revealed the arena's lighting had been leaning on fog for its dark
grade, so the rig was rebalanced (ambient 0.3, key 1.0, mixStrength 3).
This supersedes the earlier reference-image city direction — the platform,
edge lighting, floor themes and fog-of-war are unchanged.

## 2026-07-22 — voxel3d: heavy simplification to an SC1-style space platform (Patrick Tomczak / Claude)

**What changed** (Patrick's direction, superseding both the cyberpunk
reference-image look AND the course-correction that restored it): the arena is
now a clean cube-grid platform floating in a parallax starfield — no signage,
city backdrop, neon perimeter dashes, greebles, railings, or bounce lights.
Impassable terrain (water/lava) renders as holes in the platform (alpha-cut
through the single reflector plane + hole-mask-aware grid shader). Terrain
props minimal: one block per mountain, one tree per forest, plain saguaros.
The cyberpunk look remains recoverable from git history (tags around
d1a249f–942459c) if the direction swings back.
