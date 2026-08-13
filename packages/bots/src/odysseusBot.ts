import { GreedyBot, type GreedyWeights } from './greedyBot.js';

// ── Odysseus ──────────────────────────────────────────────────────────────────
// The handcrafted, weight-profile-driven AI ("cunning"). This is the growing home for
// the Odysseus design: a weighted evaluation over game features, later gaining a richer
// feature set, shallow search, strategy "modes" (weight profiles), guardrails and an
// opening book. v0 reuses the existing weighted greedy evaluator with its own "Normal"
// weight profile so the button is playable today; we expand it from here.
export const ODYSSEUS_NORMAL: GreedyWeights = {
  damageWeight: 8,
  killWeight: 22,
  captureWeight: 200, // taking a city is decisive
  foundWeight: 55,    // founding on a ruin — strong early tempo
  economyWeight: 28,  // REBs / level-ups / expansion
  incomeWeight: 7,
  safetyWeight: 8,
  exploreWeight: 3,
  advanceWeight: 3,
  researchWeight: 7,
};

export class OdysseusBot extends GreedyBot {
  name = 'Odysseus';
  constructor(seed: number = 20260810) {
    super(ODYSSEUS_NORMAL, seed);
  }
}
