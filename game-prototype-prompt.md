# PROJECT BRIEF: "TACTICA" — Turn-Based Strategy Game Prototype

You are building a rapid-iteration prototyping platform for a turn-based tactical strategy game — conceptually a cross between The Battle of Polytopia (4X-lite: economy, tech, fog of war) and Into the Breach (deterministic, readable tactical combat on a small grid). The two founders are non-programmers; this tool exists so they can design, tune, and balance the game BEFORE handing a spec to a development studio. Everything must therefore be tunable through data files and in-app controls, never by editing code.

This is a prototype, not a product. Optimise for iteration speed, clarity, and determinism — not visual polish, not performance at scale, not networking.

---

## 1. TECH STACK & PROJECT STRUCTURE

- TypeScript everywhere, strict mode on.
- Vite + React for the web prototype.
- Node (via tsx) for the headless simulation CLI.
- Vitest for tests.
- Zustand (or plain React context if simpler) for UI state. Game state itself lives in the engine, NOT in React state — React only holds a reference to the current engine state and re-renders on change.
- No backend, no database, no auth, no networking. Save/load uses localStorage and JSON file download/upload.
- Plain CSS or CSS modules. No Tailwind setup overhead unless trivial.

Structure as a single npm workspace monorepo:

```
/packages
  /engine      ← pure game logic. ZERO imports from react, dom, or anything browser-specific.
  /data        ← JSON game data + TypeScript schemas (zod) that validate it.
  /bots        ← AI players. Imports engine only.
  /sim         ← headless simulation CLI. Imports engine, bots, data.
/apps
  /web         ← Vite + React app. Imports engine, data, bots.
```

Root scripts:
- `npm run dev` → launches the web app
- `npm run sim -- --games 1000 --bot-a greedy --bot-b greedy --seed 42` → runs headless simulations
- `npm test` → runs all tests
- `npm run validate-data` → validates all JSON game data against schemas

---

## 2. NON-NEGOTIABLE ARCHITECTURE RULES

1. **The engine is a pure, deterministic state machine.** Its entire public API is approximately:
   - `createGame(config: GameConfig, seed: number): GameState`
   - `getLegalActions(state: GameState, playerId: PlayerId): Action[]`
   - `applyAction(state: GameState, action: Action): GameState` (returns NEW state; never mutates)
   - `getVisibleState(state: GameState, playerId: PlayerId): VisibleState` (fog-of-war filtered view)
   - `getResult(state: GameState): GameResult | null`
2. **All randomness flows through a seeded PRNG stored in GameState.** Same seed + same action sequence = identical game, always. Write a test that proves this (replay a recorded game twice, deep-equal the final states).
3. **GameState is fully JSON-serializable.** No classes with methods as state, no Maps/Sets in state (or serialize them explicitly). A saved game is just `{ config, seed, actions: Action[] }` — a replay log. Loading = re-applying the action log.
4. **All game content is data, not code.** Unit stats, terrain properties, tech tree, factions, costs, map layouts — everything lives in `/packages/data/*.json`, validated with zod schemas. Adding a new unit must require zero engine changes if it uses existing ability primitives.
5. **Abilities are composed from primitives.** Define a small set of effect primitives in the engine (e.g. `damage`, `push`, `heal`, `applyStatus`, `revealArea`, `spawnUnit`, `modifyStat`) and let JSON compose them into unit abilities. Special attacks in data reference these primitives with parameters.

---

## 3. GAME RULES — VERSION 1 DEFAULTS

Implement the following as the starting ruleset. CRITICAL: these are placeholder values for the founders to tune, so every number mentioned below must live in JSON data or GameConfig, not in code. Where I write a number, treat it as the default value of a data field.

**Map:** Square grid, default 12×12, configurable 8–24. Tiles have a terrain type. Terrain types (each with movement cost, defence bonus, blocks-line-of-sight flag, passable flag, resource yield):
- Plains (move 1, no bonus)
- Forest (move 2, +20% defence, blocks sight)
- Mountain (impassable to most units, blocks sight, grants extended sight if a unit stands adjacent... actually: impassable, blocks sight)
- Water (impassable to land units)
- River (move 2, -10% defence)
- Resource tile (plains variant yielding +2 income when controlled)

