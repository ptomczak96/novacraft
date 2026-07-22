# Rigbound — AI Opponent Notes

A concise record of the AI-bot discussion + decisions, to pick up in a few weeks.
(Deferred as of 2026-07-17 — parked to work on the game engine.)

---

## Where it stands now (what's already built)

- **Real GreedyBot is wired in** (web app + sim). It scores the engine's *real* legal-action
  list (found city / capture / build / level-up), so it now settles and expands. Beats the
  random bot ~97% (faction-neutralised); ends with ~7–8 cities/game.
  - Earlier bug: the web app ran a throwaway inline heuristic, and even the real bot generated
    a crippled action list that never included founding/capturing. Fixed.
- **Coaching loop** (in-game "Coach" panel, or "Train vs AI" on setup):
  - Move log (human + AI), each AI move expandable to its **scored candidates** ("why?").
  - Per-move comment boxes + a strategy-notes timeline.
  - Auto-saves to browser (`localStorage`) every move; Export button for a JSON file.
  - Coached bot turns **halt before ending** so you can inspect the board from the bot's POV
    and comment; you click "End Bot Turn" to advance.
- **Board notation** (for discussing positions): chess coords (A/B/C + 1/2/3 axis rulers, tile
  readout like `C4`) and stable 3-letter unit codes (`WA1`, `xVIN2`).
- **Sim** gained `--faction-a/--faction-b` for controlled bot comparisons.

---

## How the AI "thinks" — the mental models

**Greedy bot** = every step, score every possible move as a number, do the highest, then
forget and re-ask. No plan, no memory, no future. A goldfish that's great at "best move now."

**LLM** = reads the whole situation and reasons in sentences like a person ("I'm behind, pull
back and turtle"), then picks a fitting move.

**The key idea — a strategy is NOT one score.** It's a *bias spread across many small per-move
scores*, tuned so that "always pick the best move" adds up to the strategy. Like shaping a hill
so every water droplet flowing downhill ends up in the valley you want.

- A strategy = a **scoring table** (a set of weight adjustments).
  - e.g. "Turtle + rush Wyrm": economy-build +60, Wyrm research +100, move-toward-enemy −10,
    retreat-to-city +15, recruit-attacker −20, hoard-ore +.
  - "All-in aggression" = a different table (attack +huge, economy −, spend everything).
- Same greedy bot + a strategy table → the plan **emerges** over many turns.

**The "two brains" model (the real answer to strategic play):**
- **Strategic brain (slow, ~once per turn):** picks the GOAL → switches on a scoring table +
  sets a target ("300 ore + Wyrm researched"). Watches for the goal to complete and **flips**
  it (e.g. TURTLE → STRIKE). This flip is the "thinking style."
- **Tactical brain (fast, every move):** the greedy scorer, scoring each move by how well it
  serves the current goal's table. Executes move-by-move.
- "Saving up money" = the goal carries a target; progress toward it scores higher until met,
  then the goal advances. (Scoring *progress toward a destination*, not a move in a vacuum.)

The greedy bot can **execute** any strategy; it just can't **choose** one. The strategic brain
(rules, or an LLM, or you) is what chooses.

---

## The options ladder (effort → payoff)

1. **Heuristic / greedy (have it).** Fast, free, deterministic. One ply, no plan. → the goldfish.
2. **Structured-feedback auto-tuner (recommended, offline).** Quick tags on moves (too
   aggressive / wasted / should've founded) → auto-nudge the weights, re-sim to confirm. A real
   feedback loop where your input measurably improves the bot — via buttons, not prose.
3. **Search / lookahead (2–3 ply).** Simulate a few moves ahead so it stops walking into free
   kills. Cheap because `applyAction` is pure. `mctsBot.ts` is a stub for this.
4. **Two-brain (goals swap scoring tables).** Rule-based strategic brain first (turtle / expand
   / all-in / tech-rush), upgradeable to an LLM planner. Turns the goldfish into a planner.
5. **LLM-as-planner hybrid (recommended for "reasons in my words").** LLM is the *general* —
   reads state + your notes, sets the turn's plan (1 call/turn). Greedy bot is the *soldiers* —
   executes it (free, instant, tactically sharp).
6. **LLM-per-move (pure).** Cool demo, wrong default (see below).
7. **Self-play RL (AlphaZero-style).** Strongest, but learns only from win/loss (ignores your
   comments), produces "alien" play you can't steer with words, huge effort. Overkill here.

---

## Why LLM-per-move is slow/expensive (and other trade-offs)

**Slow/expensive per move because:**
- One model round-trip **per decision**, and a turn is 10–30 decisions → tens of seconds to
  minutes per turn (greedy does it in ~1ms).
- The model is stateless, so you **resend the whole board every move** = lots of input tokens
  each time, growing with map/unit count.
- "Thinking" = generated reasoning tokens each move (more cost + latency).
- **No amortization** — pays full price every move forever; self-play 1000 games = hundreds of
  thousands of calls (hours + real money) vs seconds + free for greedy.

**LLM cons beyond cost:** breaks determinism (no perfect replay / clean regression tests — a
real loss given the sim lab); can emit illegal/hallucinated moves (needs a guard that picks
from the legal list + greedy fallback); weak at precise tactics (search beats it at exact
capture math); external dependency (needs API/network; game is offline today); context limits.

**LLM pros:** reasons in your words; handles novelty; explains itself for free; iterate strategy
in English. → best used as the **strategic brain**, not the per-move executor.

---

## "Can it learn from my comments?"

Not autonomously with classic ML — RL learns from **win/loss**, not opinions. Free-text is hard
to consume mechanically. Realistic paths:
- **(a) Structured tags → auto-tune weights** (offline, buildable now). Closest thing to
  "the bot learns from me."
- **(b) LLM-in-the-loop** reads the annotated export and proposes concrete weight/rule changes
  to approve (≈ what we do manually now).
- **(c) LLM reads a growing "strategy doc"** distilled from your notes (the hybrid above).

---

## Decisions made
- Difficulty tiers: **decide later** — build the strong bot first, then degrade (lean on
  depth-reduction + eval-feature-gating, NOT random-move noise; random reads as "dumb", not
  "weaker").
- Coach annotations = a **corpus we translate** into eval changes; the bot does not auto-learn.
- Unit codes are curated 3-letter (`data/notation.ts`).

## Next steps when revisiting (rough order)
1. **Two-brain / goals** (rule-based strategic brain) — biggest jump in "feels like it has a plan".
2. **Structured-feedback auto-tuner** — close the loop from the coaching annotations.
3. **Sim metrics lab** — per-game metrics (economy curve, trade efficiency, idle units,
   un-founded ruins) + a v_new-vs-v_old regression harness + wastage "linters". Measure, don't
   watch all games; deterministic replay lets you drill only the flagged ones.
4. **2–3 ply search wrapper** (fill in `mctsBot.ts`) for tactical foresight.
5. **LLM-as-planner hybrid** for strategy-in-your-words.
6. **Difficulty ladder** — derive Easy/Normal/Hard by removing depth + knowledge from the top bot.

## Known issue surfaced
**Vanguard ≫ Hive** (38:2 in sim, regardless of bot) — a faction-balance problem that masks bot
skill. Worth a dedicated balance pass (separate from the AI work).
