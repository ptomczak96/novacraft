# Rigbound — Unit Special Conditions

Reusable, named **special conditions** that can be attached to any unit type. A unit
opts in by listing the condition id in its `conditions` array in
`packages/data/json/units.json`; the engine then applies the effect described here.

> **UI taxonomy (three groups in the Unit Info panel).** Every named rule below is
> displayed in one of three groups, driven by the registry in
> `apps/web/src/components/UnitSheet.tsx`:
> - **Conditions** — limits/debuffs. Either *inherent* (listed in the unit's
>   `conditions`) or *applied during play* by another unit (stored in `unit.statuses`,
>   e.g. `corrosive_1`). Both render under Conditions.
> - **Active Abilities** — opt-in abilities the unit MAY use, listed in the unit's
>   `abilities` array (NOT `conditions`). Implemented: `infect`, `spray_bile` (Seercaust
>   — see "Active abilities" below). Still placeholders: `burrow`, `erupt`. An active that
>   *applies* a condition to a target (e.g. Infect → the target's **Infected** condition)
>   shows as an active on the user and as a condition on the victim.
> - **Passive Abilities** — always-on abilities (`dash_N`, the `mountain_*` passives,
>   `detect`, `corrosive`, `slash`).
>
> **Casting model:** an active ability spends the caster's turn (gated like the attack
> action) and starts a per-unit **cooldown** (`unit.abilityCooldowns`, ticked down at the
> end of the owner's turn). Ability metadata (`range`, `targetKind`, `targetClass`,
> `duration`, `cooldown`) lives in the unit's `abilities` data.
>
> The `conditions` array in `units.json` is the single opt-in list for all three
> categories; the registry tags each id with its category for display.

> When we say "this unit has the X condition", add `"X"` (the id) to that unit's
> `conditions` list — the existing definition below is applied automatically. Add any
> new condition to this file with its id, plain-English rule, and where it's enforced.

