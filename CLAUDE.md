# Tactica — Project Conventions

## Architecture Rules

1. **The engine is a pure, deterministic state machine.** Its entire public API is approximately:
   - `createGame(config: GameConfig, seed: number): GameState`
   - `getLegalActions(state: GameState, playerId: PlayerId): Action[]`
   - `applyAction(state: GameState, action: Action): GameState` (returns NEW state; never mutates)
   - `getVisibleState(state: GameState, playerId: PlayerId): VisibleState` (fog-of-war filtered view)
   - `getResult(state: GameState): GameResult | null`
2. **All randomness flows through a seeded PRNG stored in GameState.** Same seed + same action sequence = identical game, always.
3. **GameState is fully JSON-serializable.** No classes with methods as state, no Maps/Sets in state.
4. **All game content is data, not code.** Unit stats, terrain, tech tree, factions — everything in `/packages/data/json/*.json`.
5. **Abilities are composed from primitives.** Effect primitives: `damage`, `push`, `heal`, `applyStatus`, `revealArea`, `spawnUnit`, `modifyStat`.

## Workspace Layout

```
/packages
  /engine   — pure game logic (ZERO browser/dom imports)
  /data     — JSON game data + zod schemas
  /bots     — AI players (imports engine only)
  /sim      — headless simulation CLI
/apps
  /web      — Vite + React app
```

## Key Rules

- All balance numbers live in `/packages/data/json/`
- Engine must stay pure and deterministic
- Game state lives in the engine, NOT in React state
- No backend, no database, no auth

## Commands

- `npm run dev` — launch web app
- `npm run sim -- --games 1000 --bot-a greedy --bot-b greedy --seed 42` — headless sim
- `npm test` — run all tests
- `npm run validate-data` — validate JSON data against schemas

## Reference docs

- `docs/ECONOMY.md` — current state of the economy system
- `docs/conditions.md` — unit special-conditions registry (named rules units opt into)
- `docs/MODULES.md` — module map, shared-core rules, how to avoid merge clashes
- `docs/DEVELOPMENT_RATIONALE.md` — the *why* behind decisions (see logging rule below)
- `docs/overlap.md` — cross-module hand-off log (see "commit to overlap" rule below)

## Cross-module overlap log (REQUIRED)

When a change in your module needs work, correction, or wiring in **another**
contributor's module — or when the user says **"commit to overlap"** — append an
entry to `docs/overlap.md` for the other module's owner: **what** the change is,
**how** it should be wired, **why**, and **which module** it affects. Append-only,
dated, and attributed (from `git config user.name`). Entries stay under **Open**
until the owning module marks them **Done**. This is how cross-module work is
handed between contributors (e.g. an economy tech whose effect lives in fog/mapgen).

## Development Rationale — decision log (REQUIRED, automatic)

Whenever you (any AI assisting in this repo) make a design decision, or add /
remove / rename / change something after discussion, **append an entry to
`docs/DEVELOPMENT_RATIONALE.md` automatically, without asking.** Record *what
changed* and *why* (the reasoning/discussion behind it).

The log is **append-only — never overwrite or delete prior entries:**

- Every entry starts with the **date** (`YYYY-MM-DD`) and the **author** (from
  `git config user.name`/`user.email`, or "unknown" if unset).
- If a new decision **supersedes or reverses an earlier one, keep both.** Add a
  new dated entry that notes it supersedes the prior decision (and why) — do not
  edit the old entry away. Two contributors changing the same thing at different
  times should both remain in the log, each timestamped, so the evolution is
  traceable.
- This file is append-only specifically so two people's entries merge cleanly
  and no one's rationale is lost.
