/**
 * The Moteeka drop, traced from the artwork in public/brand/moteeka-source.jpeg.
 *
 * The supplied logo is a 1600px raster. A raster is fine for Instagram and for
 * a share card, and wrong for a 30px header mark and a 16px browser tab — so
 * the silhouette was read back off the pixels and is kept here as geometry.
 * Two contours, filled even-odd: the drop, and the kite cut out of it.
 *
 * Traced at the source's own proportions — 203 x 566 px, normalised to a
 * 100 x 279 box — so nothing is restretched. Do not hand-edit the path data;
 * re-run scripts/trace-logo.ts against a new source instead.
 */

/** The drop's own box. Everything else is derived from these two numbers. */
export const DROP = { width: 100, height: 279 } as const;

export const DROP_OUTER = 'M56.44 0.00L56.44 0.99L55.45 1.98L54.95 4.94L51.49 12.84L50.99 15.31L50.00 16.79L48.51 21.23L48.51 22.72L47.52 24.69L47.52 26.17L45.54 32.59L45.05 37.04L44.55 37.53L44.55 40.00L44.06 40.49L44.06 42.96L43.07 46.42L43.07 50.37L42.57 50.86L42.57 57.78L42.08 58.27L42.08 79.01L42.57 79.50L42.57 87.40L43.07 87.90L43.56 98.27L44.06 98.76L44.55 107.16L45.05 107.65L45.05 111.11L45.54 111.60L45.54 115.06L46.04 115.55L47.03 125.43L44.06 125.92L43.07 126.91L43.07 130.86L42.57 131.35L42.57 133.33L41.58 135.80L40.59 141.72L37.62 150.61L36.14 153.08L34.65 157.52L27.72 170.86L6.93 201.97L3.47 209.37L1.49 215.30L0.99 219.25L0.50 219.74L0.50 222.21L0.00 222.71L0.00 235.05L0.50 235.55L0.50 238.01L0.99 238.51L1.49 242.46L3.96 249.37L8.91 257.77L14.36 264.19L18.32 267.64L28.22 274.06L32.67 276.04L39.60 278.01L47.03 279.00L52.48 279.00L60.89 278.01L70.79 274.56L74.75 272.58L82.18 267.15L90.10 258.75L91.09 256.28L94.06 252.33L98.51 240.98L99.01 237.52L99.50 237.03L99.50 234.06L100.00 233.57L100.00 220.73L99.50 220.24L99.50 217.27L99.01 216.78L99.01 214.81L98.02 212.34L97.03 206.41L90.59 188.63L89.11 186.16L88.61 184.19L87.62 183.20L86.14 178.26L82.18 170.86L82.18 169.87L78.22 161.47L78.22 160.49L73.76 151.10L71.78 144.68L68.81 138.76L67.82 134.32L64.36 126.41L63.37 122.46L62.38 120.98L61.39 116.04L59.41 111.11L59.41 109.62L58.42 108.14L57.92 104.69L56.93 103.21L55.94 97.28L52.97 86.91L52.97 84.44L51.98 81.97L50.99 73.58L50.50 73.08L50.00 62.71L49.50 62.22L49.50 56.29L49.01 55.80L49.01 43.45L49.50 42.96L49.50 37.04L50.00 36.54L50.50 26.67L50.99 26.17L51.49 21.23L51.98 20.74L52.48 16.30L54.46 9.88L54.46 8.39L55.45 6.91L55.94 3.95L56.93 1.98L56.44 0.99L56.93 0.49L56.44 0.00Z';

export const DROP_HOLE = 'M44.55 125.92L45.05 126.41L45.05 130.36L45.54 130.86L45.54 134.32L46.04 134.81L46.04 137.77L46.53 138.27L46.53 142.71L47.03 143.20L47.03 147.65L47.52 148.14L46.53 161.47L45.05 165.92L44.55 170.86L42.57 176.78L42.08 180.24L41.09 182.21L41.09 183.70L38.61 190.12L38.61 191.60L36.63 196.53L36.63 198.02L35.64 199.50L33.66 206.41L32.67 207.89L32.18 210.85L31.19 212.34L28.22 221.72L26.73 224.19L26.24 227.64L30.20 233.08L31.19 235.55L35.64 241.47L38.12 246.41L43.07 253.32L45.05 257.27L47.52 260.24L50.00 264.68L50.50 264.68L60.40 247.89L71.78 230.61L74.26 227.64L74.26 226.16L71.78 220.73L70.79 216.78L69.80 215.30L68.32 209.87L67.33 208.39L66.83 205.42L65.84 203.94L61.88 192.09L61.88 190.61L56.44 173.82L54.46 164.44L53.47 162.46L52.97 158.02L50.99 151.10L50.99 149.13L50.50 148.64L50.50 146.66L49.50 144.19L48.02 132.83L47.52 132.34L47.52 129.38L46.53 125.92Z';

