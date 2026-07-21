import React from 'react';
import { useGameStore } from '../store/gameStore.js';

/**
 * Looping background music (RIGBOUND soundtrack), playing across the menu and
 * in-game screens. Browsers block autoplay before a user gesture, so playback
 * is attempted on mount and retried on the first pointer/key interaction.
 * Mute state lives in the store (toggled from the setup screen).
 */
export function MusicPlayer() {
  const musicMuted = useGameStore(s => s.musicMuted);
  const audioRef = React.useRef<HTMLAudioElement>(null);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let started = false;
    const tryPlay = () => {
      if (started) return;
      audio.play().then(() => {
        started = true;
        window.removeEventListener('pointerdown', tryPlay);
        window.removeEventListener('keydown', tryPlay);
      }).catch(() => { /* autoplay blocked — wait for a gesture */ });
    };
    tryPlay();
    window.addEventListener('pointerdown', tryPlay);
    window.addEventListener('keydown', tryPlay);
    return () => {
      window.removeEventListener('pointerdown', tryPlay);
      window.removeEventListener('keydown', tryPlay);
      audio.pause();
    };
  }, []);

  return (
    <audio
      ref={audioRef}
      src="/audio/rigbound-soundtrack.mp3"
      loop
      preload="auto"
      muted={musicMuted}
    />
  );
}
