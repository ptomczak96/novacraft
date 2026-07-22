import { z } from 'zod';

export const EffectDefSchema = z.object({
  type: z.enum(['damage', 'push', 'heal', 'applyStatus', 'revealArea', 'spawnUnit', 'modifyStat']),
  params: z.record(z.union([z.number(), z.string()])),
});

export const AbilityDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  effects: z.array(EffectDefSchema),
  cooldown: z.number().optional(),
  morphTo: z.string().optional(), // if set, casting morphs the unit into this unit type (e.g. assault mode)
  range: z.number().optional(), // Chebyshev cast range (tiles). Omitted = self/no-target.
  minRange: z.number().optional(), // minimum Chebyshev cast range (tiles closer than this are illegal)
  targetKind: z.enum(['unit', 'units', 'tile', 'grid2x2']).optional(), // 'units' = multi-unit pick
  targetClass: z.string().optional(), // if targetKind 'unit', restrict to this unitClass (e.g. "light")
  targetClasses: z.array(z.string()).optional(), // if targetKind 'units', restrict to these unitClasses
  maxTargets: z.number().optional(), // for targetKind 'units': how many distinct targets may be picked
  targetEnemy: z.boolean().optional(), // if targetKind 'unit', restrict to enemy units only
  targetAlly: z.boolean().optional(), // restrict to friendly units only
  targetAfflicted: z.boolean().optional(), // Cure: only units with a removable affliction are eligible
  disabled: z.boolean().optional(), // greyed-out placeholder ability — never offered/castable yet
  duration: z.number().optional(), // effect duration in rounds (e.g. Spray Bile = 5)
  requiresTech: z.string().optional(), // ability only castable once this tech is researched
  supersededByTech: z.string().optional(), // ability hidden once this tech is researched (replaced)
});

export const TerrainTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  movementCost: z.number().min(0),
  defenceBonus: z.number(),
  blocksSight: z.boolean(),
  passable: z.boolean(),
  resourceYield: z.number().min(0),
  color: z.string(),
  icon: z.string(),
});

export const UnitTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  faction: z.string(),
  cost: z.number().min(0),
  maxHP: z.number().min(1),
  attack: z.number().min(0),
  defence: z.number().min(0),
  movement: z.number().min(0),
  attackRange: z.number().min(0), // max attack range (Chebyshev); 0 = cannot attack (e.g. Burstling)
  minAttackRange: z.number().min(1).optional(), // min attack range; >1 = a banded weapon that can't fire closer (default 1)
  visibility: z.number().min(0), // fog sight radius: 0=own tile, 1=3x3, 2=5x5 …
  unitClass: z.string().optional(), // e.g. "light" — flavour/grouping, not yet mechanical
  popCost: z.number().min(0).optional(), // pop weight per unit (default 1; scuttling 0.5)
  recruitCount: z.number().int().min(1).optional(), // units spawned per recruit (default 1; scuttling 2)
  conditions: z.array(z.string()).optional().default([]), // special conditions (see docs/conditions.md)
  abilities: z.array(AbilityDefSchema),
  traits: z.array(z.string()),
});

export const FactionDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  // Units this faction spawns with at game start (default: one warrior).
  startingUnits: z.array(z.object({ unit: z.string(), count: z.number().int().min(1) })).optional(),
  unitTypes: z.array(z.string()),
});

export const TechEffectSchema = z.object({
  type: z.enum(['unlockUnit', 'globalModifier', 'grantCondition']),
  params: z.record(z.union([z.number(), z.string()])),
});

export const TechDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  branch: z.string(),
  level: z.number().min(1),
  effects: z.array(TechEffectSchema),
  prerequisites: z.array(z.string()).optional(), // ALL must be researched
  prerequisitesAny: z.array(z.string()).optional(), // at least ONE must be researched (e.g. Crucible OR Mech Bay)
  excludes: z.array(z.string()).optional(), // mutually-exclusive: researching any of these locks this tech out
  locked: z.boolean().optional(),
});

export const TechConfigSchema = z.object({
  maxLevel: z.number().min(1),
  costBaseByLevel: z.array(z.number().min(0)),
  costPerCityByLevel: z.array(z.number().min(0)),
});

export const CombatConfigSchema = z.object({
  hpScaling: z.boolean(),
  retaliationMultiplier: z.number(),
  minimumDamage: z.number(),
  damageVariance: z.number().min(0).max(1),
});

export const GameConfigSchema = z.object({
  mapWidth: z.number().min(8).max(24),
  mapHeight: z.number().min(8).max(24),
  fogOfWar: z.boolean(),
  turnLimit: z.number().min(1),
  winConditions: z.object({
    captureAllCities: z.boolean(),
    captureCapital: z.boolean().optional(),
    eliminateAllUnits: z.boolean(),
    highestScoreAtLimit: z.boolean(),
  }),
  combatConfig: CombatConfigSchema,
  heal: z.object({
    friendlyTerritory: z.number(),
    neutralTerritory: z.number(),
    enemyTerritory: z.number(),
  }).optional(),
  scoreWeights: z.object({
    cityValue: z.number(),
    unitCostValue: z.number(),
    incomeValue: z.number(),
  }),
  comebackThreshold: z.number(),
});

export const BuildingDefSchema = z.object({
  on: z.enum(['ore', 'plasma', 'land']),
  output: z.enum(['ore', 'plasma']),
  maxLevel: z.number().min(1),
  perCity: z.number().min(1).nullable(),
  costByLevel: z.array(z.number().min(0)),
  plasmaCostByLevel: z.array(z.number().min(0)).optional(),
  outputByLevel: z.array(z.number().min(0)).optional(),
  supplyByLevel: z.array(z.number().min(0)).optional(),
  adjacentTo: z.enum(['mine', 'extractor', 'refinery', 'purifier']).optional(),
  outputPerAdjacentByLevel: z.array(z.number().min(0)).optional(),
  supplyPerAdjacentByLevel: z.array(z.number().min(0)).optional(),
  techRequired: z.string().nullable().optional(),
  upgradeTechRequired: z.array(z.string().nullable()).optional(),
});

export const EconomyDataSchema = z.object({
  upkeepMultiplier: z.number().min(0),
  upkeepDefault: z.number().min(0),
  upkeepByUnit: z.record(z.number().min(0)),
  startingOre: z.number().min(0),
  startingPlasma: z.number().min(0),
  city: z.object({
    maxLevel: z.number().min(1),
    capitalBaseProduction: z.number().min(0),
    cityBaseProduction: z.number().min(0),
    productionPerLevel: z.number().min(0),
    popBase: z.number().min(1),
    supplyThresholds: z.array(z.number().min(0)),
    territoryRadius: z.number().min(1),
    capitalSightRadius: z.number().min(0), // fog: Chebyshev radius a capital reveals (5x5 = 2)
  }),
  buildings: z.record(BuildingDefSchema),
  foundCity: z.object({ cost: z.number().min(0), requiresUnitOnTile: z.boolean() }),
  unitPlasmaCost: z.record(z.number().min(0)),
});

export const TerrainDataSchema = z.array(TerrainTypeSchema);
export const UnitDataSchema = z.array(UnitTypeSchema);
export const FactionDataSchema = z.array(FactionDefSchema);
export const TechDataSchema = z.array(TechDefSchema);

export const BotConfigSchema = z.object({
  greedy: z.object({
    damageWeight: z.number(),
    killWeight: z.number(),
    captureWeight: z.number(),
    incomeWeight: z.number(),
    safetyWeight: z.number(),
    exploreWeight: z.number(),
    healWeight: z.number(),
  }),
});
