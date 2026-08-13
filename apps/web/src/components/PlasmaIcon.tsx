import React from 'react';
import { PLASMA_RED, FLAME_PATH } from '../plasmaFlame.js';

/** The plasma flame glyph — a single-colour (red) inline SVG, sized to sit inline with text. */
export function PlasmaIcon({ size = 12, color = PLASMA_RED, style }: { size?: number; color?: string; style?: React.CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-0.12em', ...style }}
    >
      <path d={FLAME_PATH} />
    </svg>
  );
}