**Players/Factions:** 2 players for v1 (architecture must allow N). Two example factions in data with 4–5 unit types each, deliberately asymmetric so balance testing is meaningful. Shared baseline units plus 1–2 faction-unique units each.

**Units:** Each unit has: cost, max HP, attack, defence, movement points, attack range, sight range, abilities[], traits[] (e.g. `flying`, `aquatic`, `ignoresTerrainCost`). Example roster: Scout (cheap, fast, high sight), Warrior (line infantry), Archer (range 2), Defender (high defence, slow), Catapult (range 3, cannot move+attack same turn), plus faction uniques.

**Turn structure:** Alternating full turns (player A moves all units, then player B). Each unit may move and attack once per turn (order: move-then-attack allowed; attack-then-move not, unless unit has a trait permitting it).

**Combat:** Deterministic by default — NO damage RNG (this is the Into the Breach DNA). Damage formula:
`damage = attacker.attack × (attacker.HP / attacker.maxHP) × terrainDefenceModifier(defender) − defender.defence`, minimum 1.
Defender retaliates at half attack if the attacker is within the defender's range and defender survives. Put the formula's coefficients (HP scaling on/off, retaliation multiplier, minimum damage) in GameConfig so the founders can experiment with adding variance later (e.g. a `damageVariance: 0–0.3` config field that, when > 0, uses the seeded PRNG).

**Economy:** Each player has one starting City tile. Cities and controlled resource tiles produce income per turn (city: 3, resource: 2). Income spends on recruiting units at any owned city. Capturing: a unit standing on an enemy/neutral city for one full turn captures it.

**Tech tree:** Simple v1 — a JSON-defined DAG of ~8 techs. Each tech costs income, takes effect instantly, and either unlocks a unit type or grants a global modifier (e.g. +1 movement on roads, forest movement cost 1, +20% city income). Engine just needs: prerequisites, cost, effects (using the same effect-primitive system).

**Fog of war:** Tiles are hidden / explored / visible. Units see `sightRange` tiles (blocked by sight-blocking terrain — implement simple shadowcasting or radius-with-blockers, keep it simple). Enemy units only visible on visible tiles. Toggleable per-game in config (off = perfect information, for Into-the-Breach-style testing).

