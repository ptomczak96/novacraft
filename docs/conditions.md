# Tactica — Unit Special Conditions

Reusable, named **special conditions** that can be attached to any unit type. A unit
opts in by listing the condition id in its `conditions` array in
`packages/data/json/units.json`; the engine then applies the effect described here.

> When we say "this unit has the X condition", add `"X"` (the id) to that unit's
> `conditions` list — the existing definition below is applied automatically. Add any
> new condition to this file with its id, plain-English rule, and where it's enforced.

| Id | Name | One-line effect |
|---|---|---|
| `mountain_restricted` | Mountain restricted | Cannot move onto mountain tiles. |
| `low_horizons` | Low Horizons | Mountains block this unit's line of sight (it sees the mountain, not past it). |
| `sacrificial_founder` | Sacrificial Founder | The unit dies when it founds a city. |
| `impotent_founder` | Impotent Founder | The unit cannot found cities at all. |
| `blind` | Blind | Visibility 0 (sees only its own tile); may still move into cloud/fog tiles. |
| `squinting_eyes_1` | Squinting eyes (L1) | Sees its 3×3 as **fog** only (terrain, not units). |
| `squinting_eyes_2` | Squinting eyes (L2) | 3×3 fully visible; the surrounding 5×5 ring as **fog** (≈ visibility 1.5). |
| `dash_N` | Dash N | After attacking, the unit may move up to **N** tiles (default: no move after attacking). |
| `corrosive` | Corrosive | The unit's attack also applies the **corrosive status** (−20% defence) to the target. |
| `mountain_defense` | Mountain Defense | Can climb mountains; gains **×1.2 defence** while on a mountain. |
| `mountain_shooter` | Mountain Shooter | Can climb mountains; gains **×1.2 attack** while on a mountain. |
| `mountain_sight` | Mountain Sight | Can climb mountains; its **visibility becomes 2** while on a mountain. |

> **Mountains are impassable by default** — no unit may move onto a mountain tile unless
> it has one of the three `mountain_*` conditions above. (`mountain_restricted` is now
> equivalent to the default and effectively redundant.)

> **Default turn flow:** a unit may **move, then attack**, and **cannot move or act after attacking** — unless it has a `dash_N` condition.

> **Status effects** (distinct from conditions — applied *to* a unit during play, stored on `unit.statuses`):
> - **`corrosive`** — the unit's effective **defence is reduced 20%** while it has this status. Does not stack. Persists (not cleared at end of turn). Applied by `corrosive`-condition units when they hit a surviving target.

---

## `mountain_restricted` — Mountain restricted
**Rule:** the unit cannot climb/move onto **mountain** tiles. Mountains are otherwise
passable terrain, so this is a per-unit restriction.

**Enforced in:** `packages/engine/src/pathfinding.ts` (`getReachableTiles`) — mountain
tiles are excluded from the unit's reachable set, so the move is never offered.

## `low_horizons` — Low Horizons
**Rule:** the unit's line of sight is **blocked by mountains**. (Vision is otherwise a
clean square — nothing else blocks it.) It still *sees the mountain tile itself*, just
nothing beyond it — both **orthogonally and diagonally**.

Example (unit at `a1`, sight radius 2):
- `a1 → a2 (flat) → a3 (flat)`: sees `a2` **and** `a3`.
- `a1 → a2 (mountain) → a3`: sees `a2`, but `a3` is **hidden**.
- Diagonal `a1 → b2 (flat) → c3 (flat)`: sees `b2` **and** `c3`.
- Diagonal `a1 → b2 (mountain) → c3`: sees `b2`, but `c3` is **hidden**.

**Enforced in:** `packages/engine/src/fog.ts` (`computeVisibility` →
`revealSquareLevel` → `hasLineOfSight`), via a `mountainsBlock` flag set when the unit has
this condition. Bresenham line-of-sight treats mountains as blockers (the endpoint is
never the blocker, so the mountain tile stays visible). Only matters with fog of war on
and for units whose `visibility` ≥ 2 (at radius 1 every neighbour is adjacent).

---

## `sacrificial_founder` — Sacrificial Founder
**Rule:** when this unit founds a city, it **dies** (consumed by the founding) instead
of re-homing to the new city. Used by Hive **Scuttlings**.

**Enforced in:** `game.ts` (`applyFoundCity`) — the founder is removed and its home
link cleared; the city is still founded with 0 units homed.

