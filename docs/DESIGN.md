# Tactica — Game Design Document (v1)

## Map

- Square grid, default 12x12 (configurable 8-24)
- Terrain types:
  - **Plains** — move cost 1, no defence bonus
  - **Forest** — move cost 2, +20% defence, blocks line of sight
  - **Mountain** — impassable, blocks line of sight
  - **Water** — impassable to land units
  - **River** — move cost 2, -10% defence
  - **Resource** — plains variant, yields +2 income when controlled

## Factions

Two factions with asymmetric rosters:

### Ironclad Dominion
Shared units + Berserker (high attack, rage ability) + Siege Tower (ranged, high HP/defence)

### Sylvan Accord
Shared units + Ranger (fast, ignores terrain, camouflage) + Treant (high HP, entangle ability)

## Units (Shared Roster)

| Unit     | Cost | HP | ATK | DEF | MOV | RNG | Sight |
|----------|------|----|-----|-----|-----|-----|-------|
| Scout    | 3    | 8  | 3   | 1   | 4   | 1   | 4     |
| Warrior  | 5    | 15 | 6   | 3   | 2   | 1   | 2     |
| Archer   | 5    | 10 | 5   | 1   | 2   | 2   | 3     |
| Defender | 6    | 20 | 3   | 6   | 1   | 1   | 2     |
| Catapult | 8    | 8  | 10  | 1   | 1   | 3   | 2     |

## Turn Structure

- Alternating full turns (Player A moves all units, then Player B)
- Each unit may move and attack once per turn (move-then-attack; not attack-then-move)
- Units with `noMoveAndAttack` trait cannot move and attack in the same turn

## Combat

Deterministic by default (zero RNG). Formula:

```
damage = attacker.attack × (attacker.HP / attacker.maxHP) × (1 - terrain.defenceBonus) - defender.defence
```

- Minimum damage: 1
- Defender retaliates at 50% attack if attacker is within defender's range and defender survives
- HP scaling, retaliation multiplier, minimum damage, and damage variance are all configurable

## Economy

- Cities produce 3 income/turn
- Resource tiles produce 2 income/turn
- Starting gold: 10
- Recruit units at owned cities (unit spawns on city tile)
- Capture: move a unit onto an enemy/neutral city to capture it

## Tech Tree

8 technologies in a DAG structure. Each costs gold and grants an instant global effect:
- Forestry (forest move cost → 1)
- Roads (+1 plains movement bonus)
- Advanced Archery (+1 ranged attack)
- Fortification (+20% city defence)
- Taxation (+1 city income)
- Siege Engineering (+2 siege attack, requires Archery)
- Logistics (+1 all movement, requires Roads)
- Diplomacy (+1 resource income, requires Taxation + Fortification)

## Fog of War

- Tiles: hidden → explored → visible
- Units reveal tiles within sight range, blocked by sight-blocking terrain (Bresenham LOS)
- Toggleable per game (off = perfect information mode)

## Win Conditions (any combination, configurable)

1. **Capture All Cities** — control every city on the map
2. **Eliminate All Units** — destroy all enemy units
3. **Highest Score at Turn Limit** — score = cities×10 + units' total cost + income×2
