/**
 * voxel3d's own colour language — neon-noir arena. Deliberately independent of
 * the 2D iso renderer's palette.
 */
export const FLOOR_COLOR = '#151821';
export const BACKGROUND_COLOR = '#1a1538';
export const FOG_COLOR = '#241b4d';

export const GRID_LINE = '#2a3040';
export const GRID_LINE_BRIGHT = '#3d4a63';

export const RIM_BLOCK = '#1c212e';
export const NEON_CYAN = '#33f0ff';
export const NEON_PINK = '#ff2d95';

export const HIGHLIGHT_COLORS = {
  move: '#20ff9d',
  threat: '#ff3b30',
  select: '#33f0ff',
  path: '#ffd166',
} as const;

/** Team colours by player index — vivid, made to read against the dark floor. */
export const TEAM_COLORS = ['#33f0ff', '#ff2d95'] as const;

export const AMBIENT_COLOR = '#4a3a6b';
export const KEY_LIGHT_COLOR = '#cfd8ff';
export const CORNER_LIGHT_COLOR = '#ff2d95';
