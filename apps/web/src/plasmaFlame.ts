// The plasma resource is shown as a single-colour flame everywhere it appears
// (top bar, economy breakdown, unit/recruit costs, tech costs, map labels, canvas
// build hints). ONE red, ONE path — shared by the React <PlasmaIcon/> and the
// canvas draw helper so they can never drift apart.
//
// Tune the plasma colour here and it changes everywhere at once.
export const PLASMA_RED = '#ff4a2a';

// A simple, single-path flame (viewBox 0 0 24 24). Filled with PLASMA_RED.
export const FLAME_PATH =
  'M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z';

// Canvas: the same flame rasterised from an inline SVG so ctx.drawImage can paint
// it in the action-box cost hints. Preloaded once at module load.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${PLASMA_RED}"><path d="${FLAME_PATH}"/></svg>`;
export const plasmaFlameImage: HTMLImageElement | null =
  typeof Image !== 'undefined'
    ? Object.assign(new Image(), { src: `data:image/svg+xml,${encodeURIComponent(svg)}` })
    : null;

/** Draw the plasma flame centred at (cx, cy) at the given pixel size (no-op until loaded). */
export function drawPlasmaFlame(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const img = plasmaFlameImage;
  if (img && img.complete && img.naturalWidth) {
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  }
}
