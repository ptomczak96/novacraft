# Tactica — Modules & How We Avoid Clashing

A shared map of the codebase for two people working in parallel. This is about
*coordination*, not ownership — either of us can work in any module; we just
need to know which files a piece of work touches and talk before overlapping.

## The core principle

**Branches don't isolate work — files do.** Two people clash only when they edit
the **same lines of the same file**. So these "modules" are a map of *which files
go with which topic*, and we stay clash-free by:

1. **Not editing the same module at the same time** — coordinate verbally
   ("I'm in combat, don't touch it until I push").
2. **Short-lived branches, merged to `main` often** (daily-ish). Long-lived
   parallel branches are what cause brutal merges — avoid them.
3. **After every pull/merge:** run `npm test` and `npx tsc` before trusting it.

> "Module" = *what part of the code* (the tech module). "Git branch" = *how you
> package a chunk of work to sync*. A module is not a permanent branch.

## The module map

| Module | Files | Notes |
|---|---|---|
| **Map gen** | `engine/src/mapgen.ts`, `engine/src/fog.ts`, `data/json/terrain.json` | World + resources + fog |
| **Units & Combat** | `engine/src/combat.ts`, `data/json/units.json`, `data/json/factions.json`, web `UnitSheet`/combat log | Unit stats live with combat |
| **Economy** | `engine/src/economy.ts`, `data/json/economy.json` | Cities, income, REBs |
| **Visual / UI** | `apps/web/src/iso/`, `MapView`, `components/`, `store/` | Rendering + interface |
| **Tech** | `data/json/tech-tree.json` + the generic modifier system | See "cross-cutting" below |
| **Pathing** | `engine/src/pathfinding.ts` | Movement, AOI, terrain rules |
| **Sound** | new files (later) | Isolated |

## The shared core — the real coordination point

Two files are touched by **every** module, because they're the engine's spine:

- **`engine/src/types.ts`** — the `GameState` shape and all interfaces
- **`engine/src/game.ts`** — the action dispatcher (`createGame`,
  `getLegalActions`, `applyAction`)
- (plus **`data/json/config.json`**)

No module owns these. The rule that keeps them clash-free: **edits stay small,
additive, and in distinct regions** (a new `case` in the switch, a new field on
an interface) — and we **sync often** so two additive edits rarely land on the
same line. This discipline matters more than any module boundary.

## Cross-cutting concerns (especially Tech)

A **cross-cutting concern** is code whose effects span many modules, so it can't
live in one file. **Tech** is the prime example: one tech might buff combat,
unlock a unit, gate an REB, and boost movement.

The way to stop tech from sprawling (and clashing with everyone): **keep it as
data + a generic modifier system.**

- **Tech module owns:** `tech-tree.json` (ids, costs, prerequisites, effects),
  a *small, generic* effect vocabulary (`globalModifier` with named stats like
  `attackBonus`, `movementBonus`, `oreOutputBonus`; an `unlock` for gating), and
  the existing generic reader `getModifier(player, registry, modifierName)`.
- **Each other module owns its own links:** it names the tech it cares about
  *in its own data, by string id*. Economy already does this —
  `BuildingDef.techRequired` lives in `economy.json`, so the gate is in
  economy's files, not tech's. Combat reads `getModifier('attackBonus')`.
- **Shared contract** (agree before changing): the vocabulary of modifier names,
  and the convention that tech ids are referenced by string from each module's data.

> **The one rule:** never hardcode a specific tech id inside a system's logic
> (`if (techId === 'archery')`). Always go through the generic modifier/unlock
> check. Hardcoded tech checks buried in combat/pathing are what make tech bleed
> across files. Done right, "add a tech" is a **data edit in `tech-tree.json`**.

## Pathing — its own module, with read-dependencies

Pathing is substantial (movement points, areas of influence / zones of control,
per-unit terrain rules, tech-modified movement, road/transport bonuses). Its
**logic lives in one file** (`pathfinding.ts`) — so it's a clean module.

But it **reads** data from others: terrain (move costs), units (traits like
`aquatic`, `ignoresTerrainCost`), tech (movement modifiers). **Reading another
module's data never causes a clash — editing the same file does.** The only
coordination point is when pathing needs a *new field* in someone else's data
(e.g. a new `movementType` on terrain, or a new unit trait). That's a **data
contract** change — flag it before adding.

> Note: "area of influence" likely needs new *state* (which tiles are contested),
> and state lives in `types.ts`/`game.ts` — the shared core. So AOI will brush the
> spine; keep that edit small and additive.

## The pattern that's kept Economy clean (use it everywhere)

- **New feature → new files.** Economy logic is `economy.ts`, data is
  `economy.json`, tests are `economy.test.ts`. It only makes tiny additive hooks
  into the shared core.
- **Cross-references via an overlay, not by editing the other module's file.**
  Economy needs a plasma cost per unit, but `units.json` is the combat module's.
  Instead of editing `units.json`, economy keeps `unitPlasmaCost` in its *own*
  `economy.json`, keyed by unit id. No clash.
- **Data files are the sneaky clash source.** Two people editing different
  *objects* in the same JSON (e.g. both touching `units.json`) still collide.
  Prefer per-feature data files; coordinate edits to shared ones.

## Quick checklist before starting work

1. Which module am I in? Which files does it touch?
2. Is the other person in that module or the shared core right now? If so, wait
   or coordinate.
3. Pull `main` first. Work on a short-lived branch (or `main` directly if we're
   coordinating tightly).
4. Sync often. After merging, run `npm test` + `npx tsc`.
