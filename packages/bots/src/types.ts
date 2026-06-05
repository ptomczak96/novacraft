import type { Action, VisibleState, DataRegistry } from '@tactica/engine';

export interface Bot {
  name: string;
  chooseAction(visibleState: VisibleState, registry: DataRegistry): Action;
}