## `impotent_founder` — Impotent Founder
**Rule:** this unit **cannot found cities** — the "Found City" action is never offered
while it stands on a ruin (other eligible units still can).

**Enforced in:** `economy.ts` (`canFoundCity`) — returns false if the unit on the ruin
has this condition.

## `blind` — Blind
**Rule:** the unit has **visibility 0** (reveals only the tile it stands on), so it
discovers nothing around it. It may, however, **move into cloud/fog tiles** (movement
isn't fog-gated); a selected blind unit highlights its move targets even on cloud tiles.

**Bump:** if a blind unit tries to move onto a tile holding a **hidden enemy** (under
cloud, or under fog), it doesn't move — it **stays put**, **reveals** that tile + the
enemy for the rest of the turn, and may then **attack** (range 1) or stand. The bumped
tile enters fog memory (its terrain persists as fog); the enemy is shown only this turn
and returns to normal fog when the player's turn ends.

**Enforced in:** visibility 0 falls out of the normal sight code (`fog.ts`); blind move
targets onto enemy tiles come from `pathfinding.ts` (`bumpEnemies`); the bump itself is
in `game.ts` (`applyMove` + `GameState.revealedTiles`, cleared in `applyEndTurn`);
cloud-tile move highlight is in `IsoCanvas.tsx`.

## `squinting_eyes_1` / `squinting_eyes_2` — Squinting eyes
**Rule:** the unit sees terrain/structures as **fog** at part of its range but never
the **units** standing there. *L1:* the 3×3 around it is fog only. *L2:* the 3×3 is
fully visible and the next ring out (the 5×5) is fog — hence the "1.5" visibility.
Fog tiles show terrain + buildings (recorded into fog memory) but no enemy units.

**Enforced in:** `fog.ts` (`computeVisibility` → `revealSquareLevel`), which reveals
some rings as `'explored'` (fog) rather than `'visible'`; `recordSight` snapshots fog
tiles too, and enemy units are only shown on currently-`'visible'` tiles.

## `dash_N` — Dash N
**Rule:** by default a unit can't move once it has attacked. With `dash_N`, after
attacking it gets a one-shot post-attack move of up to **N** tiles (in addition to any
pre-attack movement). The number is parsed from the id (`dash_1`, `dash_2`, …).

**Enforced in:** `game.ts` — `applyAttack` sets `unit.dashRemaining = N` (instead of
ending movement); `getLegalActions` offers a post-attack move within `dashRemaining`;
`applyMove` consumes it; `applyEndTurn` resets it.

## `corrosive` — Corrosive
**Rule:** when this unit attacks and the target **survives**, it applies the
**`corrosive` status** to that target (does not stack). The corrosive status reduces the
affected unit's **defence by 20%** in all future combat until removed.

**Enforced in:** `game.ts` (`applyAttack` adds the status) and `combat.ts`
(`resolveCombat` multiplies the defender's defence by 0.8 if `statuses` includes
`corrosive`).

## `mountain_defense` / `mountain_shooter` / `mountain_sight`
**Rule:** each grants the ability to **move onto mountains** (the default is no unit can),
plus a bonus while standing on one: `mountain_defense` → ×1.2 defence; `mountain_shooter`
→ ×1.2 attack; `mountain_sight` → visibility 2.

**Enforced in:** `pathfinding.ts` (mountain access), `combat.ts` `getDefenseMultiplier`
(mountain_defense) and `resolveCombat` (mountain_shooter attack ×1.2), `fog.ts`
(mountain_sight visibility).

## Current assignments
- **Scout** (`scout`, Vanguard): `mountain_restricted` (redundant), `low_horizons`, `impotent_founder`.
- **Bulwark** (`defender`, Vanguard): `mountain_defense`.
- **Lancer** (`lancer`, Vanguard): `mountain_shooter`.
- **Scuttling** (`scuttling`, Hive): `sacrificial_founder`, `blind`.
- **Scout** (`hive_scout`, Hive): `squinting_eyes_2`, `impotent_founder`.
- **Reaper** (`reaper`, Hive): `dash_1`.
- **Scab** (`scab`, Hive): `corrosive`, `mountain_sight`.

*(Conditions are independent of `traits` — traits like `flying`/`aquatic`/
`ignoresTerrainCost` are movement/terrain flags baked into pathfinding; conditions are
the named, documented, reusable special rules tracked in this file.)*