**Win conditions (configurable, any combination):** capture all enemy cities; eliminate all enemy units; highest score at turn limit (default limit 50; score = cities×10 + units' total cost + income×2).

---

## 4. WEB APP REQUIREMENTS (apps/web)

A single-page tool with these features. Function over beauty, but keep it clean and legible — generous tile size, readable labels.

1. **Map view:** rendered square grid (HTML/CSS grid or canvas — your call, simplest robust option). Distinct terrain colours/icons, units as simple shapes/emoji with HP bars, faction colour-coding. Click unit → highlight legal moves (blue) and attackable targets (red) with damage preview numbers shown on hover (Into the Breach style: show EXACT damage outcome before committing).
2. **Hot-seat play:** two humans at one machine. Clear "Player X's turn" banner. End Turn button. When fog of war is on, show a "pass the laptop" interstitial between turns.
3. **Play vs bot:** dropdown to make either side bot-controlled, with a "step" and "auto-play" control.
4. **Game setup screen:** map size, map generation seed, fog on/off, factions per player, win conditions, turn limit. Plus "random map" vs "load map from JSON".
5. **THE EDITOR PANEL (most important feature):** a collapsible sidebar with tabs:
   - **Units:** table of all unit types with editable fields (cost, HP, attack, defence, movement, range, sight). Edits apply to the data registry immediately; "Restart with new values" button. 
   - **Terrain:** same pattern for terrain properties.
   - **Config:** combat formula coefficients, income values, win-condition settings.
   - **Export/Import:** download the full current data set as JSON; upload a JSON to replace it. THIS is how the two founders share balance experiments — make it one click each way.
6. **State inspector:** collapsible panel showing current turn, each player's income/cities/unit count, and the raw action log. Buttons: undo last action (trivial via replay log), save game, load game, copy replay JSON.
7. **Map editor mode:** click-to-paint terrain on the grid, place starting cities/units, save map to JSON. Basic is fine.

---

## 5. BOTS (packages/bots)

Implement two bots behind a common `Bot` interface (`chooseAction(visibleState): Action`):
1. **RandomBot** — uniformly random legal action. Exists for engine fuzzing.
2. **GreedyBot** — heuristic: evaluates each legal action with a simple scoring function (damage dealt, kills, capturing progress, income delta, staying out of enemy range, exploring under fog) and picks the best with small seeded tie-breaking noise. Must play a complete, non-embarrassing game. Keep the heuristic weights in a JSON config so they're tunable too.

Stub a third file `mctsBot.ts` with a TODO — do not implement MCTS now.

---

## 6. SIMULATION HARNESS (packages/sim)

CLI: `npm run sim -- --games 1000 --bot-a greedy --bot-b greedy --map random --seed 42 --out results/run-001`

For each run, output:
- `summary.json` and a human-readable console table
- `games.csv` — one row per game: seed, winner, win condition met, game length, total units built per side, per-unit-type build counts, lead changes

Metrics to compute in the summary:
1. Win rate per player slot AND per faction (run mirrored: each faction plays both slots to separate faction advantage from first-mover advantage).
2. First-mover advantage (player-slot win rate with identical factions).
3. Game length distribution (min/median/p90/max, histogram buckets).
4. **Comeback rate:** compute a position score each turn (same formula as the score win condition). A "comeback win" = winner was behind by ≥25% (configurable) at any point after turn 5. Report % of games that are comeback wins, and average number of lead changes.
5. Unit usage: build rate and survival rate per unit type per faction. Flag any unit built in <5% of games (dead design weight) or >60% (dominant).
6. Win-condition distribution (how games actually end).

Performance target: 1,000 GreedyBot games on a 12×12 map should finish in minutes, not hours. Cap games at the turn limit. Print progress every 50 games.

---

## 7. TESTING & QUALITY BAR

- Engine unit tests: combat formula cases, movement cost pathing, fog visibility, capture logic, win conditions, illegal-action rejection.
- **Determinism test:** record a full RandomBot vs RandomBot game's action log, replay it, assert deep equality of final state. Run with 5 different seeds.
- **Fuzz test:** 100 full RandomBot games must complete without throwing and with `getLegalActions` never returning an illegal action (validate by applying each).
- Data validation: all shipped JSON passes zod schemas; `npm run validate-data` exits non-zero on failure.
- No TODO-stubbed gameplay features: if something in this brief can't be finished, say so explicitly at the end rather than shipping a silent placeholder.

---

## 8. DOCS & DX

- `README.md`: what this is, how to run dev/sim/tests, how the data files work, how the two founders should share balance configs (export/import JSON), glossary of game terms.
- `CLAUDE.md` at repo root: project conventions for future Claude Code sessions — the architecture rules from section 2 verbatim, the workspace layout, "all balance numbers live in /packages/data", "engine must stay pure and deterministic", test commands.
- `docs/DESIGN.md`: the current ruleset in plain English, auto-reflecting the v1 defaults, structured so it can eventually become the studio handoff spec.
- Initialise git, sensible .gitignore, commit at the end of each phase below with a clear message.

---

## 9. BUILD IN PHASES — VERIFY EACH BEFORE PROCEEDING

**Phase 1 — Skeleton + Engine core:** workspace setup, schemas, data files, engine with map/units/movement/combat/turns/win-by-elimination. Determinism + fuzz tests passing.
**Phase 2 — Web prototype:** map render, hot-seat play, move/attack with damage preview, setup screen, save/load/undo. A human can play a full game.
**Phase 3 — Economy + fog + tech:** cities, income, recruiting, capture, fog of war, tech tree. Update web UI accordingly.
**Phase 4 — Editor panel + map editor:** the full tuning UI with export/import.
**Phase 5 — Bots + sim harness:** GreedyBot, CLI, metrics, CSV output. Run a demo 200-game sim and include its summary in the final report.

After each phase: run the tests, run the app, fix what's broken, commit, then continue. At the very end, give me: how to start everything, what was completed, what was deliberately skipped, and the demo sim summary.

If any instruction here is ambiguous, make the simplest reasonable choice, note it in a `docs/DECISIONS.md` file, and keep moving — do not stop to ask questions mid-build.