/**
 * The metal, sampled down the original: warm gold in the tail, cooling to
 * silver at the bowl. The gradient runs slightly off-vertical because the
 * highlight in the artwork falls down the left of the blade, not the middle.
 */
export const METAL = [
  ['0', '#f8e9b4'], ['.14', '#faf0d7'], ['.38', '#edeae4'],
  ['.58', '#d5d0cb'], ['.82', '#a09995'], ['1', '#9a9491'],
] as const;

/**
 * The same drop for a pale ground. Silver on cream is very nearly invisible,
 * so on the light theme the metal reads as a dark one — warm brass in the
 * tail cooling to ink — which keeps the direction the original has.
 */
export const METAL_INK = [
  ['0', '#8a6a24'], ['.18', '#5d564d'], ['.55', '#33302b'], ['1', '#221f1b'],
] as const;

/** A gradient's stops: offset and colour, in order. */
export type Stops = readonly (readonly [string, string])[];

export function dropGradient(id: string, stops: Stops = METAL): string {
  const s = stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0.25" y2="1">${s}</linearGradient>`;
}

/**
 * The drop at a given height, its top-left corner at (x, y).
 *
 * Placed with a nested <svg> rather than a transform. `qlmanage`, which
 * rasterises these, silently ignores a `scale()` inside a translated group —
 * a browser applies it, so the bug only shows up in the generated PNGs and
 * not in anything you can see while authoring.
 */
export function drop(id: string, x: number, y: number, height: number): string {
  const w = dropWidth(height);
  return `<svg x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(height)}" `
    + `viewBox="0 0 ${DROP.width} ${DROP.height}" overflow="visible">`
    + `<path fill="url(#${id})" fill-rule="evenodd" d="${DROP_OUTER} ${DROP_HOLE}"/></svg>`;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** What the drop measures across, once scaled to that height. */
export const dropWidth = (height: number) => (height / DROP.height) * DROP.width;

/**
 * The wordmark. Cormorant matches the supplied artwork closely — the splayed
 * M, the circular high-contrast O, the flared T — and is on Google Fonts, so
 * the header can set live text rather than ship a picture of a word.
 */
export const WORDMARK_FONT = "Cormorant, 'Cormorant Garamond', Didot, Georgia, serif";

/**
 * Caps, tracked wide — the artwork sets about 0.17em between letters.
 *
 * Pass `width` and the text is pinned to exactly that many units with
 * `textLength`. That is not a nicety: these assets are rasterised by
 * `qlmanage`, which has no webfont, so the wordmark sets in whatever serif
 * the machine falls back to and an estimated width is wrong by enough to run
 * the name off the edge of a share card. Pinning it makes the layout
 * independent of which font actually renders.
 */
export function wordmark(x: number, baseline: number, size: number, fill: string, opts: {
  tracking?: number; anchor?: 'start' | 'middle'; weight?: number; width?: number;
} = {}): string {
  const tracking = opts.tracking ?? size * 0.17;
  const fit = opts.width === undefined ? ''
    : ` textLength="${Math.round(opts.width * 100) / 100}" lengthAdjust="spacing"`;
  return `<text x="${x}" y="${baseline}" font-family="${WORDMARK_FONT}" `
    + `font-size="${size}" font-weight="${opts.weight ?? 400}" letter-spacing="${tracking}" `
    + `fill="${fill}"${opts.anchor === 'middle' ? ' text-anchor="middle"' : ''}${fit}>MOTEEKA</text>`;
}

/** Roughly how wide that sets. Cormorant caps average about 0.70em. */
export const wordmarkWidth = (size: number, tracking = size * 0.17) =>
  'MOTEEKA'.length * size * 0.70 + ('MOTEEKA'.length - 1) * tracking;
