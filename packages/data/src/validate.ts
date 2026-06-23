import { TerrainDataSchema, UnitDataSchema, FactionDataSchema, TechDataSchema, TechConfigSchema, GameConfigSchema, EconomyDataSchema, BotConfigSchema } from './schemas.js';
import terrainData from '../json/terrain.json';
import unitData from '../json/units.json';
import factionData from '../json/factions.json';
import techData from '../json/tech-tree.json';
import techConfigData from '../json/tech-config.json';
import configData from '../json/config.json';
import economyData from '../json/economy.json';
import botConfigData from '../json/bot-config.json';

let hasError = false;

function validate(name: string, schema: { parse: (data: unknown) => unknown }, data: unknown) {
  try {
    schema.parse(data);
    console.log(`✓ ${name} valid`);
  } catch (err) {
    console.error(`✗ ${name} INVALID:`);
    console.error(err);
    hasError = true;
  }
}

validate('terrain.json', TerrainDataSchema, terrainData);
validate('units.json', UnitDataSchema, unitData);
validate('factions.json', FactionDataSchema, factionData);
validate('tech-tree.json', TechDataSchema, techData);
validate('tech-config.json', TechConfigSchema, techConfigData);
validate('config.json', GameConfigSchema, configData);
validate('economy.json', EconomyDataSchema, economyData);
validate('bot-config.json', BotConfigSchema, botConfigData);

if (hasError) {
  console.error('\nData validation FAILED');
  process.exit(1);
} else {
  console.log('\nAll data files valid.');
}
