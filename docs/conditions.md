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
| `sacrificial_founder` | Sacrificial Founder | The unit dies when it founds a city. |
| `impotent_founder` | Impotent Founder | The unit cannot found cities at all. |
| `blind` | Blind | Visibility 0 (sees only its own tile); may still move into cloud/fog tiles. |
| `squinting_eyes_1` | Squinting eyes (L1) | Sees its 3×3 as **fog** only (terrain, not units). |
| `squinting_eyes_2` | Squinting eyes (L2) | 3×3 fully visible; the surrounding 5×5 ring as **fog** (≈ visibility 1.5). |

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

## Current assignments
- **Scout** (`scout`, Vanguard/shared): `mountain_restricted`, `optics`, `impotent_founder`.
- **Scuttling** (`scuttling`, Hive): `sacrificial_founder`, `blind`.
- **Scout** (`hive_scout`, Hive): `squinting_eyes_2`, `impotent_founder`.

*(Conditions are independent of `traits` — traits like `flying`/`aquatic`/
`ignoresTerrainCost` are movement/terrain flags baked into pathfinding; conditions are
the named, documented, reusable special rules tracked in this file.)*
