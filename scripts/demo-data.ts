import { existsSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from '../src/config.ts';
import { products as store } from '../src/lib/catalogue.ts';
import { dayKey, emptyDay, type Day } from '../src/lib/analytics.ts';
import { reviews, type Review } from '../src/lib/reviews.ts';

/**
 * Fabricated ratings and traffic, so the storefront can be *looked at* with
 * data in it. Every page that shows social proof renders nothing on a new shop,
 * which makes the design impossible to judge.
 *
 *   npm run demo -- --seed
 *   npm run demo -- --clear
 *
 * Three things keep this out of a customer's way, and they are the reason it
 * is a seeder rather than a random number in the page:
 *
 *   1. Every record is marked `demo: true`. `--clear` removes exactly those and
 *      leaves anything real untouched, so it is safe to run on a shop that has
 *      started taking orders.
 *   2. The server refuses to start in production while any of it is present.
 *   3. While it is present the storefront carries a banner saying so.
 *
 * A `Math.random()` in the product page would have none of those. It ships, it
 * cannot be turned off, and the first customer to open two tabs sees a
 * different number in each — which is both the CCPA's definition of false
 * urgency and an obvious lie.
 */
const argv = process.argv.slice(2);
const seed = argv.includes('--seed');
const clear = argv.includes('--clear');

if (!seed && !clear) {
  console.log(`\n  npm run demo -- --seed     fabricated ratings and traffic, for looking at`);
  console.log(`  npm run demo -- --clear    remove all of it\n`);
  process.exit(0);
}

const ANALYTICS = join(ROOT, 'data', 'analytics');

/* ---------------------------------------------------------------- clear -- */

if (clear) {
  const all = await reviews().all();
  const fake = all.filter((r) => (r as Review & { demo?: boolean }).demo);
  const real = all.filter((r) => !(r as Review & { demo?: boolean }).demo);
  writeFileSync(join(ROOT, 'data', 'reviews.json'), JSON.stringify(real, null, 2) + '\n');

  let days = 0;
  if (existsSync(ANALYTICS)) {
    for (const f of readdirSync(ANALYTICS)) {
      if (!f.endsWith('.json')) continue;
      const day = JSON.parse(await import('node:fs').then((m) => m.readFileSync(join(ANALYTICS, f), 'utf8')));
      if (day._demo) { rmSync(join(ANALYTICS, f)); days++; }
    }
  }
  console.log(`\n  removed ${fake.length} demo review(s) and ${days} demo day(s) of traffic`);
  console.log(`  ${real.length} real review(s) kept\n`);
  process.exit(0);
}

/* ----------------------------------------------------------------- seed -- */

const pieces = store.all().filter((p) => p.status === 'active');
if (pieces.length === 0) {
  console.error('\n  no active products to seed against\n');
  process.exit(1);
}

// A fixed sequence, so two runs produce the same shop and a screenshot taken
// yesterday still matches the page today.
let s = 20260913;
const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]!;

const NAMES = ['Priya', 'Aarti', 'Meera', 'Divya', 'Sneha', 'Kavya', 'Ritu', 'Anjali', 'Shreya',
  'Neha', 'Pooja', 'Ananya', 'Ishita', 'Radhika', 'Tanvi', 'Nisha', 'Swati', 'Lakshmi'];

const GOOD = [
  ['Exactly as pictured', 'Wore it to my cousin\'s sangeet and got asked where it was from twice. Lighter than it looks.'],
  ['Lovely finish', 'The oxidised work is deep and catches the light properly. Packed well too.'],
  ['Good for the price', 'Not real silver obviously, but the finish is far better than I expected at this price.'],
  ['Bought a second one', 'Got one for myself and one for my sister. Both perfect.'],
  ['Comfortable all evening', 'I usually get a headache from heavy jhumkas. Wore these for six hours, no problem.'],
  ['Photos do not do it justice', 'Bigger and prettier in person. The pearls are a nice touch.'],
];
const MIXED = [
  ['Nice, but took a while', 'The piece is lovely. Delivery took closer to three weeks so plan ahead if it is for an occasion.'],
  ['Pretty, slightly smaller', 'Beautiful work but a little smaller than I pictured from the photograph.'],
];
const POOR = [
  ['Not for me', 'The colour is more yellow than the photograph suggests. Quality is fine, just not what I wanted.'],
];

