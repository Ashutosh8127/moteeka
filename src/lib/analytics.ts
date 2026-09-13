import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config } from '../config.ts';
import { JsonStore } from './json-store.ts';

/**
 * First-party analytics: what each page and each product actually does.
 *
 * The Meta Pixel answers "did the ad work" and only while an ad is running.
 * This answers "which pieces do people open, which ones do they put in a cart,
 * and which ones does nobody touch" — the question you have every day, and the
 * one you cannot ask a third party without sending them your customers.
 *
 * **Counters, not a log.** Nothing here records who did anything. There is no
 * event table, no session id on disk, no IP address, no user-agent string and
 * no cookie; a day is a set of numbers that cannot be taken apart into people.
 * That is a design choice, not an oversight: an event log would be personal
 * data under the DPDP Act 2023 the moment it became re-identifiable, and it is
 * not worth holding for the sake of a dashboard.
 *
 * **Money is never client-reported.** `orders`, `units` and `revenue` are
 * written by the order route when an order is actually created. A browser can
 * claim a view; it cannot claim a sale.
 */

/** One product's funnel for one day. */
export interface ProductDay {
  /** Product pages opened. */
  views: number;
  /** Colourways clicked — a signal of interest the view count misses. */
  variants: number;
  /** Added to a cart. */
  adds: number;
  /** Present in a cart that reached checkout. */
  checkouts: number;
  /** Orders containing this piece — written server-side. */
  orders: number;
  units: number;
  revenue: number;
}

export interface Day {
  date: string;
  /** Distinct visits, counted from the first event each one sends. */
  sessions: number;
  pages: Record<string, { views: number; entries: number }>;
  products: Record<string, ProductDay>;
  /** Referrer host only — never the full URL, which can carry a search query. */
  referrers: Record<string, number>;
  /** utm_source / utm_campaign, so an ad can be told from a post. */
  campaigns: Record<string, number>;
  /** What people typed into site search and whether it found anything. */
  searches: Record<string, { count: number; empty: number }>;
  devices: Record<string, number>;
}

export const emptyDay = (date: string): Day => ({
  date, sessions: 0, pages: {}, products: {}, referrers: {}, campaigns: {}, searches: {}, devices: {},
});

const emptyProduct = (): ProductDay =>
  ({ views: 0, variants: 0, adds: 0, checkouts: 0, orders: 0, units: 0, revenue: 0 });

/** The day a timestamp falls on, in the shop's timezone rather than UTC. */
export function dayKey(at: Date = new Date(), zone = config.timezone): string {
  // en-CA renders as YYYY-MM-DD, which is the only reason it is used here.
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(at);
}

/* ----------------------------------------------------------------- store -- */

export interface AnalyticsStore {
  day(date: string): Promise<Day>;
  update(date: string, fn: (d: Day) => Day): Promise<void>;
  /** Newest first. */
  recent(days: number): Promise<Day[]>;
}

/**
 * One file per day under data/analytics/. A day is a few kilobytes, a year is a
 * few hundred, and an old day is deleted by removing a file.
 */
export class JsonAnalytics implements AnalyticsStore {
  private dir = join(ROOT, 'data', 'analytics');
  private stores = new Map<string, JsonStore<Day>>();

  private store(date: string): JsonStore<Day> {
    let s = this.stores.get(date);
    if (!s) {
      s = new JsonStore<Day>(join(this.dir, `${date}.json`), () => emptyDay(date));
      this.stores.set(date, s);
    }
    return s;
  }

  /*
   * Reading a day that has no file must not create one. JsonStore seeds a
   * missing file on read, which is right for the catalogue and wrong here: a
   * thirty-day report would write thirty empty files, and `--prune` would then
   * have a year of blanks to clear. A day with no traffic is not a day with a
   * file full of zeroes.
   */
  async day(date: string) {
    const file = join(this.dir, `${date}.json`);
    if (!existsSync(file)) return emptyDay(date);
    return this.store(date).read();
  }

  async update(date: string, fn: (d: Day) => Day) {
    const next = fn(await this.day(date));
    this.store(date).write(next);
  }

  async recent(days: number) {
    const out: Day[] = [];
    for (let i = 0; i < days; i++) {
      const at = new Date(Date.now() - i * 86_400_000);
      out.push(await this.day(dayKey(at)));
    }
    return out;
  }
}

