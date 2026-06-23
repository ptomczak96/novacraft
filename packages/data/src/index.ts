import terrainData from '../json/terrain.json';
import unitData from '../json/units.json';
import factionData from '../json/factions.json';
import techData from '../json/tech-tree.json';
import techConfigData from '../json/tech-config.json';
import configData from '../json/config.json';
import economyData from '../json/economy.json';
import botConfigData from '../json/bot-config.json';
import type { TerrainType, UnitType, FactionDef, TechDef, TechConfig, GameConfig, EconomyData, DataRegistry } from '@tactica/engine';

export const defaultTerrain: TerrainType[] = terrainData as TerrainType[];
export const defaultUnits: UnitType[] = unitData as UnitType[];
export const defaultFactions: FactionDef[] = factionData as FactionDef[];
export const defaultTechs: TechDef[] = techData as TechDef[];
export const defaultTechConfig: TechConfig = techConfigData as TechConfig;
export const defaultConfig: GameConfig = configData as GameConfig;
export const defaultEconomy: EconomyData = economyData as EconomyData;
export const defaultBotConfig = botConfigData;

export function buildRegistry(
  terrain: TerrainType[] = defaultTerrain,
  units: UnitType[] = defaultUnits,
  factions: FactionDef[] = defaultFactions,
  techs: TechDef[] = defaultTechs,
  economy: EconomyData = defaultEconomy,
  techConfig: TechConfig = defaultTechConfig,
): DataRegistry {
  return {
    terrainTypes: Object.fromEntries(terrain.map(t => [t.id, t])),
    unitTypes: Object.fromEntries(units.map(u => [u.id, u])),
    factions: Object.fromEntries(factions.map(f => [f.id, f])),
    techs: Object.fromEntries(techs.map(t => [t.id, t])),
    techConfig,
    economy,
  };
}

export { terrainData, unitData, factionData, techData, techConfigData, configData, economyData, botConfigData };