/*
 * A believable shape: mostly four and five, a few threes, the occasional one.
 * A shop where every rating is five stars is a shop nobody believes.
 */
function ratingFor(): number {
  const r = rnd();
  if (r < 0.58) return 5;
  if (r < 0.85) return 4;
  if (r < 0.94) return 3;
  if (r < 0.98) return 2;
  return 1;
}

const made: Review[] = [];
for (const p of pieces) {
  // Not every piece has reviews, which is also true of every real shop.
  if (rnd() < 0.25) continue;
  for (let i = 0; i < between(2, 14); i++) {
    const rating = ratingFor();
    const [title, body] = rating >= 4 ? pick(GOOD) : rating === 3 ? pick(MIXED) : pick(POOR);
    made.push({
      id: randomUUID(),
      slug: p.slug,
      reference: `OXJ-DEMO-${between(1000, 9999)}`,
      rating,
      title,
      body,
      name: pick(NAMES),
      createdAt: new Date(Date.now() - between(1, 120) * 86_400_000).toISOString(),
      status: 'published',
      demo: true,
    } as Review & { demo: true });
  }
}
for (const r of made) await reviews().add(r);

/* Traffic: enough that the "opened N times" line clears its floor of 15. */
mkdirSync(ANALYTICS, { recursive: true });
const DAYS = 30;
let views = 0;
for (let i = 0; i < DAYS; i++) {
  const date = dayKey(new Date(Date.now() - i * 86_400_000));
  const day = { ...emptyDay(date), _demo: true } as Day & { _demo: true };
  day.sessions = between(30, 90);
  day.devices = { phone: Math.round(day.sessions * 0.76), desktop: Math.round(day.sessions * 0.24) };
  day.pages['/'] = { views: day.sessions + between(5, 25), entries: Math.round(day.sessions * 0.7) };
  day.pages['/product.html'] = { views: between(60, 160), entries: Math.round(day.sessions * 0.2) };
  day.pages['/checkout.html'] = { views: between(2, 9), entries: 0 };
  day.referrers = { 'instagram.com': between(15, 45), 'google.com': between(3, 14) };
  day.campaigns = { 'instagram / bridal': between(8, 30) };
  for (const q of ['pearl', 'jhumka', 'kundan', 'polki']) {
    if (rnd() > 0.5) {
      const count = between(1, 4);
      day.searches[q] = { count, empty: q === 'kundan' || q === 'polki' ? count : 0 };
    }
  }
  for (const p of pieces) {
    if (rnd() < 0.4) continue;
    // Spread over 30 days this lands each piece in the 50-200 range for a week.
    const v = between(2, 9);
    views += v;
    day.products[p.slug] = {
      views: v, variants: between(0, v * 2), adds: rnd() > 0.75 ? between(1, 2) : 0,
      checkouts: rnd() > 0.9 ? 1 : 0, orders: 0, units: 0, revenue: 0,
    };
  }
  writeFileSync(join(ANALYTICS, `${date}.json`), JSON.stringify(day, null, 2) + '\n');
}

const withReviews = new Set(made.map((r) => r.slug)).size;
console.log(`\n  ${made.length} demo review(s) across ${withReviews} of ${pieces.length} pieces`);
console.log(`  ${DAYS} day(s) of demo traffic, ${views} product views`);
console.log(`\n  ALL OF IT IS FABRICATED.`);
console.log(`  The storefront carries a banner while it is here, and the server refuses`);
console.log(`  to start with NODE_ENV=production until you run:\n`);
console.log(`    npm run demo -- --clear\n`);
