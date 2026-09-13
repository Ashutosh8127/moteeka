/**
 * The Moteeka mark, as geometry rather than as a file.
 *
 * A jhumka: ear ring, dome, open rim, five-bead graduated fringe. It is the
 * piece the shop actually leads with, it is unmistakably Indian jewellery
 * rather than generic luxury, and — unlike the three beads it replaces — it has
 * a top and a bottom, so it cannot be read as a face.
 *
 * Two metals, because the catalogue sells two: the body is oxide-dark and the
 * fringe is brass. That is a real distinction on a real product, not a colour
 * chosen to look expensive.
 *
 * Everything is computed from one natural-size description and emitted as
 * absolute coordinates. Nothing is nested inside a `transform`, because
 * `qlmanage` — which rasterises these — silently ignores a `scale()` inside a
 * translated group, and a lockup that renders in a browser but not in the
 * share card is worse than no lockup.
 */

/** Natural half-extents about the mark's optical centre, in its own units. */
export const MARK = { halfWidth: 15.85, halfHeight: 17.7, unit: 35.4 } as const;

export interface Metal {
  /** The dome, the ear ring and the rim. */
  body: string;
  /** The fringe. */
  gold: string;
}

export const INK: Metal = { body: '#221f1b', gold: '#92702f' };
export const CREAM: Metal = { body: '#f2eee7', gold: '#c79a4a' };

const n = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The mark, centred on (cx, cy), `size` units tall overall.
 *
 * Strokes scale with the drawing. A mark whose line weight stays constant as it
 * grows looks like clip art at 1080px and like a smudge at 30px.
 */
export function jhumka(cx: number, cy: number, size: number, m: Metal = INK): string {
  const s = size / MARK.unit;
  const x = (v: number) => n(cx + v * s);
  const y = (v: number) => n(cy + v * s);
  const w = (v: number) => n(v * s);

  // The fringe, longest at the centre — which is how a real one hangs.
  const fringe = [
    { dx: 12.1, top: 9.64, wire: 11.85, bead: 13.30, r: 1.45 },
    { dx: 6.6, top: 10.77, wire: 14.15, bead: 15.85, r: 1.70 },
    { dx: 0, top: 11.15, wire: 15.35, bead: 17.25, r: 1.90 },
  ];
  const drops = fringe
    .flatMap((f) => (f.dx === 0 ? [0] : [-f.dx, f.dx]).map((dx) => ({ ...f, dx })))
    .map((f) =>
      `<path d="M${x(f.dx)} ${y(f.top)}V${y(f.wire)}" fill="none" stroke="${m.gold}" ` +
      `stroke-width="${w(1.2)}" stroke-linecap="round"/>` +
      `<circle cx="${x(f.dx)}" cy="${y(f.bead)}" r="${w(f.r)}" fill="${m.gold}"/>`)
    .join('');

  return [
    // The ear wire, closed — an open hook loses its shape below about 24px.
    `<circle cx="${x(0)}" cy="${y(-15.45)}" r="${w(3.7)}" fill="none" stroke="${m.body}" stroke-width="${w(1.6)}"/>`,
    `<path d="M${x(0)} ${y(-11.75)}V${y(-8.85)}" stroke="${m.body}" stroke-width="${w(1.6)}" stroke-linecap="round"/>`,
    `<path d="M${x(-15)} ${y(7.45)}C${x(-15)} ${y(-2.85)} ${x(-8.3)} ${y(-8.85)} ${x(0)} ${y(-8.85)}` +
    `C${x(8.3)} ${y(-8.85)} ${x(15)} ${y(-2.85)} ${x(15)} ${y(7.45)}" ` +
    `fill="none" stroke="${m.body}" stroke-width="${w(1.7)}" stroke-linejoin="round"/>`,
    `<ellipse cx="${x(0)}" cy="${y(7.45)}" rx="${w(15)}" ry="${w(3.7)}" fill="none" stroke="${m.body}" stroke-width="${w(1.5)}"/>`,
    drops,
  ].join('\n  ');
}

/**
 * The same piece as a filled silhouette, for the favicon and anywhere else
 * under about 32px. Outlines do not survive that — a 1.7-unit stroke on a
 * 16px icon is a third of a pixel — so below it the shape has to carry the
 * whole read, and the shape of a jhumka is a bell with beads under it.
 */
export function jhumkaSolid(cx: number, cy: number, size: number, fill: string, gold = fill): string {
  const s = size / MARK.unit;
  const x = (v: number) => n(cx + v * s);
  const y = (v: number) => n(cy + v * s);
  const w = (v: number) => n(v * s);
  return [
    `<circle cx="${x(0)}" cy="${y(-15.45)}" r="${w(3.6)}" fill="none" stroke="${fill}" stroke-width="${w(2.4)}"/>`,
    `<path d="M${x(0)} ${y(-12)}V${y(-8)}" stroke="${fill}" stroke-width="${w(2.4)}"/>`,
    `<path d="M${x(-14.2)} ${y(7.45)}C${x(-14.2)} ${y(-2.4)} ${x(-8)} ${y(-8.4)} ${x(0)} ${y(-8.4)}` +
    `C${x(8)} ${y(-8.4)} ${x(14.2)} ${y(-2.4)} ${x(14.2)} ${y(7.45)}Z" fill="${fill}"/>`,
    `<ellipse cx="${x(0)}" cy="${y(7.45)}" rx="${w(15)}" ry="${w(3.3)}" fill="${fill}"/>`,
    `<path d="M${x(-9.6)} ${y(10.2)}V${y(12.2)}M${x(0)} ${y(11)}V${y(14)}M${x(9.6)} ${y(10.2)}V${y(12.2)}" ` +
    `stroke="${gold}" stroke-width="${w(1.7)}" stroke-linecap="round"/>`,
    `<circle cx="${x(-9.6)}" cy="${y(13.9)}" r="${w(2.1)}" fill="${gold}"/>`,
    `<circle cx="${x(0)}" cy="${y(16)}" r="${w(2.5)}" fill="${gold}"/>`,
    `<circle cx="${x(9.6)}" cy="${y(13.9)}" r="${w(2.1)}" fill="${gold}"/>`,
  ].join('\n  ');
}

/**
 * The wordmark: caps, widely tracked, in the display face the site already
 * sets its headings in. Every jewellery house on the high street does exactly
 * this, and there is a reason — tracked caps read as a name rather than as a
 * word, which is what a brand is.
 *
 * Live text, not outlines, so it stays selectable and editable. Georgia is the
 * fallback; on a machine without Marcellus only you would notice.
 */
export function wordmark(x: number, baseline: number, size: number, fill: string, opts: {
  tracking?: number; anchor?: 'start' | 'middle';
} = {}): string {
  const tracking = opts.tracking ?? size * 0.18;
  return `<text x="${n(x)}" y="${n(baseline)}" font-family="Marcellus, Georgia, 'Times New Roman', serif" ` +
    `font-size="${n(size)}" letter-spacing="${n(tracking)}" fill="${fill}"` +
    `${opts.anchor === 'middle' ? ' text-anchor="middle"' : ''}>MOTEEKA</text>`;
}

/** Roughly how wide `wordmark` sets. Marcellus caps average about 0.66em. */
export function wordmarkWidth(size: number, tracking = size * 0.18): number {
  return 'MOTEEKA'.length * size * 0.66 + ('MOTEEKA'.length - 1) * tracking;
}
