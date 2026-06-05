import {
  createGame, applyAction, getVisibleState, getResult, computeScores,
  type GameState, type GameConfig, type GameResult, type DataRegistry, type Action,
} from '@tactica/engine';
import { buildRegistry, defaultConfig } from '@tactica/data';
import { RandomBot, GreedyBot, type Bot } from '@tactica/bots';
import * as fs from 'fs';
import * as path from 'path';

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultVal;
}

const numGames = parseInt(getArg('games', '200'));
const botAType = getArg('bot-a', 'greedy');
const botBType = getArg('bot-b', 'greedy');
const baseSeed = parseInt(getArg('seed', '42'));
const outDir = getArg('out', 'results/default');

function createBot(type: string, seed: number): Bot {
  switch (type) {
    case 'random': return new RandomBot(seed);
    case 'greedy': return new GreedyBot(undefined, seed);
    default: return new GreedyBot(undefined, seed);
  }
}

// ── Simulation ──
interface GameRecord {
  seed: number;
  winner: number | null;
  winCondition: string;
  gameLength: number;
  p0UnitsBuilt: number;
  p1UnitsBuilt: number;
  p0Faction: string;
  p1Faction: string;
  unitBuilds: Record<string, number>;
  leadChanges: number;
  isComebackWin: boolean;
}

function runSingleGame(
  config: GameConfig,
  registry: DataRegistry,
  factions: [string, string],
  seed: number,
  botA: Bot,
  botB: Bot,
): GameRecord {
  let state = createGame(config, registry, factions, seed);
  const bots = [botA, botB];
  let p0UnitsBuilt = 0;
  let p1UnitsBuilt = 0;
  const unitBuilds: Record<string, number> = {};

  // Track scores for comeback detection
  const scoreHistory: [number, number][] = [];
  let leadChanges = 0;
  let prevLeader: number | null = null;

  const maxSteps = config.turnLimit * 50; // safety cap
  let steps = 0;

  while (state.phase === 'playing' && steps < maxSteps) {
    const currentPlayer = state.currentPlayer;
    const bot = bots[currentPlayer];
    const visible = getVisibleState(state, currentPlayer, registry);
    const action = bot.chooseAction(visible, registry);

    // Track recruits
    if (action.type === 'recruit') {
      if (currentPlayer === 0) p0UnitsBuilt++;
      else p1UnitsBuilt++;
      const key = `${factions[currentPlayer]}:${action.unitTypeId}`;
      unitBuilds[key] = (unitBuilds[key] || 0) + 1;
    }

    // Track scores at end of each turn
    if (action.type === 'endTurn') {
      const scores = computeScores(state, registry);
      scoreHistory.push([scores[0] || 0, scores[1] || 0]);
      const leader = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : -1;
      if (prevLeader !== null && leader !== prevLeader && leader !== -1 && prevLeader !== -1) {
        leadChanges++;
      }
      if (leader !== -1) prevLeader = leader;
    }

    state = applyAction(state, action, registry);
    steps++;
  }

  // Force end if still playing
  if (state.phase === 'playing') {
    state = { ...state, phase: 'finished', winner: null, winConditionMet: 'turnLimitExceeded' };
  }

  const result = getResult(state, registry);

  // Comeback detection
  let isComebackWin = false;
  if (result && result.winner !== null && scoreHistory.length > 5) {
    const winner = result.winner;
    const threshold = config.comebackThreshold;
    for (let i = 5; i < scoreHistory.length; i++) {
      const [s0, s1] = scoreHistory[i];
      const total = s0 + s1;
      if (total === 0) continue;
      const winnerScore = winner === 0 ? s0 : s1;
      const loserScore = winner === 0 ? s1 : s0;
      if (loserScore > 0 && (loserScore - winnerScore) / loserScore >= threshold) {
        isComebackWin = true;
        break;
      }
    }
  }

  return {
    seed,
    winner: result?.winner ?? null,
    winCondition: result?.winCondition || 'unknown',
    gameLength: state.turn,
    p0UnitsBuilt,
    p1UnitsBuilt,
    p0Faction: factions[0],
    p1Faction: factions[1],
    unitBuilds,
    leadChanges,
    isComebackWin,
  };
}