class FirestoreAnalytics implements AnalyticsStore {
  private db: unknown = null;
  private async collection() {
    if (!this.db) {
      const { Firestore } = await import('@google-cloud/firestore');
      this.db = new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.FIRESTORE_PROJECT_ID,
        ignoreUndefinedProperties: true,
      });
    }
    return (this.db as {
      collection: (n: string) => {
        doc: (id: string) => {
          get: () => Promise<{ exists: boolean; data: () => unknown }>;
          set: (v: unknown) => Promise<unknown>;
        };
      };
    }).collection('analytics');
  }

  async day(date: string) {
    const snap = await (await this.collection()).doc(date).get();
    return snap.exists ? { ...emptyDay(date), ...(snap.data() as Day) } : emptyDay(date);
  }

  /*
   * Read-modify-write, not a transaction. Two events landing in the same
   * millisecond can lose one increment, which for a view counter is a fair
   * trade against a transaction per page load. Money never comes through here.
   */
  async update(date: string, fn: (d: Day) => Day) {
    const current = await this.day(date);
    await (await this.collection()).doc(date).set(fn(current));
  }

  async recent(days: number) {
    const out: Day[] = [];
    for (let i = 0; i < days; i++) out.push(await this.day(dayKey(new Date(Date.now() - i * 86_400_000))));
    return out;
  }
}

let cached: AnalyticsStore | null = null;
export function analytics(): AnalyticsStore {
  if (!cached) {
    const driver = process.env.ANALYTICS_DRIVER ?? config.driver;
    cached = driver === 'firestore' ? new FirestoreAnalytics() : new JsonAnalytics();
  }
  return cached;
}

/* ---------------------------------------------------------------- record -- */

/** What a browser is allowed to say happened. Anything else is dropped. */
export const CLIENT_EVENTS = ['page', 'product', 'variant', 'add', 'checkout', 'search'] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

export interface Incoming {
  t: ClientEvent;
  /** Pathname only, and only one we serve. */
  path?: string;
  slug?: string;
  /** Referrer host, already stripped by the client; re-checked here. */
  ref?: string;
  utm?: string;
  device?: string;
  q?: string;
  /** True on the first event of a visit, which is how sessions are counted. */
  first?: boolean;
  /** True when a search returned nothing — the most useful search of all. */
  empty?: boolean;
}

const bump = <K extends string>(map: Record<K, number>, key: K, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

/**
 * The pages this shop has. Anything else becomes `/other` rather than its own
 * key: the same reasoning as checking slugs against the catalogue — a path
 * arrives from a browser, and a browser can send a thousand different ones.
 */
const PAGES = new Set(['/', '/index.html', '/product.html', '/checkout.html', '/privacy.html', '/contact.html']);
export const pageKey = (path: string) => (PAGES.has(path) ? (path === '/index.html' ? '/' : path) : '/other');

/**
 * Fold one batch of events into a day. Pure, so the route can validate and the
 * tests can check the arithmetic without touching a disk.
 */
export function fold(day: Day, events: Incoming[], knownSlug: (s: string) => boolean): Day {
  const d: Day = structuredClone(day);

  for (const e of events) {
    if (!CLIENT_EVENTS.includes(e.t)) continue;
    if (e.first) d.sessions++;

    if (e.device) bump(d.devices, e.device.slice(0, 12));
    if (e.ref) bump(d.referrers, e.ref.slice(0, 60));
    if (e.utm) bump(d.campaigns, e.utm.slice(0, 80));

    if (e.t === 'page' && e.path) {
      const page = (d.pages[pageKey(e.path)] ??= { views: 0, entries: 0 });
      page.views++;
      if (e.first) page.entries++;
    }

    if (e.t === 'search' && e.q) {
      const q = (d.searches[e.q.slice(0, 40).toLowerCase()] ??= { count: 0, empty: 0 });
      q.count++;
      if (e.empty) q.empty++;
    }

    // A slug that is not in the catalogue is junk or someone probing; either
    // way it does not get to create a key in the file.
    if (!e.slug || !knownSlug(e.slug)) continue;
    const p = (d.products[e.slug] ??= emptyProduct());
    if (e.t === 'product') p.views++;
    if (e.t === 'variant') p.variants++;
    if (e.t === 'add') p.adds++;
    if (e.t === 'checkout') p.checkouts++;
  }
  return d;
}

/** Called by the order route. The only path that may write money. */
export async function recordOrder(
  lines: Array<{ productId: string; quantity: number; unitPrice: number }>,
  slugOf: (productId: string) => string | undefined,
  at: Date = new Date(),
): Promise<void> {
  const date = dayKey(at);
  await analytics().update(date, (day) => {
    const d = structuredClone(day);
    for (const line of lines) {
      const slug = slugOf(line.productId);
      if (!slug) continue;
      const p = (d.products[slug] ??= emptyProduct());
      p.orders++;
      p.units += line.quantity;
      p.revenue += line.unitPrice * line.quantity;
    }
    return d;
  });
}

/* ------------------------------------------------------ social proof -- */

/**
 * How many times each piece was actually opened in the last few days.
 *
 * This is the honest version of "23 people are looking at this right now". It
 * is a real count of real page views, which means it is small on a new shop and
 * says nothing at all until it is worth saying — the floor is in the route.
 *
 * A fabricated number here would be false urgency, which the CCPA's 2023 dark
 * patterns guidelines prohibit outright and the Consumer Protection Act 2019
 * penalises. It would also be untrue, which is the shorter reason.
 */
let viewCache: { at: number; days: number; counts: Map<string, number> } | null = null;

export async function recentViews(days = 7): Promise<Map<string, number>> {
  // Recomputed at most once a minute: a product page asks for this on every
  // load, and the answer changes by one view at a time.
  if (viewCache && viewCache.days === days && Date.now() - viewCache.at < 60_000) {
    return viewCache.counts;
  }
  const counts = new Map<string, number>();
  for (const day of await analytics().recent(days)) {
    for (const [slug, p] of Object.entries(day.products ?? {})) {
      counts.set(slug, (counts.get(slug) ?? 0) + p.views);
    }
  }
  viewCache = { at: Date.now(), days, counts };
  return counts;
}

/* --------------------------------------------------------------- reading -- */

export interface ProductTotals extends ProductDay {
  slug: string;
  /** Any signal at all, so a report can tell "untouched" from "looked at". */
  touched: number;
  /** Adds per hundred views — the number that says whether a page works. */
  addRate: number;
  /** Orders per hundred views. */
  buyRate: number;
}

const rate = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 1000) / 10);

