import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config } from '../src/config.ts';
import { analytics, dayKey, totals, type Day } from '../src/lib/analytics.ts';
import { products as store } from '../src/lib/catalogue.ts';

/**
 * What the storefront did, read straight off the disk.
 *
 *   npm run stats                 # the last 30 days
 *   npm run stats -- --days 7
 *   npm run stats -- --prune      # delete counter files past the retention window
 *
 * The columns that matter are the last two. Views tell you what an ad or a post
 * sent; **add rate** tells you whether the page earned the click, and a piece
 * with a hundred views and no adds is a photograph problem, a price problem or
 * a description problem — not a traffic problem.
 */
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const value = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const days = Math.min(Math.max(Number(value('days') ?? 30), 1), 400);

if (flag('prune')) {
  const dir = join(ROOT, 'data', 'analytics');
  const cutoff = dayKey(new Date(Date.now() - config.analyticsRetentionDays * 86_400_000));
  let gone = 0;
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.json') && f.slice(0, 10) < cutoff) { rmSync(join(dir, f)); gone++; }
    }
  }
  console.log(`\n  ${gone} day(s) older than ${cutoff} removed\n`);
  process.exit(0);
}

const window: Day[] = await analytics().recent(days);
const t = totals(window);
const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const pct = (n: number) => (n ? `${n}%` : '—');

console.log(`\n  ${window.at(-1)?.date} to ${window[0]?.date}  ·  ${days} day(s)\n`);

if (t.sessions === 0 && t.pages.length === 0) {
  console.log(`  Nothing recorded yet.`);
  console.log(`  ${config.analytics ? 'Collection is on' : 'ANALYTICS=off — collection is disabled'}`);
  console.log(`  Open the storefront and this fills up: data/analytics/<date>.json\n`);
  process.exit(0);
}

const devices = Object.entries(t.devices).sort((a, b) => b[1] - a[1])
  .map(([k, n]) => `${n} ${k}`).join(', ');
console.log(`  ${t.sessions} visit(s)${devices ? `  ·  ${devices}` : ''}`);
if (t.revenue) console.log(`  ${inr(t.revenue)} ordered`);

/* ------------------------------------------------------------- products -- */

const known = new Map(store.all().map((p) => [p.slug, p]));
console.log(`\n  PIECES\n`);
console.log(`  ${'SLUG'.padEnd(36)}${'VIEWS'.padStart(6)}${'COLOUR'.padStart(8)}${'ADDS'.padStart(6)}` +
  `${'CART'.padStart(6)}${'ORDERS'.padStart(8)}${'ADD %'.padStart(8)}${'BUY %'.padStart(8)}`);

// A row of zeroes is not information. Anything with a single signal shows.
for (const p of t.products.filter((x) => x.touched > 0).slice(0, 25)) {
  console.log(
    `  ${p.slug.padEnd(36)}${String(p.views).padStart(6)}${String(p.variants).padStart(8)}` +
    `${String(p.adds).padStart(6)}${String(p.checkouts).padStart(6)}${String(p.orders).padStart(8)}` +
    `${pct(p.addRate).padStart(8)}${pct(p.buyRate).padStart(8)}`,
  );
}

/*
 * The most expensive line in the report. A piece nobody has opened is not
 * failing to sell — it is failing to be seen, which is a different fix.
 */
const seen = new Set(t.products.filter((p) => p.touched > 0).map((p) => p.slug));
const unseen = [...known.keys()].filter((s) => !seen.has(s) && known.get(s)!.status === 'active');
if (unseen.length) {
  console.log(`\n  ${unseen.length} live piece(s) nobody opened in ${days} days`);
  console.log(`    ${unseen.slice(0, 8).join(', ')}${unseen.length > 8 ? ', …' : ''}`);
}

const looked = t.products.filter((p) => p.views >= 5 && p.adds === 0);
if (looked.length) {
  console.log(`\n  ${looked.length} piece(s) opened 5+ times and never added to a cart`);
  console.log(`    ${looked.slice(0, 8).map((p) => `${p.slug} (${p.views})`).join(', ')}`);
}

/* ---------------------------------------------------------------- pages -- */

console.log(`\n  PAGES\n`);
console.log(`  ${'PATH'.padEnd(38)}${'VIEWS'.padStart(6)}${'ENTRIES'.padStart(9)}`);
for (const p of t.pages.slice(0, 12)) {
  console.log(`  ${p.path.padEnd(38)}${String(p.views).padStart(6)}${String(p.entries).padStart(9)}`);
}

/* ------------------------------------------------------------ where from -- */

if (t.referrers.length || t.campaigns.length) {
  console.log(`\n  CAME FROM\n`);
  for (const r of t.referrers.slice(0, 8)) console.log(`  ${r.host.padEnd(38)}${String(r.visits).padStart(6)}`);
  for (const c of t.campaigns.slice(0, 8)) console.log(`  ${c.utm.padEnd(38)}${String(c.visits).padStart(6)}  (utm)`);
}

/* --------------------------------------------------------------- search -- */

if (t.searches.length) {
  console.log(`\n  SEARCHED FOR\n`);
  for (const s of t.searches.slice(0, 12)) {
    console.log(`  ${s.q.padEnd(38)}${String(s.count).padStart(6)}${s.empty ? `   ${s.empty} found nothing` : ''}`);
  }
  const empty = t.searches.filter((s) => s.empty === s.count);
  if (empty.length) {
    console.log(`\n  ${empty.length} search term(s) never found anything: ${empty.slice(0, 6).map((s) => s.q).join(', ')}`);
    console.log(`  That is a list of what people came for and you do not stock.`);
  }
}

console.log(`\n  counters live in data/analytics/ — one file a day, no event log\n`);
