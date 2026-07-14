# Tactica — Economy Design (current state)

Handoff/reference for the `economy` branch. This is the source of truth for the
economy system; tuning numbers live in `packages/data/json/economy.json`, logic
in `packages/engine/src/economy.ts`, tests in `packages/engine/src/economy.test.ts`.

Inspired by Polytopia (cities, levels, unit caps) and StarCraft (two resources,
tech-gated production).

---

## 1. Resources

Two resources, pooled per player (not per city):

- **Ore** (◈) — primary. Buys basic units and all buildings. (Renamed from "shard".)
- **Plasma** (✦) — advanced. For high-tech units/buildings. Earned from extractors/purifiers.

Players start with **0 ore, 0 plasma** and live off city production.

## 2. Cities (capitals included)

Every city has a **level** (1–6). Two distinct per-city stats — *do not confuse them*:

| Term | Meaning | Formula |
|---|---|---|
| **pop** | unit capacity (max units the city can support) | `popBase(2) + level - 1 + popBonus` |
| **supply** | leveling progress accumulated from buildings | crosses thresholds to unlock a level-up |

**Supply thresholds** (cumulative total to *reach* a level): L2=2, L3=5, L4=9, L5=14, L6=20.
The per-level cost therefore rises 2/3/4/5/6; the UI shows a per-level counter that
**resets each level** (0/2 → 2/2, then 0/3, 0/4 …) via `citySupplyProgress()`.

**Leveling is a player choice, not automatic.** When a city's supply crosses the next
threshold, the owner is offered a **level-up** (the "Congratulations" modal). Accepting
raises the level **and** applies one of two chosen rewards. Until accepted the city
stays at its current level (so it keeps the choice). `recomputeCities` updates supply
only; level advances solely via the `levelUpCity` action.

**Level-up rewards** (all stored on the city → **capture-invariant**: they transfer
with the city and never reset when an enemy takes it):

| Reaching | Option A | Option B |
|---|---|---|
| **L2** | City income **+20** ore/turn (`incomeBonus`) | **+1 pop** (`popBonus`) |
| **L3** | **Fortify** (`fortified` → ×3 defense for units in the city — "walls") | **Reveal map** (discover ~33% of currently-visible tiles as fog toward the nearest enemy) |
| **L4** | **+3 supply** (`bonusSupply`, counts toward leveling) | **Expand territory** (claim 3 tiles — see below) |

