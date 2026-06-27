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
| **pop** | unit capacity (max units the city can support) | `popBase(2) + level - 1` → L1=2 … L6=7 |
| **supply** | leveling progress accumulated from buildings | crosses thresholds to raise level |

**Supply thresholds** (cumulative total to *reach* a level): L2=2, L3=5, L4=9, L5=14, L6=20.
Cities **auto-level** the moment accumulated supply crosses a threshold (no extra cost).

**Ore production** per turn by level:
- Capital: `20 + 10×(level-1)` → 20 / 30 / 40 / 50 / 60 / 70
- Founded city: `10 + 10×(level-1)` → 10 / 20 / 30 / 40 / 50 / 60

**Territory** = the 3×3 around the city centre. Cities/ruins must be ≥2 empty tiles
apart so territories never overlap (mapgen enforces this).

## 3. Resource-Extraction Buildings (REBs)

REBs do **two things**: produce a resource per turn **and** add supply to their city.
A building belongs to the one city whose territory contains it.

### REB1 — Mine (on ore tile) / Extractor (on plasma vent)
Self output + supply, scaling with the building's own level. Upgradeable to L3.

**Mine** (TTR = cost ÷ marginal output/turn shown for the balance lens):

| Level | Cost (ore) | Output/turn | Supply (total) | TTR |
|---|---|---|---|---|
| 1 | 50 | +10 | 1 | 5 |
| 2 | 70 | +20 | 3 | 7 |
| 3 | 90 | +30 | 6 | 9 |

**Extractor** (still on the old cheap scale — deliberate asymmetry, may diverge further):

| Level | Cost (plasma… via ore pool) | Output/turn | Supply (total) | TTR |
|---|---|---|---|---|
| 1 | 20 | +10 | 1 | 2 |
| 2 | 40 | +20 | 3 | 4 |
| 3 | 60 | +30 | 6 | 6 |

- Mine output = ore; Extractor output = plasma.
- Mine & Extractor: unlimited per city (count is governed by ore/plasma tile spawns, not a hard cap).
- **Starting ore per team = 20** (a small opening buffer; starting plasma = 0).

### REB2 — Refinery (near mines) / Purifier (near extractors)
Output + supply **per adjacent same-city REB1**, scaling with the REB2's level.
Built on a land tile in the territory, adjacent to ≥1 same-city REB1. Upgradeable to L3.

| Level | Cost (ore) | Output/turn per adj REB1 | Supply per adj REB1 |
|---|---|---|---|
| 1 | 50 | +10 | 1 |
| 2 | 120 | +20 | 3 |
| 3 | 200 | +30 | 5 |

- Refinery output = ore (counts adjacent **mines**); Purifier output = plasma (counts adjacent **extractors**).
- Refinery: unlimited per city. Purifier: max 1 per city.
- **Same-city only:** a refinery never counts a mine in a different city's territory.

## 4. Income (collected at turn rollover)

- **Ore income** = Σ (owned-city base production) + Σ (ore-building output in owned cities)
- **Plasma income** = Σ (plasma-building output in owned cities)

There is no plasma *base* from cities — plasma comes only from extractors/purifiers,
which require plasma-vent tiles (see Map Contract).

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
- Extractor still uses the old cheap cost scale (20/40/60) while mines now cost
  50/70/90 — a deliberate asymmetry to revisit (extractor may be raised to match).
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
