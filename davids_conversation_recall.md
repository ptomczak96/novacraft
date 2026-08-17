# David's Conversation Recall

> **Purpose:** A durable brain-dump of everything worked on and discussed across our
> sessions, so a fresh Claude can read this file and be fully up to speed. Written
> 2026-08-17. Append-only in spirit; update as work continues.
>
> **How to use on reopen:** Read this top-to-bottom, then skim `docs/DEVELOPMENT_RATIONALE.md`
> (the authoritative dated decision log), `docs/ECONOMY.md`, `docs/conditions.md`, and
> `MEMORY.md` (auto-memory index). Then `git log --oneline -15` to see where the code is.

---

## 0. Who / how to work with David

- **Project:** Rigbound — a Polytopia + StarCraft-inspired deterministic turn-based strategy
  game. TypeScript monorepo. Repo folder is `novacraft`. Branches: `main` (default) and
  `economy`. Dev server: **http://localhost:5173** (Vite default — NOT 5180; that was a stale
  note that caused repeated confusion, now corrected).
- **Git author:** David (email on the commits is patrick@artisanornaments.com.au — it's a
  shared repo owned by `ptomczak96` on GitHub; David and his brother Patrick both contribute).
- **Working style / standing preferences (IMPORTANT — keep doing these):**
  - **End every reply with a big ASCII banner:** `DONE!` when a task is finished & verified,
    `QUESTION!` when pausing to ask. (He explicitly asked me to bring this back mid-session.)
  - **Commit/push ONLY when explicitly asked.** Never pre-emptively.
  - **Commit messages end with:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  - **`docs/DEVELOPMENT_RATIONALE.md` is append-only and updated AUTOMATICALLY without asking**
    after every design decision. Never overwrite prior entries; supersede with a new dated one.
  - **After any engine/data change, restart the Vite dev server** (kill vite, clear
    `node_modules/.vite` cache, `npm run dev`) — HMR misses engine/data changes.
  - **Report TTR (Turns To Return)** inline on any economy-stat recalculation.
  - **"Pull from GitHub" = full integrated pull:** merge origin/main, resolve conflicts, verify
    (tests + typecheck), restart dev.
  - Correct David's terminology mix-ups gently (he's asked for this; says he understands ~60-80%
    of the technical terms).
  - He appreciates being walked through trade-offs plainly ("explain like I was kicked in the
    head as a child" was his phrasing once) — give a recommendation, not an exhaustive survey.
  - **"commit to overlap"** = append an entry to `docs/overlap.md` for cross-module hand-offs.
  - **"make a note" / "recall notes"** = store/retrieve via the memory system.

## Architecture rules (from CLAUDE.md — non-negotiable)

1. Engine is a pure, deterministic state machine. Public API ~ `createGame`, `getLegalActions`,
   `applyAction` (returns NEW state, never mutates), `getVisibleState` (fog-filtered), `getResult`.
2. All randomness flows through a seeded PRNG in GameState. Same seed + actions = identical game.
3. GameState is fully JSON-serializable (no classes/methods/Maps/Sets in state).
4. All game content is DATA not code — `/packages/data/json/*.json`.
5. Abilities composed from primitives: damage, push, heal, applyStatus, revealArea, spawnUnit, modifyStat.
- Workspace: `/packages/engine` (pure, ZERO browser imports), `/packages/data` (JSON + zod),
  `/packages/bots` (AI), `/packages/sim` (headless CLI), `/apps/web` (Vite+React+Zustand+canvas iso
  renderer + Patrick's three.js voxel3d renderer).
- Commands: `npm run dev`, `npm run sim -- --games N ...`, `npm test` (vitest), `npm run validate-data`.

---

## 1. Chronological log of what we did (most recent last)

### Tech-cost mechanics understanding
- **Ore tech cost** (`tech-config.json`): `cost = base + perCity × (cities-1)`. Base by level
  50/60/70; perCity 10/20/30. R&D tech knocks 10% off (ore only). Research has **no per-turn cap**.
- We analysed making the plasma-resource the scarce, map-contested bottleneck for high tech.

### Plasma tech costs (NEW mechanic — research was ore-only before)
- Added optional `plasmaCost` + `plasmaCostPerCity` fields to techs. Cost scales linearly with
  city count: `plasmaCost + plasmaCostPerCity × (cities-1)`. Undiscounted (R&D is ore-only).
- Engine: `techPlasmaCostForPlayer` in `tech.ts` (exported). Research checks/deducts plasma in
  both `getLegalActions` and `applyResearch`. UI: tech cards show `X◈ Y🔥`.
- **Vanguard costs:** Small Arms/Triage/Advanced Weaponry/Engineering/Forge = none. Advanced
  Biomed, Infiltration, Tactical Engineering, Mech Bay, Crucible, Tracer Rounds = 5 (+5/city).
  Sentinel, Precision Targeting, Composite Plating, Titan, Advanced Projectiles = 10 (+10/city).
- **Hive costs:** Reaper/Scab/Seercaust/Ravener = none. Burstling, Vindrace, Adrenal Glands =
  5 (+5/city). Hardened Carapace, Berserker Glands, Behemoth, Wyrm, Tunneling Network,
  Aftershock = 10 (+10/city).

### Hive Armory rearrange
- **Adrenal Glands** moved L1→L2 (next to Vindrace), still gated by Reaper. Now grants Reaper
  **Dash II** + **Scuttlings +1 movement** (new `fleet_N` condition = +N base movement, parsed in
  pathfinding like dash_N). No longer grants Creep.
- **Creep** (`aoi_immune` on Reaper) moved from Adrenal → **Berserker Glands** (L3, behind Behemoth).
- **Burstling** re-gated from Vindrace → **Reaper**. So Reaper unlocks Burstling + Vindrace +
  Adrenal Glands.
- **Hardened Carapace** retargeted Reaper → **Vindrace**. ⚠️ NOTE: its "survive any hit at 1 HP"
  effect was NEVER engine-wired (empty effects) — it's a UI placeholder. Retarget is descriptive
  only until someone builds the survive-at-1 condition.

### Plasma icon → exact-red flame
- Replaced the 🔥 emoji (uncontrollable colour) with a single-path SVG flame filled with one
  exact red. Source of truth: `apps/web/src/plasmaFlame.ts` (`PLASMA_RED = #ff4a2a`, `FLAME_PATH`,
  a preloaded canvas image + `drawPlasmaFlame()`). React uses `<PlasmaIcon/>`
  (`apps/web/src/components/PlasmaIcon.tsx`). Applied everywhere: top bar, Inspector,
  EconomyBreakdown, TechTreeView cost, EvoRecruitPanel, MapView tile-info.
- ⚠️ LevelUpModal's "+10 Plasma" reward icon is still the emoji 🔥 (that popup is an all-emoji
  menu; a lone red SVG would clash). Also the canvas build/upgrade cost-label flame was later
  DROPPED in the GEN-8 merge (we took Patrick's IsoCanvas wholesale) — the flame shows everywhere
  else via PlasmaIcon.
- Colour `#ff4a2a` is a guess at the old fiery look; trivially retunable in one place.

### Odysseus / Achilles buttons + bot
- Replaced the "Train vs AI" setup button with **Odysseus** and **Achilles** buttons.
- **OdysseusBot** (`packages/bots/src/odysseusBot.ts`) extends GreedyBot with an `ODYSSEUS_NORMAL`
  weight profile. Achilles is a GreedyBot placeholder (Patrick's brother's slot for a brute-force
  RL bot). Both selectable in the AI-vs-AI control dropdowns.
- **PINNED (resume when David asks):** the Odysseus AI eval-function build. We drafted a feature
  list + "Normal" weight profile. Pending David's answers on: (a) sanity-check the value hierarchy
  cities ≫ economy > army > tech > control, (b) plasma vs ore weighting ratio, (c) tech tempo,
  (d) confirm "build increment 1" = upgrade Odysseus from action-scoring to state-eval + 1-ply
  search. Lots of AI education happened (eval functions, search, minimax/alpha-beta vs policy,
  MCTS, RL sparse-reward, self-play, why Polytopia AI cheats via handicaps, AlphaStar league,
  compute costs). Odysseus = handcrafted + scalpel-RL (adapts to balance changes for free);
  Achilles = brother's brute RL.

### Economy / REB overhaul (the big one)
- **Design goal David set:** economy should FAVOUR EXPANSION. TTR *increases* with REB level, so
  a fresh L1 REB in a new city pays back faster than upgrading one to L3 → wide beats tall. Plasma
  is the scarce, contested resource (spawns centre-map) meant to bottleneck high tech.
- **Refineries & Purifiers CAPPED AT L1** (removed L2/L3 upgrades + their techs — too many unknown
  economic variables to tune now; "likely return later").
- **Current REB numbers (`economy.json`):**
  - **Mine** (free, no tech): cost 50/70/90, output +10/20/30, supply 1/2/3 (L3 was +2, now +1).
  - **Extractor** (L1/2/3, gated by single `extractor` tech): cost 100/200/300, output +5/+5/+5
    (total 5/10/15), supply +1/+1/+1.
  - **Refinery** (L1 only, gate `refinery_1`): cost 150, +20 ore AND +1 supply **per adjacent
    same-city mine** (`supplyPerAdjacentByLevel`). Kept +20 ore/adjacent (David didn't restate the
    ore output when giving the spec — I kept it; he's OK with refinery still boosting ore).
  - **Purifier** (L1 only, gate `purifier_1`): cost 200, +5 plasma AND +1 supply per adjacent
    same-city extractor.
- **KEY ENGINE FACTS we established:** REBs GIVE supply (they don't cost it) — supply accumulates
  toward city level-ups (thresholds [2,5,9,14,20,27,35]) → pop/territory/income. There is NO unit
  upkeep (upkeepMultiplier = 0). Refinery output counts adjacent MINES (buildings, not ore tiles),
  mine LEVEL is irrelevant to the refinery, only 1 refinery/purifier per city, adjacency =
  Chebyshev ≤1 same-city. So the efficient ore build is cheap L1 mines + 1 refinery.
- **Analysis findings (from a throwaway sim we ran):** the old 11-REB-tech scheme taxed expansion
  hard (720 ore @1 city → 1680 @5 cities just to unlock REBs); simplified 3-tech scheme = 150→270.
  Time-to-online: old 22 turns vs simplified 15.

### "Resources" tech branch rebuild (renamed from "Refinement")
- Renamed the branch tab **Refinement → Resources** (kept internal id `refinement` so wiring holds).
- **New layout (both factions share this tree during testing):**
  - L1 roots: **Prospecting**, **Colonial Charter**.
  - EITHER L1 root unlocks BOTH **Extractor** (L2) and **Refinery** (L2) via `prerequisitesAny`.
    ⚠️ I chose EITHER (not BOTH) — flagged for David to confirm; he hasn't objected.
  - **Extractor** → Sprawling Borders (L2), Roads (L3), Purifier (L3).
  - **Refinery** → Slag Wash (L2), Habitation Domes (L3), Cross Border Resources (L3).
  - **Renames (same effects, engine ids preserved):** Sprawling Borders = `borderless`;
    Cross Border Resources = `cross_border`.
  - **Mines are now FREE** (removed mine_2/mine_3 techs). **Extractor is ONE tech** unlocking all
    extractor levels (replaced plasma_1/2/3).
  - **Cut/Unused cluster** (right side, labelled "Unused / Cut Tech"): **R&D, Reinforced REBs,
    Automated Extraction, Transmutation** — set `locked:true` (un-researchable), shown greyed with
    "✂ CUT". Kept in data for easy revival. New UI: TechNode `cut`/`heading` flags, a `cut` card
    state, a `.tech-heading` cluster label.

### GEN-8 merge (Patrick's graphics)
- Patrick pushed GEN-8 work (3D tileset map, sun lighting, HUD port, Reaper, ability system,
  attack FX) to origin/main, then more (VFX/Titan) on branch `codex/ashwater-vfx-titan`.
- We did a full integrated pull. First merge (origin/main): only 2 real conflicts —
  `DEVELOPMENT_RATIONALE.md` (kept both) and `IsoCanvas.tsx` (took Patrick's GEN-8 rewrite
  wholesale, dropped my small flame cost-label tweak). Everything else (engine game.ts, types.ts,
  gameStore, GameScreen, MapView, SetupScreen) auto-merged. David's economy/tech core files
  (tech-tree.json, economy.json, tech.ts, pathfinding.ts) were NEVER touched by Patrick — zero
  conflict. Second pull (ashwater-vfx-titan) was a clean fast-forward (built on top of our merge).
- The GEN-8 (3D tileset) map uses the **voxel3d renderer** (`VoxelMapView` / `VoxelArena`);
  `tileTheme === 'gen8_tileset3d'` (or `?tileset=1`) selects it and its own neon HUD skin (`Gen8Hud`).

### Bug fixes on the GEN-8 map / 1v1 / engine (all AFTER the merge)
1. **Couldn't build REBs on the GEN-8 map.** The voxel renderer's click handler wired
   move/attack/ability but not tile-based economy actions. Fix (`apps/web/src/render/voxel3d`):
   collect build/upgradeBuilding/foundCity/captureCity from `legalActions` into a per-tile map,
   highlight those tiles (new amber `build` highlight kind in `palette.ts`/`types.ts`), execute on
   tile-click. Same legalActions/executeAction path the 2D renderer uses. ⚠️ I could not click the
   3D scene myself to verify — asked David to try.
2. **1v1 batch fixes** (PeerJS multiplayer — `gameStore.ts`, `multiplayer.ts`, `GameScreen.tsx`,
   `index.css`):
   - Hide opponent's resources: top bar shows the LOCAL viewer's (mySeat) ore/plasma & economy,
     never the current player's.
   - "Your Turn" banner (`.your-turn-banner`) pops when the turn passes to you online.
   - Turn ownership: `executeAction` ignores local (non-remote) actions when it isn't your turn
     (`mySeat !== null && currentPlayer !== mySeat`) — can't End Turn on opponent's turn. End Turn
     button also hidden unless it's your turn.
   - Tech tree shows the VIEWER's faction/researched set (your tree on opponent's turn, not theirs).
   - **MP undo enabled:** removed the hard block; undo now broadcasts `{type:'undo'}` to the peer
     (`receiveRemoteUndo`) so both revert one step in lockstep. ⚠️ Trusted honor-system; undoing
     AFTER the peer already moved can desync — accepted "for now".
3. **Same-turn city/ruin capture bug (engine `game.ts` + `economy.ts`):** `captureCity` and
   `canFoundCity` now also require `!hasAttacked` (they already required `!hasMoved`). A unit only
   reaches an enemy city/ruin the same turn by moving (hasMoved) or attack-then-dash/advance like a
   Reaper (hasAttacked) → so capture/found is only available the FOLLOWING turn.
4. **Impotent Founder also blocks capture; Wyrm gains it.** `impotent_founder` only blocked
   founding, so a Wraith could still CAPTURE (seen in sandbox). Fixed: the captureCity guard in
   `getLegalActions` now also skips `impotent_founder` units. Added `impotent_founder` to the base
   **Wyrm** (wyrm_burrowed already had it). conditions.md updated.
5. **Co-tile unit selection (both renderers):** a tile with a surface unit + YOUR burrowed Wyrm
   only ever selected the surface unit on the GEN-8 map (voxel handler used a single `.find()` with
   no cycling → Wyrm unreachable). Fix: gather ALL units on the tile, order burrowed LAST, cycle on
   repeat clicks: 1st click = surface unit, 2nd = burrowed Wyrm (to erupt/move), 3rd = tile, loop.
   Aligned IsoCanvas to the same order (it used to select burrowed FIRST — superseded).

---

## 2. Current git / verification state (as of 2026-08-17, this commit)

- All of the above is committed and pushed to **origin/main** and **origin/economy** (they mirror).
- **299 tests pass**, `validate-data` clean, web `tsc` clean.
- Patrick's GEN-8 + ashwater graphics are integrated into main.

---

## 3. Open threads / things to confirm or resume

1. **PINNED: Odysseus AI eval build** — the drafted feature list + "Normal" weight profile is done;
   waiting on David's answers (see §1 "Odysseus" bullet). Resume when he asks.
2. **Resources tree gating:** I used EITHER (Prospecting OR Colonial Charter unlocks Extractor &
   Refinery). If David meant BOTH, flip `prerequisitesAny` → `prerequisites` on those two techs.
3. **Hardened Carapace** "survive at 1 HP" is still a UI-only placeholder on Vindrace — not wired.
4. **GEN-8 build-REB fix** — needs David to click-test the 3D scene (I can't).
5. **MP undo** — honor-system, can desync if undone after the peer acted.
6. **LevelUpModal "+10 Plasma"** still uses the 🔥 emoji (intentional; ask if he wants it swapped).
7. **GEN-8 HUD End Turn button** — protected by the store guard but not visually hidden on the
   opponent's turn (offered to grey it; David hasn't asked).
8. **Deferred backlog** lives in `MEMORY.md` pointers: economy-future-notes, tech-future-notes,
   vanguard/hive tech overhaul TODOs, air-units TODOs, nodes-feature-state, AI opponent roadmap,
   plus various "pending pathing" placeholders (bile movement, mobile terrain, wyrm burrowed rules).

## 4. Key files quick-reference

- Engine tech gating: `packages/engine/src/tech.ts` (`isTechAvailable`, `techCostForPlayer`,
  `techPlasmaCostForPlayer`). `locked:true` blocks research.
- Economy calc: `packages/engine/src/economy.ts` (`canBuild`, `canFoundCity`, `buildingSupply`,
  `recomputeCities`, adjacency helpers). Building defs: `packages/data/json/economy.json`.
- Tech data: `packages/data/json/tech-tree.json`. Tech UI tree: `apps/web/src/data/techTrees.ts`.
- Turn/capture/move rules: `packages/engine/src/game.ts` (`getLegalActions`, `applyAction`).
- MP store: `apps/web/src/store/gameStore.ts` (mySeat, executeAction guard, undo broadcast).
  Net layer: `apps/web/src/net/multiplayer.ts` (PeerJS, `{type:'action'|'undo'|'start'}`).
- 2D renderer: `apps/web/src/iso/IsoCanvas.tsx` + `apps/web/src/iso/drawEconomy.ts`.
  3D renderer: `apps/web/src/render/voxel3d/` (`VoxelMapView.tsx`, `VoxelArena.tsx`, `palette.ts`).
- Docs: `docs/DEVELOPMENT_RATIONALE.md` (authoritative decision log), `docs/ECONOMY.md`,
  `docs/conditions.md`, `docs/MODULES.md`, `docs/overlap.md`, `docs/AI_OPPONENT.md`.
