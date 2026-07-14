# Tactica — Unit Special Conditions

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
| `frazzled` | Frazzled | While inside an enemy's **area of influence** (the 3×3 around it), its movement is capped at **1**. |
| `mountain_movement` | Mountain Movement | Can climb mountains (movement access only — **no combat or sight bonus**). |
| `mountain_defense` | Mountain Defense | Can climb mountains; gains **×1.2 defence** while on a mountain. |
| `mountain_shooter` | Mountain Shooter | Can climb mountains; gains **×1.2 attack** while on a mountain. |
| `mountain_shooter_2` | Mountain Shooter 2 | Can climb mountains; while on one, gains **×1.2 attack AND +1 attack range**. |
| `mountain_sight` | Mountain Sight | Can climb mountains; its **visibility becomes 2** while on a mountain. |
| `mobile` | Mobile | Ignores terrain **movement** penalties for forest & mountains. *(Placeholder — no terrain move costs exist yet; wires into pathing later.)* |
| `detect` | Detect | *(passive ability)* Reveals nearby **cloaked/burrowed** units. (Placeholder — no cloak/burrow units exist yet.) |
| `slash` | Slash | *(passive ability)* Attack hits a **3-tile arc**: central tile 100% damage, the two side tiles 50%. Enemies only; **no retaliation**. Replaces the normal single-target attack. |

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

## `corrosive` — Corrosive *(passive ability)*
**Rule:** when this unit attacks and the target **survives**, it applies the
**`corrosive_1` condition** to that target (does not stack). `corrosive_1` reduces the
affected unit's **defence by 20%** in all future combat until removed; `corrosive_2`
(reserved for future use) reduces it by **30%**. The higher level wins if both are present.

**Enforced in:** `game.ts` (`applyAttack` adds `corrosive_1` to the defender's
`statuses`) and `combat.ts` (`resolveCombat` multiplies the defender's defence by 0.8 for
`corrosive_1` / 0.7 for `corrosive_2`).

## `frazzled` — Frazzled
**Rule:** while this unit is standing inside an **enemy's area of influence**, its
movement is capped at **1** (regardless of its base movement or movement bonuses).

**Area of influence (AOI)** — unless a unit states otherwise, a unit's AOI is the **3×3
grid around it** (Chebyshev radius 1). Attack range does NOT widen it: a range-2 unit
still has a 3×3 AOI. So Frazzled triggers when the unit is **adjacent to (incl.
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
- **Enemies only** — friendly units in the arc are untouched.
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
when (a) that enemy has a **`detect`** unit adjacent to it (Chebyshev ≤ 1 — see `detect`), or
(b) the unit is **marked** (`unit.statuses` includes `marked` — a hook for future
parasite/lock-on abilities; nothing applies it yet). The owner always sees their own cloaked
units (rendered **ghosted** so you can tell). Used by the **Infiltrator**.

**Enforced in:** `game.ts` `unitHiddenByCloak` (filters the unit list in `getVisibleState`,
both fog-on and fog-off branches). UI: cloaked own-units draw at reduced opacity
(`drawUnit.ts`).

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
  it sets up an `erupt` kill. It may **not** co-occupy a **friendly** unit's tile.
- A burrowed Wyrm **passes UNDER** impassable tiles (mountains, buildings, resource tiles,
  cities) — it may traverse them to reach a valid tile beyond (they aren't revealed when
  passed under) — but it **cannot STOP/occupy** them. (Provisional — may expand later, e.g.
  attacking REBs.) It also **can't Burrow or Erupt** while on a city/mountain/building tile.
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
(no attack for burrowed; emits bump move actions with `bumpReveal`); `applyMove` (the bump —
land + reveal); `pathfinding.ts` `getReachableTiles` (occupiable-vs-traversable + the `bumps`
out-param, using the `buildings` arg and `isBurrowed`/`blind` flags).

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
- **Scout** (`hive_scout`, Hive): `squinting_eyes_2`, `impotent_founder`, `frazzled`.
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
