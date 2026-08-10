# Odysseus — Patrick's Rigbound AI

*"A bot beating a bot is somewhat useless if a human can come along and dominate it."*

Odysseus is Patrick's entry in a two-AI competition: Patrick and his brother are each
building an AI for Rigbound, to be pitted against each other (and against the humans).
This document is the charter for Odysseus — everything established in the design
discussions of 2026-08-07, recorded so the plan survives context loss and so the
competition has a paper trail.

---

## 1. The goal

A **very good AI to verse**: strong enough to beat its authors, discovered rather than
scripted, and **adaptable** — when the game's rules change (unit costs, tech tree, new
factions), it must not break; it relearns. The AI is a renewable resource attached to
the game, not a hand-built artifact that rots with every balance patch.

## 2. The decided approach: self-play RL, tribes-rl style

Template: [tribes-rl](https://github.com/pham-tuan-binh/tribes-rl) /
[tribes.binhph.am](https://tribes.binhph.am) — an open-source Polytopia rebuilt for RL.
It is the existence proof for exactly our game class (turn-based, tile map, fog of war,
cities, tech, 2–4 players): engine ported to C, PufferLib self-play training at ~1.8M
agent-steps/sec on ONE consumer GPU (10B steps ≈ 11M games in ~2 hours), an 8.2M-param
recurrent policy (MinGRU), and the trained model running **in the browser via WASM as a
fully static site** — no backend, which matches Rigbound's own no-backend rule.

The pipeline for Odysseus:

1. **Observation & action spec** — encode `VisibleState` as fixed-size tensors
   (tile planes + global state); actions as a masked SELECT → VERB → TARGET
   decomposition instead of one action id per (unit, target) pair.
2. **Golden-trace harness** — the TS sim dumps full action-by-action state traces for
   many seeds. These are ground truth. (Possible only because the engine is pure,
   deterministic, seeded-PRNG, JSON-state — Rigbound's founding rules pay off here.)
3. **Engine port to Rust or C** (open decision, §7) — verified byte-for-byte against
   the golden traces, system by system (movement → combat → economy → tech → fog).
   Compiles native for training and to WASM for the browser. **This is the long pole**;
   everything else is cheap by comparison.
4. **Self-play training with PufferLib** on a rented single-GPU box (RTX 4090/5090 on
   Vast.ai / RunPod, ~$0.30–0.90/hr). One full run ≈ $2–5. Project total across the
   inevitable 30–100 debug/tuning runs: a few hundred dollars, worst case.
5. **In-browser inference** (WASM/ONNX) — "vs Odysseus" in the web app, difficulty via
   temperature and checkpoint choice, still a static site.

### The one brutal number

The whole design is downstream of sample cost. "Very good" needs **~1–10 billion steps
(≈1–10 million games)** — reference points: tribes-rl 10B steps; AlphaZero ~44M games
(chess), ~21M (Go). Our TS engine at ~1 game/sec would take months per run; a native
port at tribes-rl-like speeds does it in an afternoon. **Compute is a rounding error;
engine speed is the entire project.** Once the fast engine exists the scarce resource
becomes iteration speed — run an experiment, watch the agent be dumb, diagnose,
relaunch — so per-run wall-clock is what we optimize.

## 3. What training actually is (the mental model)

The bot is a giant board of dials (millions of weights) mapping "what I see" → "how
much I feel like doing each legal action." Training is one dumb rule applied at scale:
**actions from won games get their dials nudged up; actions from lost games, down.**
No move is ever identified as the good one — spurious credit washes out statistically
over millions of games (a pointless move appears equally in wins and losses; the titan
push survives the statistics). Strategy assembles *backwards* from the reward:
first "army near their capital = good," then the things that cause that, then the
economy that funds those, until turn-2 choices carry faint echoes of the final
capture. The only instruction we author is **winning = good**, plus small, faded-out
early "treats" (reward shaping: crumbs for captures/exploration) kept deliberately
minimal so the meta stays the agent's discovery, not our bias.

Product of this: pure distilled instinct. No memory of any game, no notes, no names
for anything — and it can't explain a single move it makes.

## 4. Self-play pitfalls we've already accounted for

Established in discussion with Patrick's brother — his rut concern is a real,
documented failure mode, and the defenses are standard machinery now:

- **Self-play win rate is ALWAYS ~50% by definition** (the opponent is you). It carries
  zero information about absolute strength; a god and a toddler both go 50/50 against
  their own mirror. Progress is measured only on external yardsticks.
- **Evaluation ladder** (external yardsticks + league diversity in one): random →
  greedy → greedy + 1–2 ply lookahead over top-N candidates (fills the `mctsBot.ts`
  stub; ~a day of work when there's something to measure) → frozen past checkpoints.
- **Variance is the escape engine** (Patrick's evolution analogy): the policy is
  stochastic, exploration is explicitly bonused early, temperature is a dial. Random
  low-probability moves are the mutations; wins are the selection.
- **But variance alone doesn't prevent cycling/forgetting** (rush → wall → greed →
  rediscovered rush nobody remembers how to punish). Fix = **league play** (AlphaStar):
  train against the whole museum — frozen past checkpoints + scripted bots as strategy
  species — so the agent must beat everything that has *ever* worked, not just today's
  twin.
- **The human is the final exploiter agent.** Patrick versing checkpoints in the
  browser is part of the loop: find the hole, get the exploit represented in the next
  league. (The July coaching instinct returns here — except your games ARE the
  adversarial pressure, no weight hand-tuning needed.)
- Classic **alpha-beta pruning was considered and rejected** as a pipeline stage: it
  fits chess-shaped games, not fog + variable-length turn sequences (~50 options ×
  10–15 actions/turn), and it needs the hand-crafted eval function this whole approach
  exists to avoid. Search reappears only as (a) the ladder's lookahead rung and
  (b) an optional future MCTS-on-top-of-the-net upgrade.

## 5. Adaptability principles (design choices to make from day one)

1. **Describe units by stats, not names.** Observations say "40 HP, 4 atk, mv 1,
   costs 300," never "unit #17." Rebalances become familiar numbers with new values;
   one net plays both factions (self-play covers both seats); new factions are just
   training data.
2. **All content stays data.** The fast engine reads the same `/packages/data/json/`
   files as the TS engine. Rule change = edit JSON, rerun training, new AI overnight.
   A trained checkpoint is a snapshot of one ruleset — it doesn't survive patches, and
   it doesn't need to, because retraining costs hours and single-digit dollars.
3. **Domain randomization (stretch goal, config-flag cheap once the pipeline exists):**
   jitter costs/stats across training games to force "read the numbers and adapt" —
   the closest thing to a rule-agnostic AI that handles variations *without* retraining.
4. **Fog honesty is the observation boundary.** The net sees only `VisibleState` —
   which is why the 2026-08-07 fog seal (enemy ore/plasma/techs redacted, action log
   empty under fog) was the prerequisite step. The recurrent net's hidden state
   *learns* what to remember through fog — the "titan by turn 8 ⟹ they must have two
   bases" deduction becomes something it discovers. See "Round 2" below for the
   decided plan to also hand-compute these deductions as observation features.

### Round 2 training — the instrument panel (decided 2026-08-07)

You cannot *tell* the network anything — the only lever is what it sees. So the
human-style deductions ("titan by turn 8 ⟹ ≥2 bases ⟹ they couldn't afford much
else") are built in as **derived observation features**: deterministic code computes
the deduction, and the *result* is appended to the observation tensor. We install a
fuel gauge; the net stays the pilot and learns what to do with the reading.

**The belief calculator** (plain TS first, against `VisibleState` only — later twinned
in the fast engine and shipped in the browser so play-time instruments match training):

- Hard **lower bound on enemy total spend**: cost of every enemy unit ever seen +
  cheapest tech chain unlocking them.
- **Minimum income sources** implied by that spend over elapsed turns ("≥2 bases").
- **Upper bound on their unspent resources** — "they didn't have the option to build
  other units," as a number.
- **Feasible-base-location mask**: map-gen invariants (ruins never on edges, centres
  ≥3 apart, flat ground) minus every tile we've seen empty.

Properties that keep this clean: it's **fog-honest by construction** (reads only the
redacted view — deduces, never peeks); it's **exact and testable** (determinism makes
these hard bounds; sim asserts *the truth always satisfies the bounds* — a violated
bound is a calculator bug, the original belief-module killer test); and the net **can
ignore it** (useless features drift to zero weight — we offer evidence, not orders, so
instruments can't impose a meta, only speed up finding one).

**Sequencing: baseline first, instruments second.** Round 1 trains on raw observations
only; Round 2 adds the belief features and retrains. Cheap runs make this a real A/B
experiment ("how much stronger + how much faster-learning under fog?") instead of a
design argument. Prediction on record: modest gain in final strength, large gain in
learning speed, biggest effect on *scouting* — an agent that can read the deductions
has a reason to go collect the observations that sharpen them.

## 6. Side benefit: a balance-testing machine

Self-play will find and relentlessly abuse every degenerate strategy within hours —
it will locate the known Vanguard≫Hive imbalance (38:2), the free-city-founding
economics, and every future exploit faster than any playtester. Treat "the AI found
something gross" as a game-design finding, not a training bug.

## 7. Strategy mining, personality bots, and the edge plan (added 2026-08-07)

**How metas emerge:** nowhere and everywhere — a meta is an ecosystem equilibrium.
A winning strategy gets reinforced → becomes common → being common makes its counter
profitable → the population shifts (frequency-dependent selection, as in nature).
The meta is the current standings in that arms race.

**Strategy mining (decided):** every simulated game is a deterministic, replayable
trace, and we can generate millions. Pipeline: (a) extract per-game **fingerprints**
(tech timings, unit composition by turn, expansion count, first-attack turn,
army-distance-to-capital curve, banked-vs-spent ore); (b) **conditional win-rate
queries** over them — P(win | forge by turn 6 AND ≥2 titans by turn 20) — the
grown-up version of the sim's existing build-rate stats; (c) **clustering** the
fingerprints answers "what counts as a *distinct* strategy" precisely: a dense,
statistically separated cluster in behavior-space, discovered then christened by us;
(d) clustering across checkpoints charts the meta evolving (the arms race's fossil
record). Doubles as Rigbound's best balance telemetry: the query that finds Odysseus
a dominant strategy is the query that says what to nerf.

**Personality bots** (ascending elegance): checkpoint zoo (training eras ARE
personalities — ship the rush-era checkpoint as "the Aggressor"); reward-flavored
short runs (~$2–5 each: aggression bonus → "Warmonger", tech bonus → "Professor");
style-conditioned single net (a "style dial" in the observation varied with reward
flavor during training → one net, personality and difficulty as UI sliders).

**The loop:** mine clusters → distill into personality bots → put them in the league
→ Odysseus must beat every style → robustness. This is the competition edge plan.

**Edges over the brother's AI, ranked:**
1. **Search at play time** (the actual AlphaZero trick, absent from the base
   tribes-rl recipe): at each move, run quick lookaheads through the fast WASM engine
   with the net ranking candidates — over sampled feasible worlds under fog (the
   belief calculator supplies them). Same brain + thinking time beats same brain.
2. **Curriculum quality over algorithm novelty**: league diversity, observation/
   instrument design, disciplined eval ladder, restrained reward shaping.
3. **Iteration count**: runs cost dollars; the currency is diagnose-fix-relaunch
   cycles completed. Faster engine + better dashboards = more experiments = stronger.
4. **The human exploiter**: Patrick versing checkpoints and feeding holes back into
   the league is training signal the other side doesn't have.

## 8. Status & open items

| Step | Status |
|---|---|
| Fog seal (engine redaction, UnitSheet leak, sim `--fog`, tests) | **Done 2026-08-07** |
| Observation & action spec | Next |
| Golden-trace harness in TS sim | Next |
| Port language: **Rust vs C** | **Open decision.** Rust recommended for a rules surface this size (29 unit types, 45 techs, abilities/conditions/marks/nodes); C hews closest to the proven tribes-rl template. |
| TS engine perf pass (clone cost, O(n²) actionLog) | Still worth doing for sim/dev QoL; no longer on the training critical path |
| Engine port + PufferLib binding | Not started — the long pole |
| Training runs, league config, eval ladder | After port |
| Belief calculator (TS, `VisibleState`-only) + Round-2 instrumented training A/B | After Round-1 baseline; calculator can be written any time (doubles as spec for its fast-engine twin) |
| WASM/browser inference, "vs Odysseus" UI | After first strong checkpoint |

Known hazards for later: sim defaultConfig has a turn limit but the web default is
turnLimit 0 (off); greedy-vs-greedy mostly draws at the turn limit; `units.json`
contains unreachable legacy units with stale costs that would pollute stat-based
observations — scrub before encoding.

## 9. The competition

Two AIs, one game. This file is **Odysseus** (Patrick). The brother's AI is its
counterpart and eventual opponent. Terms, match format, and shared-infrastructure
rules (same engine? same compute budget? same training data access?) are not yet
agreed — to be recorded here when they are. What's already certain: both AIs benefit
from the same fast engine, and the first real league match is the two of them.