**Expand territory** (L4 option B) opens a tile-picker: the player ticks **3** open
tiles to add to the city's territory (irregular shapes allowed; claimed tiles are
full territory — buildable, owned, inside the border). Each pick must be **claimable**
(in-bounds, not a city/ruin, not already in any city's territory) and satisfy the
**anti-snake rule**: ≥2 of its 8 neighbours must already be owned by the city
(base 3×3 + earlier expansions + tiles ticked so far). This blocks single-tile
tendrils snaking out to grab distant resources. Confirming dispatches
`expandTerritory`, which *is* the L4 level-up (levels to 4 **and** claims the tiles).
Expanded tiles transfer with the city on capture, like everything else.

> **Cap:** cities currently stop at **L4** (`LEVEL_CHOICE_MAX`) — L5/L6 rewards are
> not designed yet (backlog). All L2–L4 rewards are now live (Reveal map included).

**Ore production** per turn by level (plus any `incomeBonus`):
- Capital: `20 + 10×(level-1)` → 20 / 30 / 40 / 50 / 60 / 70
- Founded city: `10 + 10×(level-1)` → 10 / 20 / 30 / 40 / 50 / 60

**Territory** = the 3×3 around the city centre. Cities/ruins must be ≥2 empty tiles
apart so territories never overlap (mapgen enforces this).

## 3. Resource-Extraction Buildings (REBs)

REBs do **two things**: produce a resource per turn **and** add supply to their city.
A building belongs to the one city whose territory contains it.

### REB1 — Mine (on ore tile) / Extractor (on plasma vent)
Self output + supply, scaling with the building's own level. Upgradeable to L3.
Mine output = **ore**; Extractor output = **plasma** (never ore). Mine and Extractor
now have **different** cost/output curves (they only used to share). `costByLevel`
values are the ore paid to build L1 / upgrade to L2 / upgrade to L3; TTR below is the
payback of each step = step cost ÷ marginal output gained.

**Mine** (ore):

| Level | Cost (ore) | Output/turn (total) | Marginal | TTR | Supply (total) |
|---|---|---|---|---|---|
| 1 | 50 | 10 | +10 | 5 | 1 |
| 2 | 70 | 20 | +10 | 7 | 2 |
| 3 | 90 | 30 | +10 | 9 | 4 |

**Extractor** (plasma):

| Level | Cost (ore) | Output/turn (total) | Marginal | TTR | Supply (total) |
|---|---|---|---|---|---|
| 1 | 100 | 5 | +5 | 20 | 2 |
| 2 | 125 | 10 | +5 | 25 | 3 |
| 3 | 200 | 20 | +10 | 20 | 4 |

- Supply is each building's *total* contribution at that level (not incremental).
- Mine & Extractor: unlimited per city (count is governed by ore/plasma tile spawns, not a hard cap).
- **No tech gate** on either — a mine builds on any ore tile, an extractor on any
  plasma vent, within owned territory. (`plasma_tap` is now an inert/repurposable tech.)
- **Starting ore per team = 20** (a small opening buffer; starting plasma = 0).

### REB2 — Refinery (near mines) / Purifier (near extractors)
**Output** = per-adjacent-REB1 value × (count of same-city REB1s of its kind in its 3×3),
scaling with the REB2's own level. The multiplier is **level-agnostic**: a REB2 next to
a L1 REB1 counts it the same as a L3 one. **Supply is now a FLAT per-level total** (no
longer per-adjacent). Upgradeable to L3.

**Build gate:** built on a plain (passable, non-resource) **land tile in the city's
territory** that has **≥1 same-city REB1 of the kind it boosts adjacent in its 3×3** —
a refinery needs an adjacent **mine**, a purifier an adjacent **extractor** (the actual
building, not just the ore/plasma tile). So the mine/extractor must be built *first*.
Same-city adjacency keeps it in this city's territory (a REB1 in another city's
territory doesn't count). **Limited to 1 per city** (both refinery and purifier, for now).
(This supersedes an earlier "resource-tile" gate — see DEVELOPMENT_RATIONALE.)

**Refinery** (ore, counts adjacent **mines**):

| Level | Cost (ore) | Output/turn per adj mine (total) | Marginal | TTR/adj | Supply (flat total) |
|---|---|---|---|---|---|
| 1 | 100 | 20 | +20 | 5 | 2 |
| 2 | 150 | 40 | +20 | 7.5 | 3 |
| 3 | 250 | 80 | +40 | 6.25 | 4 |

**Purifier** (plasma, counts adjacent **extractors**):

| Level | Cost (ore) | Output/turn per adj extractor (total) | Marginal | TTR/adj | Supply (flat total) |
|---|---|---|---|---|---|
| 1 | 300 | 5 | +5 | 60 | 3 |
| 2 | 400 | 15 | +10 | 40 | 4 |
| 3 | 750 | 30 | +15 | 50 | 5 |

- TTR/adj is the step payback assuming **1** adjacent REB1; with N adjacent it divides
  by N (e.g. a L1 refinery next to 2 mines → +40 ore/turn, TTR 2.5).
- Neither REB2 has a tech gate now — both build as soon as their REB1 is adjacent.
  (The refinery's old **Refineries** tech requirement was dropped for parity with the
  purifier; the `refineries` tech still exists but no longer gates anything.)
- **Same-city only:** a REB2 never counts a REB1 in a different city's territory.

## 4. Income (collected at turn rollover)

- **Ore income** = Σ (owned-city base production) + Σ (ore-building output in owned cities)
- **Plasma income** = Σ (plasma-building output in owned cities)

There is no plasma *base* from cities — plasma comes only from extractors/purifiers,
which require plasma-vent tiles (see Map Contract).

### REB blocking (enemy occupation)

While an **enemy unit stands on one of your REBs** (mine / extractor / refinery /
purifier), that REB's **output is not collected** for as long as it sits there —
its ore/plasma is excluded from income. **Supply/leveling is unaffected** (income
only). Predicate: `buildingBlocked(state, building)` (an occupant whose owner ≠ the
building's city owner); `buildingIncome` skips blocked REBs. A friendly unit on your
own REB never blocks it. UI: the REB shows a red **✕** at the tile's bottom-right on
the map, and the income tooltips / city-info box strike it through (its would-be
amount is still shown, tagged "blocked", but not added to the total).

### Income breakdown for the UI

`playerEconomy(state, playerId, registry): CityEconomy[]` returns a structured,
per-city breakdown: each city lists its collected `ore`/`plasma` total plus the
individual `sources` feeding it (`kind: 'city'` = base city production, else a REB
with a 1-based per-kind `index` → "Mine 1"). Each source carries its gross `amount`
and a `blocked` flag; city/resource totals exclude blocked sources. This one call
feeds the top-bar ore & plasma hover tooltips and the city-info economy panel.

## 5. Units & recruiting

- Recruit at an owned city tile that is empty and has a **free pop slot**
  (units homed there < city pop).
- Cost = ore (`units.json` `cost` field) + optional plasma (`economy.json`
  `unitPlasmaCost[unitTypeId]`, default 0). `units.json` is unchanged by the economy.
- A recruited unit is **homed** at that city (`GameState.unitHomeCity[unitId]`); it
  counts against that city's pop wherever it walks, and frees the slot when it dies.
- **Upkeep is dormant** (`upkeepMultiplier: 0`) — units cost nothing per turn. Code kept for future.

## 6. Actions added to the engine

`build` (REB at a position), `upgradeBuilding` (level up a REB), `foundCity`
(on a ruin tile, requires your unit standing on it). Plus the existing move /
attack / recruit / research / useAbility / endTurn.

## 7. Bug fixes baked in

- **Capture → stateless units:** when a city is captured, the previous owner's
  units homed there have their home-city link cleared, so they don't block the
  new owner's slots. No stat penalty yet (deferred — see notes).
- **REB2 same-city:** refineries/purifiers only count adjacent REB1s of their own city.

## 8. Map contract (what mapgen must provide)

The economy reads two optional `Tile` markers that **mapgen sets**:

- `resourceKind?: 'ore' | 'plasma' | null` — tag ore outcrops and plasma vents.
- `isRuin?: boolean` — tiles where players can found new cities.

Safe fallbacks: an untagged `isResourceTile` is treated as **ore**, and with no
ruins, city-founding is simply unavailable. So nothing breaks before mapgen adds these.
**Spacing rule:** capitals/cities/ruins ≥2 empty tiles apart (no overlapping territories).
**Scattered resources:** beyond the territory perimeters, mapgen lightly sprinkles
ore/plasma across open off-territory tiles (~66% of a city 3×3's density, ~2:1
ore:plasma) so there's something to claim when city borders expand later.

## 9. Tech gating (mechanism present, currently OFF)

`BuildingDef.techRequired` and `upgradeTechRequired` exist but are all `null`, so
everything is buildable now for testing. **Planned:** REB1 L2/L3 upgrades (and REB2)
will be locked behind tech research. The old `taxation`/`diplomacy` techs boosted the
removed tile-income system and are currently inert — repurpose or drop later.

## 10. Pinned / open / deferred

**Pinned for now (easy data tweaks in `economy.json`):**
- REB2 cost is **ore-only**; a `plasmaCostByLevel` slot is reserved but unused.
- Extractor now matches the mine on cost (50/70/90) & output (+10/20/30); only
  supply differs (mine 1/2/4, extractor 2/3/4). Base extractor tech gate removed.
- Purifier mirrors the refinery's cost scale (50/120/200).

**Deferred design notes (backlog):**
1. Stateless units (home city lost) may get a penalty, e.g. −20% atk/def.
2. Refineries/purifiers may later draw from adjacent REBs in *other friendly* cities' territory (via tech).
3. A pop/supply-producing building (StarCraft supply-depot style) to break the territory-tile cap on leveling.
4. Option to level cities by paying ore/plasma outright (instead of only via supply).

## 11. Where it lives in code

- `packages/data/json/economy.json` — all tuning numbers
- `packages/engine/src/economy.ts` — all logic
- `packages/engine/src/economy.test.ts` — tests
- Hooks: `engine/src/game.ts` (createGame, getLegalActions, applyAction, turn settlement),
  `engine/src/types.ts` (CityState, BuildingState, EconomyData, `PlayerState.ore/plasma`,
  `GameState.cities/buildings/unitHomeCity`), `data/src/schemas.ts`, `engine/src/index.ts`,
  `apps/web` Inspector/GameScreen/EditorPanel, `packages/bots`.
- **Untouched by the economy branch:** `combat.ts`, `units.json`, `terrain.json`,
  `mapgen.ts`, `MapView`, `iso/`, `UnitSheet` (the map/combat owner's files).

## 12. Verify

```
npm run validate-data   # economy.json against schema
npm test                # 26 tests incl. determinism + 100-game fuzz
npm run sim -- --games 100 --bot-a greedy --bot-b greedy --seed 42
npm run dev             # play in the browser
```

> Note: the bots recruit within slots but do **not** yet build/upgrade REBs, so
> self-play sims don't exercise economic strategy. AI economy logic is a TODO.