// ── Main ──
function main() {
  const registry = buildRegistry();
  const config: GameConfig = { ...defaultConfig, fogOfWar: false };
  const factionIds = Object.keys(registry.factions);
  const f0 = factionIds[0] || 'ironclad';
  const f1 = factionIds[1] || 'sylvan';

  console.log(`\n=== TACTICA SIMULATION ===`);
  console.log(`Games: ${numGames} | Bot A: ${botAType} | Bot B: ${botBType} | Seed: ${baseSeed}`);
  console.log(`Factions: ${f0} vs ${f1} (mirrored)\n`);

  const records: GameRecord[] = [];
  const halfGames = Math.floor(numGames / 2);

  // Run half with normal assignment, half mirrored
  for (let i = 0; i < numGames; i++) {
    const seed = baseSeed + i;
    const mirrored = i >= halfGames;
    const factions: [string, string] = mirrored ? [f1, f0] : [f0, f1];
    const botA = createBot(mirrored ? botBType : botAType, seed * 100);
    const botB = createBot(mirrored ? botAType : botBType, seed * 100 + 1);

    const record = runSingleGame(config, registry, factions, seed, botA, botB);
    records.push(record);

    if ((i + 1) % 50 === 0 || i === numGames - 1) {
      console.log(`  Progress: ${i + 1}/${numGames}`);
    }
  }

  // ── Compute metrics ──
  const summary = computeSummary(records, f0, f1, config);

  // ── Output ──
  fs.mkdirSync(outDir, { recursive: true });

  // Summary JSON
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  // CSV
  const csvHeader = 'seed,winner,winCondition,gameLength,p0UnitsBuilt,p1UnitsBuilt,p0Faction,p1Faction,leadChanges,isComebackWin\n';
  const csvRows = records.map(r =>
    `${r.seed},${r.winner ?? 'draw'},${r.winCondition},${r.gameLength},${r.p0UnitsBuilt},${r.p1UnitsBuilt},${r.p0Faction},${r.p1Faction},${r.leadChanges},${r.isComebackWin}`
  ).join('\n');
  fs.writeFileSync(path.join(outDir, 'games.csv'), csvHeader + csvRows);

  // Console report
  printReport(summary);

  console.log(`\nResults written to ${outDir}/`);
}

interface Summary {
  totalGames: number;
  playerSlotWins: { slot0: number; slot1: number; draws: number };
  factionWins: Record<string, number>;
  firstMoverAdvantage: { slot0WinRate: number };
  gameLength: { min: number; median: number; p90: number; max: number };
  comebackRate: number;
  avgLeadChanges: number;
  winConditionDistribution: Record<string, number>;
  unitUsage: Record<string, { built: number; buildRate: number }>;
  flags: string[];
}

function computeSummary(records: GameRecord[], f0: string, f1: string, config: GameConfig): Summary {
  const total = records.length;
  let slot0Wins = 0, slot1Wins = 0, draws = 0;
  const factionWins: Record<string, number> = { [f0]: 0, [f1]: 0 };
  const winCondDist: Record<string, number> = {};
  const unitBuilds: Record<string, number> = {};
  let comebackWins = 0;
  let totalLeadChanges = 0;
  const gameLengths: number[] = [];

  for (const r of records) {
    if (r.winner === 0) slot0Wins++;
    else if (r.winner === 1) slot1Wins++;
    else draws++;

    if (r.winner !== null) {
      const winnerFaction = r.winner === 0 ? r.p0Faction : r.p1Faction;
      factionWins[winnerFaction] = (factionWins[winnerFaction] || 0) + 1;
    }

    winCondDist[r.winCondition] = (winCondDist[r.winCondition] || 0) + 1;
    gameLengths.push(r.gameLength);

    if (r.isComebackWin) comebackWins++;
    totalLeadChanges += r.leadChanges;

    for (const [key, count] of Object.entries(r.unitBuilds)) {
      unitBuilds[key] = (unitBuilds[key] || 0) + count;
    }
  }

  gameLengths.sort((a, b) => a - b);
  const median = gameLengths[Math.floor(gameLengths.length / 2)];
  const p90 = gameLengths[Math.floor(gameLengths.length * 0.9)];

  const unitUsage: Record<string, { built: number; buildRate: number }> = {};
  const flags: string[] = [];

  // Count per-game builds for build rate
  const unitGameCounts: Record<string, number> = {};
  for (const r of records) {
    const seen = new Set<string>();
    for (const key of Object.keys(r.unitBuilds)) {
      if (!seen.has(key)) {
        unitGameCounts[key] = (unitGameCounts[key] || 0) + 1;
        seen.add(key);
      }
    }
  }

  for (const [key, count] of Object.entries(unitBuilds)) {
    const gameCount = unitGameCounts[key] || 0;
    const buildRate = gameCount / total;
    unitUsage[key] = { built: count, buildRate };
    if (buildRate < 0.05) flags.push(`${key}: built in <5% of games (dead weight)`);
    if (buildRate > 0.60) flags.push(`${key}: built in >${60}% of games (dominant)`);
  }

  return {
    totalGames: total,
    playerSlotWins: { slot0: slot0Wins, slot1: slot1Wins, draws },
    factionWins,
    firstMoverAdvantage: { slot0WinRate: slot0Wins / (slot0Wins + slot1Wins || 1) },
    gameLength: {
      min: gameLengths[0] || 0,
      median: median || 0,
      p90: p90 || 0,
      max: gameLengths[gameLengths.length - 1] || 0,
    },
    comebackRate: comebackWins / total,
    avgLeadChanges: totalLeadChanges / total,
    winConditionDistribution: winCondDist,
    unitUsage,
    flags,
  };
}

