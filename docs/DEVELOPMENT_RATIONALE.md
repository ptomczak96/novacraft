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
