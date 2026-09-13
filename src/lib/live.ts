import { demoData } from './demo-data.ts';

/**
 * How many people are on a product page right now.
 *
 * Real presence, held in memory and nowhere else. A page says "I am here" every
 * forty-five seconds while its tab is visible, and a visit that stops saying so
 * drops out after ninety. Nothing is written to disk, nothing survives a
 * restart, and the token a browser sends is the ephemeral per-tab id that dies
 * when the tab closes — the count exists for as long as the people do.
 *
 * That matters because this is the number sites most often invent. A fabricated
 * "23 people are viewing this" is false urgency under the CCPA's 2023 dark
 * patterns guidelines, and it is trivially caught: open two tabs and compare.
 * This one is countable, which is the only reason it can be shown.
 */
const WINDOW_MS = 90_000;
const seen = new Map<string, Map<string, number>>();

/** Records a visit and returns what the page should say. */
export function here(slug: string, token: string): number {
  const now = Date.now();
  let page = seen.get(slug);
  if (!page) { page = new Map(); seen.set(slug, page); }
  page.set(token, now);

  for (const [t, at] of page) if (now - at > WINDOW_MS) page.delete(t);
  if (page.size === 0) seen.delete(slug);

  // Sweep the whole map occasionally so a shop with a thousand pieces does not
  // keep an entry per piece forever after one visit each.
  if (seen.size > 500) {
    for (const [s, p] of seen) {
      for (const [t, at] of p) if (now - at > WINDOW_MS) p.delete(t);
      if (p.size === 0) seen.delete(s);
    }
  }
  return page.size;
}

export function watching(slug: string): number {
  const page = seen.get(slug);
  if (!page) return 0;
  const now = Date.now();
  let live = 0;
  for (const at of page.values()) if (now - at <= WINDOW_MS) live++;
  return live;
}

/**
 * Below this the page says nothing.
 *
 * Two, not one: the one is you, and "1 person is looking at this" on a page you
 * are looking at is a shop telling you about yourself.
 */
export const LIVE_FLOOR = 2;

/* ------------------------------------------------------------------ demo -- */

/**
 * A stand-in while `npm run demo -- --seed` data is present, so the line can be
 * seen — and seen *moving* — before the shop has the traffic to produce it.
 *
 * Two properties make it behave like the real thing rather than like a widget:
 *
 *   - It is a **slow walk around a fixed base**, not a fresh random number. A
 *     product sits near its own level and wanders a few either side, which is
 *     what a real page does; a number redrawn from scratch each time jumps from
 *     61 to 187 to 54 and gives itself away instantly.
 *   - It is derived from the clock, so **every viewer sees the same number at
 *     the same moment**. Two tabs disagreeing is the other tell, and the one
 *     people actually check.
 *
 * Guarded by the same flag as the rest of the demo data: the banner is on the
 * page and the server will not boot in production while any of it is here.
 */
const hash = (s: string, salt = 0) => {
  let h = salt >>> 0;
  for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return h;
};

/** How often the demo number moves. Short enough to see it while you watch. */
const DEMO_STEP_MS = 20_000;

export function demoWatching(slug: string): number {
  if (!demoData.present) return 0;

  // Where this piece sits. Stable, so a product does not swing between 51 and
  // 199 on consecutive loads. The range is the one that was asked for; note
  // that fifty concurrent viewers is a shop far busier than one with seven
  // reviews, and the real counter will report nothing like it.
  const base = 50 + (hash(slug) % 151);

  /*
   * Three overlapping steps of different lengths, summed. One step alone gives
   * a sawtooth that repeats visibly; three out of phase drift the way a real
   * count does — mostly still, occasionally a run in one direction.
   */
  const step = Math.floor(Date.now() / DEMO_STEP_MS);
  const wobble = (period: number, salt: number, amplitude: number) => {
    const n = hash(slug, Math.floor(step / period) + salt);
    return ((n % (amplitude * 2 + 1)) - amplitude);
  };
  const drift = wobble(1, 1, 3) + wobble(3, 2, 5) + wobble(11, 3, 9);

  return Math.max(LIVE_FLOOR, base + drift);
}

export const liveCount = (slug: string): number =>
  (demoData.present ? demoWatching(slug) : watching(slug));