function printReport(s: Summary) {
  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║      SIMULATION SUMMARY          ║`);
  console.log(`╠══════════════════════════════════╣`);
  console.log(`║ Total Games:     ${String(s.totalGames).padStart(14)} ║`);
  console.log(`║ Slot 0 Wins:     ${String(s.playerSlotWins.slot0).padStart(14)} ║`);
  console.log(`║ Slot 1 Wins:     ${String(s.playerSlotWins.slot1).padStart(14)} ║`);
  console.log(`║ Draws:           ${String(s.playerSlotWins.draws).padStart(14)} ║`);
  console.log(`╠══════════════════════════════════╣`);
  console.log(`║ First-Mover Win%: ${(s.firstMoverAdvantage.slot0WinRate * 100).toFixed(1).padStart(13)}% ║`);
  console.log(`╠══════════════════════════════════╣`);

  for (const [fac, wins] of Object.entries(s.factionWins)) {
    console.log(`║ ${fac.padEnd(18)} ${String(wins).padStart(5)} wins     ║`);
  }

  console.log(`╠══════════════════════════════════╣`);
  console.log(`║ Game Length                      ║`);
  console.log(`║   Min:           ${String(s.gameLength.min).padStart(14)} ║`);
  console.log(`║   Median:        ${String(s.gameLength.median).padStart(14)} ║`);
  console.log(`║   P90:           ${String(s.gameLength.p90).padStart(14)} ║`);
  console.log(`║   Max:           ${String(s.gameLength.max).padStart(14)} ║`);
  console.log(`╠══════════════════════════════════╣`);
  console.log(`║ Comeback Rate:   ${(s.comebackRate * 100).toFixed(1).padStart(13)}% ║`);
  console.log(`║ Avg Lead Changes: ${s.avgLeadChanges.toFixed(1).padStart(13)} ║`);
  console.log(`╠══════════════════════════════════╣`);
  console.log(`║ Win Conditions:                  ║`);
  for (const [cond, count] of Object.entries(s.winConditionDistribution)) {
    console.log(`║   ${cond.padEnd(22)} ${String(count).padStart(5)} ║`);
  }
  console.log(`╠══════════════════════════════════╣`);
  console.log(`║ Unit Usage:                      ║`);
  for (const [key, data] of Object.entries(s.unitUsage)) {
    console.log(`║   ${key.padEnd(25)} ${(data.buildRate * 100).toFixed(0).padStart(3)}% ║`);
  }

  if (s.flags.length > 0) {
    console.log(`╠══════════════════════════════════╣`);
    console.log(`║ ⚠ Flags:                         ║`);
    for (const f of s.flags) {
      console.log(`║   ${f.substring(0, 30).padEnd(30)} ║`);
    }
  }

  console.log(`╚══════════════════════════════════╝`);
}

main();
