import { useGameStore } from '../../store/gameStore.js';

/**
 * EvoUI interaction sounds (Click/Hover from the pack, vendored in public/ui).
 * Gated by the master audio mute in the store. Elements are created lazily and
 * cloned per play so rapid interactions overlap cleanly.
 */
const SOURCES = {
  click: '/ui/click.wav',
  hover: '/ui/hover.wav',
} as const;

const cache = new Map<string, HTMLAudioElement>();

export function playUi(kind: keyof typeof SOURCES, volume = 0.35): void {
  if (useGameStore.getState().musicMuted) return;
  let base = cache.get(kind);
  if (!base) {
    base = new Audio(SOURCES[kind]);
    base.preload = 'auto';
    cache.set(kind, base);
  }
  const node = base.cloneNode(true) as HTMLAudioElement;
  node.volume = volume;
  void node.play().catch(() => { /* pre-gesture autoplay block — ignore */ });
}
