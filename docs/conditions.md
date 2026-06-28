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
| `optics` | Optics | Mountains block this unit's line of sight (it sees the mountain, not past it). |

---

## `mountain_restricted` — Mountain restricted
**Rule:** the unit cannot climb/move onto **mountain** tiles. Mountains are otherwise
passable terrain, so this is a per-unit restriction.

**Enforced in:** `packages/engine/src/pathfinding.ts` (`getReachableTiles`) — mountain
tiles are excluded from the unit's reachable set, so the move is never offered.

## `optics` — Optics
**Rule:** the unit's line of sight is **blocked by mountains** (in addition to the
normal forest sight-blocking that applies to everyone). It still *sees the mountain
tile itself*, just nothing beyond it — both **orthogonally and diagonally**.

Example (unit at `a1`, sight radius 2):
- `a1 → a2 (flat) → a3 (flat)`: sees `a2` **and** `a3`.
- `a1 → a2 (mountain) → a3`: sees `a2`, but `a3` is **hidden**.
- Diagonal `a1 → b2 (flat) → c3 (flat)`: sees `b2` **and** `c3`.
- Diagonal `a1 → b2 (mountain) → c3`: sees `b2`, but `c3` is **hidden**.

**Enforced in:** `packages/engine/src/fog.ts` (`computeVisibility` →
`revealSquare` → `hasLineOfSight`), via a `mountainsBlock` flag set when the unit has
this condition. Bresenham line-of-sight treats mountains as blockers (the endpoint is
never the blocker, so the mountain tile stays visible). Only matters with fog of war on
and for units whose `visibility` ≥ 2 (at radius 1 every neighbour is adjacent).

---

## Current assignments
- **Scout** (`scout`): `mountain_restricted`, `optics` (visibility 2 light recon).

*(Conditions are independent of `traits` — traits like `flying`/`aquatic`/
`ignoresTerrainCost` are movement/terrain flags baked into pathfinding; conditions are
the named, documented, reusable special rules tracked in this file.)*
