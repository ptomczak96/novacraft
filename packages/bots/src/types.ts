import type { Action, VisibleState, DataRegistry } from '@tactica/engine';

export interface Bot {
  name: string;
  // `legalActions` (optional) should be the engine's real getLegalActions(...) output —
  // it includes foundCity/captureCity/build/etc. that a visible-state generator can't
  // reconstruct. Bots fall back to a limited internal generator when it's omitted.
  chooseAction(visibleState: VisibleState, registry: DataRegistry, legalActions?: Action[]): Action;
  // Optional: score a single action (no side effects). Heuristic bots expose this so a
  // coaching UI can show WHY each candidate ranked where it did. Search bots may omit it.
  scoreAction?(action: Action, visibleState: VisibleState, registry: DataRegistry): number;
}
