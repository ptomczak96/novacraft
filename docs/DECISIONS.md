# Design Decisions

Decisions made where the brief was ambiguous. Each follows the "simplest reasonable choice" principle.

## City Capture: Instant vs. Full-Turn
**Decision:** Instant capture when a unit moves onto an enemy city.
**Rationale:** The brief says "a unit standing on an enemy/neutral city for one full turn captures it" but implementing delayed capture adds significant state tracking complexity for the prototype. Instant capture lets founders test faster. Can be changed to delayed by adding a `captureTurnsRemaining` field later.

## Unit Spawn After Recruit
**Decision:** Newly recruited units cannot act on the turn they're recruited (hasMoved=true, hasAttacked=true).
**Rationale:** Prevents recruiting-and-immediately-attacking cheese. Standard for 4X games.

## Map Generation
**Decision:** Probabilistic terrain distribution with guaranteed passable area around starting cities.
**Rationale:** Ensures playable maps. Mountain/water placement is random but city surroundings are always cleared to plains.

## Bot Legal Action Computation
**Decision:** Bots recompute legal actions from VisibleState rather than receiving them from the engine.
**Rationale:** Bots only see the fog-filtered VisibleState, not the full GameState. This is more realistic for testing fog-of-war gameplay.

## Fog of War: Bresenham LOS
**Decision:** Used Bresenham line algorithm for line-of-sight checks.
**Rationale:** Simpler than shadowcasting, good enough for the prototype grid sizes (8-24). Can be upgraded later.

## Tech Effects: Applied via Modifier Lookup
**Decision:** Tech effects modify game calculations through a modifier lookup system rather than mutating data.
**Rationale:** Keeps data immutable and effects composable. The engine checks `getModifier(player, registry, 'modifierName')` when computing movement, income, etc.

## Tile Ownership for Resources
**Decision:** Moving any unit onto a resource tile claims it for that player.
**Rationale:** Simpler than requiring a dedicated "claim" action. Mirrors city capture behavior.
