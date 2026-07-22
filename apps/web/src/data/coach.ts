// ── Coaching-loop data (UI-only) ──
// Records each move (human + AI) with a human-readable description, the AI's scored
// candidates ("why did you do this?"), and space for your annotations. Export dumps the
// annotated game so it becomes a corpus we translate into eval/rule changes.

import type { Action, GameState, DataRegistry } from '@tactica/engine';
import { coordLabel } from './notation.js';

export interface Candidate { desc: string; score: number; chosen: boolean }

export interface CoachEntry {
  seq: number;
  turn: number;
  player: number;
  actor: 'human' | 'ai';
  desc: string;
  candidates?: Candidate[];
  comment: string;
}

export interface StrategyNote { turn: number; player: number; text: string }

export interface CoachMeta { actor?: 'human' | 'ai'; candidates?: Candidate[] }

/** Human-readable one-liner for an action, using unit codes + chess coords. Uses the
 *  PRE-action state (so a move shows where the unit came from). */
export function describeAction(
  action: Action,
  state: GameState,
  labels: Record<number, string>,
  registry: DataRegistry,
): string {
  const code = (id: number) => labels[id] ?? `#${id}`;
  const at = (id: number) => {
    const u = state.units.find(x => x.id === id);
    return u ? `${code(id)} ${coordLabel(u.position.x, u.position.y)}` : code(id);
  };
  const unitAtTile = (x: number, y: number) => {
    const u = state.units.find(p => p.position.x === x && p.position.y === y);
    return u ? code(u.id) : '';
  };

  switch (action.type) {
    case 'move': {
      const u = state.units.find(x => x.id === action.unitId);
      const from = u ? coordLabel(u.position.x, u.position.y) : '?';
      const to = action.bumpReveal
        ? `${coordLabel(action.to.x, action.to.y)} (bump ${coordLabel(action.bumpReveal.x, action.bumpReveal.y)})`
        : coordLabel(action.to.x, action.to.y);
      return `${code(action.unitId)}  ${from} → ${to}`;
    }
    case 'attack': {
      const tgt = state.units.find(x => x.id === action.targetId);
      const tgtStr = tgt ? `${code(action.targetId)} ${coordLabel(tgt.position.x, tgt.position.y)}` : `#${action.targetId}`;
      return `${code(action.unitId)} attacks ${tgtStr}`;
    }
    case 'slash':
      return `${code(action.unitId)} slashes @ ${coordLabel(action.target.x, action.target.y)}`;
    case 'wyrmStrike':
      return `${code(action.unitId)} body-slams ${action.tiles.map(t => coordLabel(t.x, t.y)).join(' + ')}`;
    case 'useAbility':
      return `${code(action.unitId)} · ${action.abilityId} @ ${coordLabel(action.target.x, action.target.y)}`;
    case 'recruit':
      return `Recruit ${registry.unitTypes[action.unitTypeId]?.name ?? action.unitTypeId} @ ${coordLabel(action.cityPosition.x, action.cityPosition.y)}`;
    case 'research':
      return `Research ${registry.techs[action.techId]?.name ?? action.techId}`;
    case 'build':
      return `Build ${action.kind} @ ${coordLabel(action.position.x, action.position.y)}`;
    case 'upgradeBuilding':
      return `Upgrade REB @ ${coordLabel(action.position.x, action.position.y)}`;
    case 'foundCity': {
      const founder = unitAtTile(action.position.x, action.position.y);
      return `Found city @ ${coordLabel(action.position.x, action.position.y)}${founder ? ` (${founder})` : ''}`;
    }
    case 'captureCity':
      return `${at(action.unitId)} captures city`;
    case 'levelUpCity':
      return `City #${action.cityId} → level up (${action.choice})`;
    case 'expandTerritory':
      return `City #${action.cityId} → expand territory (${action.tiles.length} tiles)`;
    case 'endTurn':
      return `— end turn —`;
    default:
      return (action as { type: string }).type;
  }
}
