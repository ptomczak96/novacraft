# Tactica — Cross-Module Overlap Log

Hand-off log for work that crosses module boundaries: when a change in one
contributor's module needs work, correction, or wiring in **another**
contributor's module, it's recorded here so the other owner can pick it up.

Triggered by saying **"commit to overlap"** (see `CLAUDE.md`). Append-only; each
entry is dated, attributed, and stays under **Open** until the owning module
marks it **Done**.

Format per entry: **[date] — author → affected module** · what / how / why / status

---

## Open

### 2026-06-23 — economy → Map gen / fog-of-war (Patrick)
**Tech: Prospecting (Refinement branch, L1).**
- **What:** Prospecting reveals all resource tiles (ore outcrops, plasma vents)
  within **4 tiles (Chebyshev) of each of the player's cities** — but does **not**
  reveal a tile if an **opponent's REB** is built on it.
- **How (suggested):** the tech carries a generic effect `revealResourcesRange: 4`.
  The fog/visibility code (`computeVisibility` / `getVisibleState`) should, for the
  owning player, mark resource tiles within that range of owned cities as visible,
  excluding tiles occupied by an enemy building.
- **Why:** the economy branch scaffolds the tech (it exists, is researchable, and
  carries the effect), but the actual revealing lives in the **fog system**, which
  is Patrick's module. Fog is currently OFF (`config.fogOfWar: false`), so this is
  inert until fog is enabled.
- **Status:** OPEN — awaiting fog wiring on the Map gen side.

## Done

_(none yet)_
