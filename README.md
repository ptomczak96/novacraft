# Tactica — Turn-Based Strategy Prototype

A rapid-iteration prototyping platform for a turn-based tactical strategy game. Cross between The Battle of Polytopia (4X-lite) and Into the Breach (deterministic tactical combat).

## Quick Start

```bash
npm install
npm run dev        # Launch web app at http://localhost:5173
npm test           # Run all tests
npm run validate-data  # Validate JSON game data
```

## Headless Simulation

```bash
npm run sim -- --games 1000 --bot-a greedy --bot-b greedy --seed 42 --out results/run-001
```

## How It Works

### For Designers (the two founders)

All balance tuning happens through data files, never code:

1. **In the web app:** Open the Editor Panel (top-right button) to edit unit stats, terrain properties, and combat config in real-time. Hit "Restart with new values" to test changes.

2. **Sharing experiments:** Use Export/Import in the Editor Panel to download your balance config as JSON and share it with your co-founder.

3. **Data files:** All game data lives in `/packages/data/json/`:
   - `units.json` — unit stats (cost, HP, attack, defence, movement, range, sight, abilities, traits)
   - `terrain.json` — terrain properties (movement cost, defence bonus, sight blocking, passability)
   - `tech-tree.json` — tech tree (cost, prerequisites, effects)
   - `factions.json` — faction definitions (which units each faction can build)
   - `config.json` — game config (map size, combat formula, economy, win conditions)
   - `bot-config.json` — bot heuristic weights

4. **Running simulations:** Use the CLI to run thousands of bot games and analyze balance:
   ```bash
   npm run sim -- --games 1000 --bot-a greedy --bot-b greedy --seed 42
   ```
   Output includes win rates, first-mover advantage, game length stats, comeback rates, and unit usage.

### Architecture

- **Engine** (`/packages/engine`) — Pure deterministic state machine. Zero browser dependencies.
- **Data** (`/packages/data`) — JSON game data + Zod validation schemas.
- **Bots** (`/packages/bots`) — AI players (RandomBot, GreedyBot).
- **Sim** (`/packages/sim`) — Headless simulation CLI.
- **Web** (`/apps/web`) — Vite + React prototype UI.

### Glossary

- **Turn** — One full round where both players act
- **Action** — A player's move: move unit, attack, recruit, research, end turn
- **Fog of War** — Tiles are hidden/explored/visible based on unit sight ranges
- **PRNG** — Seeded pseudo-random number generator (ensures deterministic replays)
- **Replay** — A saved game is just `{config, seed, actions[]}` — replaying = re-applying actions