> **Glossary — Area of Influence (AOI):** unless a unit states otherwise, a unit's AOI
> is the **3×3 grid around it** (Chebyshev radius 1). Attack range does not widen it.

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
| `corrosive` | Corrosive | *(passive ability)* The unit's attack applies the **`corrosive_1` condition** (−20% defence) to the target. |
| `stumble` | Stumble | While inside an enemy's **area of influence** (the 3×3 around it), its movement is capped at **1**. |
| `mountain_movement` | Mountain Movement | Can climb mountains (movement access only — **no combat or sight bonus**). |
| `mountain_defense` | Mountain Defense | Can climb mountains; gains **×1.2 defence** while on a mountain. |
| `mountain_shooter` | Mountain Shooter | Can climb mountains; gains **×1.2 attack** while on a mountain. |
| `mountain_shooter_2` | Mountain Shooter 2 | Can climb mountains; while on one, gains **×1.2 attack AND +1 attack range**. |
| `mountain_sight` | Mountain Sight | Can climb mountains; its **visibility becomes 2** while on a mountain. |
| `mobile` | Mobile | Ignores terrain **movement** penalties for forest & mountains. *(Placeholder — no terrain move costs exist yet; wires into pathing later.)* |
| `detect` | Detect | *(passive ability)* Reveals nearby **cloaked/burrowed** units. (Placeholder — no cloak/burrow units exist yet.) |
| `slash` | Slash | *(passive ability)* Attack hits a **3-tile arc**: central tile 100% damage, the two side tiles 50%. Hits **all** units incl. friendly (friendly fire); **no retaliation**. Replaces the normal single-target attack. |
| `repositioning` | Repositioning | *(passive ability)* **Cannot attack if it moved** this turn (and can't move once it attacked) — must stay put to fire. Same effect as the `noMoveAndAttack` trait. Used by the **Tank**. |

> **Mountains are impassable by default** — no unit may move onto a mountain tile unless
> it has one of the `mountain_*` passives above (`mountain_movement`, `mountain_defense`,
> `mountain_shooter`, `mountain_shooter_2`, `mountain_sight`). Use `mountain_movement` for
> plain access with no bonus. (`mountain_restricted` is now equivalent to the default and
> effectively redundant.)

> **Default turn flow:** a unit may **move, then attack**, and **cannot move or act after attacking** — unless it has a `dash_N` condition.

> **Applied conditions** (applied *to* a unit during play, stored on `unit.statuses`; they
> render under the **Conditions** group alongside inherent conditions):
> - **`corrosive_1`** — effective **defence −20%**. **`corrosive_2`** — effective **defence
>   −30%**. Do not stack (the higher level wins). Persist (not cleared at end of turn).
>   Applied by units with the **`corrosive` passive** when they hit a surviving target
>   (currently always `corrosive_1`).

---

## Area of Influence (AOI) — Zone of Control *(universal movement rule)*
Every unit projects an **AOI = the 3×3 grid around it** (Chebyshev radius 1, excluding its
own tile). By default **every** unit's movement is affected by enemy AOI:

> **Entering an enemy AOI tile immediately STOPS the unit.** The tile is a legal **final
> stop**, but the unit may not move any further from it — it cannot *pass through* AOI.

- **Start tile is exempt.** A unit that begins its turn already inside an enemy AOI may move
  **out** freely (the stop only triggers on *entering* an AOI tile via a step). It can also
  step to an adjacent AOI tile as a 1-tile final move.
- You may **cross at most one** AOI tile per move (as the final tile). Chaining through two
  AOI tiles is impossible regardless of movement points.
- **Only the tile you land on matters** — no diagonal corner-cutting rules.
- **Hidden enemies project no AOI.** A **burrowed** or **cloaked** enemy that the mover
  can't see does not halt movement (no information leak). A revealed/detected cloaked unit
  *does* project AOI.
- **Movement only** — AOI never affects attack range or line of sight.
- **`stumble`** is unchanged and stacks on top: a Stumble unit inside an enemy AOI is
  additionally capped to **1** total movement (see below).

**`aoi_none` — "No AOI":** the unit projects **no** Area of Influence — enemies move freely
through its zone (it never halts their movement). Used by the **Scout**, **Hive Scout**, and
**Sentinel** (recon/observer units that watch rather than hold ground). It still occupies its
own tile normally; only the surrounding zone-of-control is removed.

**TODO (scaffolded, no unit opts in yet):**
- **`aoi_large`** — the unit projects a **5×5** AOI (Chebyshev radius 2) instead of 3×3.
- **`aoi_immune`** — the unit **ignores enemy AOI** when moving (never stopped by it).

**Enforced in:** `game.ts` `enemyAOITiles` (builds the set of enemy-AOI tiles visible to the
mover, honouring `unitHiddenByCloak`), passed into `pathfinding.ts` `getReachableTiles`
(an AOI tile is recorded as a reachable STOP but never expanded from, except the start tile).
UI: `IsoCanvas` tints enemy-AOI tiles amber for the selected unit (`drawAOIHighlight`).

---

## Bump, Push & Collide — canonical glossary
Three distinct mechanics that are easy to confuse. Precise definitions:

### Bump *(a movement-reveal — no damage)*
A unit **trying to move onto** a tile it can't see clearly:
- **onto a cloaked enemy** it can't see (e.g. a Reaper into a cloaked Wraith), OR
- **onto impassable terrain hidden under cloud** (e.g. a Scuttling into a hidden mountain).

The unit **does not move** — it stays put, **reveals** the cloaked unit (for the current
turn) or the impassable tile (into fog memory), and (if it bumped an enemy) may still
attack. **Who reveals a cloaked enemy:** *any* unit **except a blind one** — a blind unit
bumps it but cannot pierce the cloak, so nothing is revealed. Burrowed enemies are **not**
bumped — a mover **co-occupies** them (the Wyrm-under mechanic).

### Blind death vs blocked *(lethal terrain)*
Only for **blind** units (Scuttlings, or any `blind`-condition unit — NOT burrowed):
- Walking onto a **HIDDEN lethal/void tile** (**water, lava, acid, chasm** — any
  (FLYING units hover over these and are unharmed.)
  `passable:false` terrain) → the unit **falls in and DIES** (the tile is then revealed).
- If that impassable tile was **already revealed**, the unit simply **can't move onto it**
  (blocked — the player sees the danger).
- A hidden **non-lethal** impassable (a **mountain**) → a **bump** (reveal + no move), never
  death.

### Push & Collide *(forced movement — Ram / Percussive Shells)*
A **push** is a forced move: **Ram** (Vindrace) and **Percussive Shells** (Titan) shove a
LIGHT unit one tile (heavy/class-less units are immune). Outcomes:
- empty passable tile → it **slides** there;
- **COLLIDE** — driven into a **unit, building, mountain, or the map edge** → it takes
  `COLLIDE_DAMAGE` (2) and **stays**; a LIGHT unit it collided with also takes 2 (heavy → 0);
- into a **void tile** (water/lava/acid/chasm) → it **falls in and DIES**.

("Collide" is the push-into-obstacle impact. Do **not** call it a "bump" — bump is the
movement-reveal above.)

**Enforced in:** `pathfinding.ts` `getReachableTiles` (bump targets via `hiddenEnemyTiles`
/ blind `bumpEnemies`; hidden-void death moves & mountain bumps via `knownTiles`);
`game.ts` `applyMove` (enemy reveal-bump, terrain bump, lethal-terrain death) and
`getVisibleState` (a bump-revealed tile overrides cloak for the turn); `push.ts`
`resolvePush` (`COLLIDE_DAMAGE`, void death). Reveals clear in `applyEndTurn`.

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

**Bump & death** (see the **Bump, Push & Collide** glossary above for the full rules):
- Moving onto a **hidden enemy** → **bump** (stay put, reveal it for the turn, may then
  attack at range 1). A blind unit bumps but **cannot reveal a CLOAKED** enemy.
- Moving onto a **hidden mountain** → **bump** (reveal + no move).
- Moving onto a **HIDDEN lethal/void** tile (water/lava/acid/chasm) → **falls in and DIES**;
  an **already-revealed** impassable tile is simply **blocked**.

**Enforced in:** visibility 0 falls out of the normal sight code (`fog.ts`); blind move
targets (enemy bumps, mountain bumps, hidden-void death moves) come from `pathfinding.ts`
(`bumpEnemies` / `knownTiles`); the bump/death itself is in `game.ts` (`applyMove` +
`GameState.revealedTiles`, cleared in `applyEndTurn`); cloud-tile move highlight is in
`IsoCanvas.tsx`.

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

## `corrosive` — Corrosive *(passive ability)*
**Rule:** when this unit attacks and the target **survives**, it applies the
**`corrosive_1` condition** to that target (does not stack). `corrosive_1` reduces the
affected unit's **defence by 20%** in all future combat until removed; `corrosive_2`
(reserved for future use) reduces it by **30%**. The higher level wins if both are present.

**Enforced in:** `game.ts` (`applyAttack` adds `corrosive_1` to the defender's
`statuses`) and `combat.ts` (`resolveCombat` multiplies the defender's defence by 0.8 for
`corrosive_1` / 0.7 for `corrosive_2`).

## `stumble` — Stumble
**Rule:** while this unit is standing inside an **enemy's area of influence**, its
movement is capped at **1** (regardless of its base movement or movement bonuses).

**Area of influence (AOI)** — unless a unit states otherwise, a unit's AOI is the **3×3
grid around it** (Chebyshev radius 1). Attack range does NOT widen it: a range-2 unit
still has a 3×3 AOI. So Stumble triggers when the unit is **adjacent to (incl.
diagonally) any enemy**. Counts all enemies, even unseen ones (the influence is real).

**Enforced in:** `pathfinding.ts` (`getReachableTiles`) — caps `maxMove` to 1 when the
unit has this condition and stands in an enemy AOI.

## `mountain_movement` / `mountain_defense` / `mountain_shooter` / `mountain_shooter_2` / `mountain_sight` *(passive abilities)*
**Rule:** each grants the ability to **move onto mountains** (the default is no unit can).
`mountain_movement` grants **access only** (no bonus). The others add a bonus while
standing on a mountain: `mountain_defense` → ×1.2 defence; `mountain_shooter` → ×1.2
attack; **`mountain_shooter_2` → ×1.2 attack AND +1 attack range**; `mountain_sight` →
visibility 2.

`mountain_shooter_2`'s **+1 attack range** raises the unit's *effective* attack range
while it stands on a mountain — this widens both the attacks it may make and the
retaliation it deals (a range-2 unit reaches range 3 from a peak).

**Enforced in:** `pathfinding.ts` (mountain access for all five), `combat.ts`
`getDefenseMultiplier` (mountain_defense), `resolveCombat` (mountain_shooter /
mountain_shooter_2 attack ×1.2) and `effectiveAttackRange` (the +1 range, used by
`game.ts` `getLegalActions` for offering attacks and by `resolveCombat` for the
retaliation range check), `fog.ts` (mountain_sight visibility).

## `mobile` — Mobile *(passive ability)*
**Rule:** ignores **terrain movement penalties** for **forest** and **mountains** (moving
through them costs no extra). **Placeholder** — the pathfinder currently charges a flat
cost of 1 for every passable tile (no terrain move penalties exist yet), so this has no
effect until the movement/pathing system lands. Registered so units can carry it and it
displays under Passive Abilities.

**Enforced in:** *(not yet — TODO in `pathfinding.ts` when terrain move costs ship; the
user will specify how the movement system works then).*

## `slash` — Slash *(passive ability)*
**Rule:** the unit's attack is a **sweeping strike at a 3-tile arc** instead of a single
target — it **replaces** the normal single-target attack (a Slash unit is never offered a
plain attack). The player picks a **central tile** (one of the unit's 8 neighbours); the
two **side tiles** are that central tile's neighbours *along the 8-tile ring* around the
unit (NOT every tile adjacent to both — that would over-select).

- **Central tile:** takes **100%** of the computed damage.
- **Side tiles:** take **50%** each (floored at `minimumDamage`).
- **Hits all units** — friendly units in the arc take damage too (friendly fire).
- **No retaliation** — struck units don't counter-attack.

Each target's damage is computed with the normal force-ratio formula (so its own
defence/terrain/corrosion still count), then split 100/50. A Slash is offered whenever
**any** of its 3 tiles holds an enemy. Slashing spends the turn (the unit stays put — an
AoE swing, no advance-into-tile, no Dash).

Examples (unit at `B2`): centre `B3` → arc `A3,B3,C3` (sides `A3,C3`). Centre `C2` → arc
`C1,C2,C3` (sides `C1,C3`). Centre corner `C3` → arc `C2,C3,B3` (sides `C2,B3`).

**Enforced in:** `slash.ts` (`getSlashArc` geometry + `slashHitDamage` 100/50 split),
`game.ts` (`getLegalActions` offers slashes for `slash` units instead of attacks;
`applySlash` resolves them). UI: `IsoCanvas.tsx` highlights the arc on hover and previews
the split damage; click the central tile to swing.

## `cloak` — Cloak *(passive ability)*
**Rule:** the unit is **invisible to enemy players** — filtered out of their view entirely,
**even with fog of war off** (cloak is separate from fog). It is revealed to an enemy only
when (a) that enemy has a **`detect`** unit adjacent to it (Chebyshev ≤ 1 — see `detect`),
(b) the unit is **marked** (`unit.statuses` includes `marked` — a hook for future
parasite/lock-on abilities; nothing applies it yet), or (c) an enemy unit **bumps** it by
trying to move onto its tile (a **bump** reveals it for that turn — see the glossary above).
A **blind** mover is the exception: it bumps but can't pierce the cloak, so it reveals
nothing. It also **uncloaks automatically while standing on a ruin or an ENEMY city**
(a neutral or its own city keeps it cloaked). The owner always sees their own cloaked
units (rendered **ghosted** so you can tell). Used by the **Wraith**.

**Enforced in:** `game.ts` `unitHiddenByCloak` (filters the unit list in `getVisibleState`,
both fog-on and fog-off branches; a tile bump-revealed this turn overrides cloak). Cloaked
enemies are **bump targets** (not silent blockers) via `pathfinding.ts` `hiddenEnemyTiles`.
UI: cloaked own-units draw at reduced opacity (`drawUnit.ts`).

## `detect` — Detect *(passive ability)*
**Rule:** reveals **cloaked** (Infiltrator) and **burrowed** (Wyrm) enemy units within
**range 1 (adjacent)** — see `cloak` / `burrowed`. *(Detect range is 1 "for now"; flagged to
revisit — it may later become the detector's sight radius.)*

**Enforced in:** `game.ts` `unitHiddenByCloak` (an adjacent viewer-owned `detect` unit
un-hides a cloaked/burrowed enemy).

## `burrowed` — Burrowed *(Wyrm state, from Burrow)*
**Rule:** the Wyrm's underground state (the unit type is `wyrm_burrowed`, reached via the
**Burrow** ability). While burrowed it is **invisible to enemies** (exactly like `cloak` —
revealed only by an adjacent enemy `detect` unit, or if `marked`), has **ATK 0 / DEF 0**
(very fragile if revealed), **VIS 0** (sees only its own tile), **MOV 2**, and **cannot
attack** (only `erupt`). Movement is special (see below). The owner sees it as a **dirt
mound**; enemies see nothing.

**Co-tile occupancy (movement):**
- A burrowed Wyrm may move **onto/under an enemy unit** (co-occupying its tile) — that's how
  it sets up an `erupt` kill. It may **not** co-occupy a **friendly** unit's tile. When it
  shares an enemy's tile, BOTH stay visible to the Wyrm's owner (the surface unit is drawn on
  top; the Wyrm peeks out behind). Clicking the shared tile selects the **Wyrm first**, then
  the enemy on the next click.
- A burrowed Wyrm **passes UNDER** impassable tiles (mountains, buildings, resource tiles,
  cities, **ruins**) — it may traverse them to reach a valid tile beyond (they aren't revealed
  when passed under) — but it **cannot STOP/occupy** them. (Provisional — may expand later,
  e.g. attacking REBs.) It also **can't Burrow or Erupt** while on a city/mountain/building
  tile, and **cannot found or capture cities** while burrowed.
- To **other** units, a burrowed **enemy** Wyrm is invisible and does **not block** movement
  (they may unknowingly step onto it); a burrowed **friendly** Wyrm **does** block (no
  friendly co-tile). An **unburrowed** Wyrm blocks normally.

**Blind/burrowed "bump" (penalise blind movement into clouds):** blind (scuttling) and
burrowed (Wyrm) units see only their own tile. To avoid leaking terrain, **all** cloud tiles
in range show as selectable move targets — including hidden impassable ones. Moving onto a
hidden impassable tile **bumps**: the unit lands on the last valid tile it can reach, the
impassable tile is **revealed as fog** (grey), and the remaining movement is wasted. (A
scuttling can't pass through a mountain, so it bumps the first one; a Wyrm passes under
intermediates and only bumps an impassable **destination**.)

**Enforced in:** `game.ts` `getVisibleState`/`unitHiddenByCloak` (hidden); `getLegalActions`
(no attack for burrowed; no capture; emits bump move actions with `bumpReveal`); `applyMove`
(the bump — land + reveal); `economy.ts` `canFoundCity` (no found); `pathfinding.ts`
`getReachableTiles` (occupiable-vs-traversable + the `bumps` out-param, using the `buildings`
arg and `isBurrowed`/`blind` flags; ruins/cities/resources/buildings are non-stoppable).

---

## `twin_strike` — Body Slam *(passive ability — surfaced Wyrm)*
*(Internal id stays `twin_strike`; the player-facing name is **Body Slam**.)*

**Rule:** the surfaced Wyrm's attack replaces the normal single-target attack. It hits **two
touching cells**: `tiles[0]` (**primary**, 100% damage) must be within the Wyrm's **3×3**
(Chebyshev 1, never its own tile); `tiles[1]` (**secondary**, 50% damage) must be **adjacent**
(Chebyshev 1) to the primary and also not the Wyrm's tile. **You must pick two tiles** — a
struck tile hits whatever is on it, **friend or foe** (so if the only enemy is ringed by your
own units, the second pick lands on a friendly, which is slammed too). **No retaliation.** The
Wyrm may **move OR slam**, not both (`mustStayToAttack` — it must not have moved). Damage uses
the normal combat formula per struck unit, then `slashHitDamage` scales the secondary to 50%.

**Strike into fog/cloud:** the attack targets **tiles**, so either cell may be a fogged or
clouded tile. Each struck tile is **revealed for the current turn** (via `revealedTiles`) so
its unit and the damage show, and its terrain is written to **fog memory** (a clouded tile
becomes fog permanently). At end of turn `revealedTiles` clears, so a surviving hidden unit
reverts to hidden — the terrain stays as fog.

**UI:** armed from the Unit Info panel ("Body Slam") and aimed with a **2-cell picker**
(tick the first tile, then a touching second tile, then Continue — both are mandatory) —
same flow as Ballistic Volley / territory expansion. Floating damage numbers show on both cells.

**Enforced in:** `game.ts` `getLegalActions` (offers `wyrmStrike` pairs via `wyrmStrikePairs`,
gated by `mustStayToAttack`), `applyWyrmStrike` (validate `wyrmStrikeLegal`, damage, reveal);
web `strikeSelect` store slice + `StrikeSelectBar` + `strikePicker` in `IsoCanvas`.

---

## Active abilities (casts)

Opt-in abilities in a unit's `abilities` array. Casting spends the unit's turn and starts
a cooldown (see the "Casting model" note above). Currently only the **Seercaust** (Hive).

### `infect` — Infect
**Rule:** cast on a **LIGHT** unit (any owner) within **range 3** (7×7). The target gains
the **`infected`** condition and remembers the caster (`unit.infectedBy`). When an infected
unit **dies**, it spawns **2 scuttlings for the infector**: one on the tile it died on, one
on a random free tile in the surrounding 3×3 (deterministic PRNG). If a melee killer would
advance into the death tile but a scuttling spawned there, the advance is skipped.

**Enforced in:** `game.ts` — `applyUseAbility` (applies `infected` + `infectedBy`);
`spawnScuttlingsFromInfected` (death spawn), called from `applyAttack` and `applySlash`
after removing the dead unit.

### `spray_bile` — Spray Bile
**Rule:** infect a **tile** within **range 2** (5×5) for **5 rounds** (`tile.bile =
{ owner, expiresTurn }`). While active:
- **Friendly** units (owner === `bile.owner`) on the tile get **ATK ×1.2** and **DEF ×1.2**.
- **Enemy** units get **DEF ×0.8** — and a **movement penalty** (⚠️ **placeholder**, not yet
  implemented; ties into the future pathing system).

Cleared when `state.turn >= expiresTurn`. Rendered with a **purple tile tint**; click the
tile to see its buffs/debuffs and a turns-left counter.

**Enforced in:** `game.ts` — `applyUseAbility` (sets `tile.bile`), `applyEndTurn` (expiry);
`combat.ts` `resolveCombat` (the ATK/DEF multipliers). Movement penalty: TODO in
`pathfinding.ts` when pathing lands.

### `assault_mode` — Assault Mode (mode toggle)
**Rule:** a **self-cast** ability (no target) that **morphs** the unit into another unit
type and back — a stat-profile toggle. The **Tank** (`tank`) enters Assault Mode
(→ `tank_assault`) and exits (→ `tank`). **Each toggle spends the unit's turn.** The unit
keeps its id / HP / position (HP is clamped to the new type's max). Modelled via
`AbilityDef.morphTo` (the id to become); the two forms each carry an `assault_mode` ability
pointing at the other.

Tank normal → assault stat change: ATK 2→5, DEF 3→2, MOV 2→0, range 2 → **3–4 (banded)**,
VIS 1→3.

**Enforced in:** `game.ts` `applyUseAbility` (the `ability.morphTo` branch swaps `typeId`);
offered as a self-target ability in `getLegalActions`. UI: a cast button in `UnitSheet`
that fires immediately (no targeting) for abilities with no `targetKind`.

### `burrow` / `erupt` — Burrow & Erupt (Wyrm)
**Burrow** (self-cast, spends the turn): morphs `wyrm` → `wyrm_burrowed` (the `burrowed`
state above), keeping id/HP/position. It's the Hive's stealth tool. **Erupt** is the only way
back up.

**Erupt** (self-cast, spends the turn): morphs `wyrm_burrowed` → `wyrm` (surface) **and
instantly kills any enemy unit sharing the Wyrm's tile** (the one it burrowed under) —
regardless of that unit's HP (for now). May also erupt on an empty tile just to surface.
After erupting it can't move or attack further that turn. (An infected erupt-victim still
spawns its scuttlings.)

**Enforced in:** `game.ts` `applyUseAbility` — Burrow via the generic `ability.morphTo`
branch; Erupt via a dedicated branch (kill co-located enemies, then morph). Both are offered
as self-target abilities and fire immediately from the UnitSheet cast button.

### `stun` — Stun (Infiltrator)
**Rule:** used **instead of attacking** (spends the turn), targets an **enemy** unit within
**range 3** (no cooldown). Applies the **`stunned`** condition: the target **cannot move or
attack for 1 turn** — it recovers at the end of its own next turn. Using Stun does **not**
reveal a cloaked Infiltrator. Ability data: `targetKind: unit`, `targetEnemy: true`,
`range: 3`.

**Enforced in:** `game.ts` `applyUseAbility` (adds `stunned` to the target); `getLegalActions`
skips a `stunned` unit's actions and clears it at end of that unit's turn (`applyEndTurn`).
The `stunned` condition shows under the Unit Info **Conditions** group.

### `plant_explosives` — Plant Explosives (Infiltrator) — **DISABLED placeholder**
**Rule (intended):** plant an explosive on a unit/building; explodes after **2 turns** for
**15 dmg to units** / **2 hits to buildings**. **Not implemented** — the ability carries
`"disabled": true`, so the engine never offers it and the UI shows it **greyed out**. Fuse
/ removal / follow-a-moving-unit rules and the building hit-count model are still TBD (see
`docs/overlap.md` and the deferred notes).

**Enforced in:** *(none yet — `getLegalActions` skips `disabled` abilities).*

---

## Applied conditions (from play)

- **`stunned`** — can't move or attack for 1 turn (from `stun`). Cleared at the end of the
  stunned unit's own turn. Also see `corrosive_1/2`, `infected` (elsewhere in this doc).

---

## Banded attack range (`minAttackRange`)

By default a unit fires from range **1 up to `attackRange`** (Chebyshev). A unit with
**`minAttackRange > 1`** has a **banded weapon**: it can only hit targets whose distance is
in **[`minAttackRange`, `attackRange`]** — it cannot fire *closer* than the minimum. E.g.
the assault Tank's `range[3–4]` (min 3, max 4) cannot hit anything at range 1–2, so an
adjacent attacker takes **no retaliation** from it.

Written `range[min–max]` in design notes and shown as **"min–max"** in the Unit Info Range
stat (a plain max when min = 1). As of this writing the **assault Tank is the only banded
unit** — every other unit fires from range 1.

**Enforced in:** `game.ts` `getLegalActions` (attack offered only when
`minRange ≤ Chebyshev dist ≤ effective max`) and `combat.ts` `resolveCombat` (the same band
gates retaliation). Max range still gets the `mountain_shooter_2` +1 via `effectiveAttackRange`.

## Current assignments
- **Scout** (`scout`, Vanguard): `mountain_restricted` (redundant), `low_horizons`, `impotent_founder`.
- **Bulwark** (`defender`, Vanguard): `mountain_defense`.
- **Stalker** (`stalker`, Vanguard): `mountain_movement`, `mountain_shooter_2`, `mobile`.
- **Lancer** (`lancer`, Vanguard): `mountain_shooter`.
- **Scuttling** (`scuttling`, Hive): `sacrificial_founder`, `blind`.
- **Scout** (`hive_scout`, Hive): `squinting_eyes_2`, `impotent_founder`, `stumble`.
- **Reaper** (`reaper`, Hive): `dash_1`.
- **Scab** (`scab`, Hive): `corrosive`, `mountain_sight`.
- **Vindrace** (`vindrace`, Hive): `slash`, `mountain_movement`.
- **Seercaust** (`seercaust`, Hive): `detect` (passive); active abilities `infect`, `spray_bile`.
- **Wraith** (`wraith`, Vanguard): `cloak` (passive); active abilities `stun`, `plant_explosives` (disabled placeholder).
- **Wyrm** (`wyrm` / `wyrm_burrowed`, Hive): active ability `burrow` (surface) / `erupt` (burrowed); `burrowed` condition while underground. Surface 2-tile chain attack is **Stage B / pending**. Cost 200; HP 30; surface ATK 3/DEF 3/MOV 1; burrowed ATK 0/DEF 0/MOV 2.
- **Vindrace** (`vindrace`, Hive): also has active ability `ram` (push an adjacent light enemy).
- **Titan** (`titan`, Vanguard, tech `titan`): active `percussive_shells` (impact + radial push).
- **Sentinel** (`sentinel`, Vanguard, tech `sentinel`): AIR (`flying`); passives `detect_2`, `overwatch_network_1`; active `kinetic_shield`; ATK 0 (can't attack).

## Push, shields & auras (Vanguard/Hive)

- **`ram`** (Vindrace active) / **`percussive_shells`** (Titan active) — share the **push engine**
  (`push.ts`). Only **LIGHT** units are affected (heavy/air immune). A pushed unit goes one tile
  straight away; into an **obstacle** (mountain / unit / building / map edge) → **2 dmg**, it
  stays (a bumped LIGHT unit also takes 2, a heavy 0); into **void terrain** (water/lava/…) →
  it **dies**; empty passable tile → it slides across. Percussive Shells additionally deals a
  normal Titan hit to a light unit on the impact tile, then pushes the 8 surrounding light units
  radially outward. Enforced in `game.ts` (`applyPercussiveShells`, `ram` branch) + `push.ts`.
- **`kinetic_shield`** (Sentinel active) → the **`shielded`** status: absorbs 100% of the next
  hit, then is consumed. Enforced in `game.ts` `tryAbsorbShield` (applied in `applyAttack`).
- **`detect_2`** — Detect within **range 2** (5×5). `overwatch_network_1` — friendly **ranged**
  units within the holder's 3×3 get **+1 attack range**. Enforced in `game.ts`
  (`unitHiddenByCloak` range; the attack-offering aura bonus in `getLegalActions`).
- **Combined Arms** (tech `combined_arms`) — a LIGHT unit's 2nd+ attack on the SAME enemy this
  turn gets **×1.2** (no stack). `state.combinedArmsHits` counts per target, reset each turn;
  applied via `resolveCombat`'s `attackMultiplier`.

*(Conditions are independent of `traits` — traits like `flying`/`aquatic`/
`ignoresTerrainCost` are movement/terrain flags baked into pathfinding; conditions are
the named, documented, reusable special rules tracked in this file.)*