/** Roll a run of days into one set of totals. */
export function totals(days: Day[]): {
  sessions: number;
  pages: Array<{ path: string; views: number; entries: number }>;
  products: ProductTotals[];
  referrers: Array<{ host: string; visits: number }>;
  campaigns: Array<{ utm: string; visits: number }>;
  searches: Array<{ q: string; count: number; empty: number }>;
  devices: Record<string, number>;
  revenue: number;
} {
  const sum = emptyDay('all');
  for (const day of days) {
    sum.sessions += day.sessions;
    for (const [path, v] of Object.entries(day.pages ?? {})) {
      const p = (sum.pages[path] ??= { views: 0, entries: 0 });
      p.views += v.views; p.entries += v.entries;
    }
    for (const [slug, v] of Object.entries(day.products ?? {})) {
      const p = (sum.products[slug] ??= emptyProduct());
      for (const k of Object.keys(p) as Array<keyof ProductDay>) p[k] += v[k] ?? 0;
    }
    for (const [k, n] of Object.entries(day.referrers ?? {})) bump(sum.referrers, k, n);
    for (const [k, n] of Object.entries(day.campaigns ?? {})) bump(sum.campaigns, k, n);
    for (const [k, n] of Object.entries(day.devices ?? {})) bump(sum.devices, k, n);
    for (const [q, v] of Object.entries(day.searches ?? {})) {
      const s = (sum.searches[q] ??= { count: 0, empty: 0 });
      s.count += v.count; s.empty += v.empty;
    }
  }

  return {
    sessions: sum.sessions,
    pages: Object.entries(sum.pages).map(([path, v]) => ({ path, ...v }))
      .sort((a, b) => b.views - a.views),
    products: Object.entries(sum.products).map(([slug, v]) => ({
      slug, ...v,
      touched: v.views + v.variants + v.adds + v.checkouts + v.orders,
      addRate: rate(v.adds, v.views), buyRate: rate(v.orders, v.views),
    })).sort((a, b) => b.views - a.views || b.touched - a.touched),
    referrers: Object.entries(sum.referrers).map(([host, visits]) => ({ host, visits }))
      .sort((a, b) => b.visits - a.visits),
    campaigns: Object.entries(sum.campaigns).map(([utm, visits]) => ({ utm, visits }))
      .sort((a, b) => b.visits - a.visits),
    searches: Object.entries(sum.searches).map(([q, v]) => ({ q, ...v }))
      .sort((a, b) => b.count - a.count),
    devices: sum.devices,
    revenue: Object.values(sum.products).reduce((a, p) => a + p.revenue, 0),
  };
}
