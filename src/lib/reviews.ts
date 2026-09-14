import { join } from 'node:path';
import { ROOT, config } from '../config.ts';
import { JsonStore } from './json-store.ts';
import { firestoreOptions } from './firestore-options.ts';

/**
 * Ratings, from people who actually bought the piece.
 *
 * Every review here is tied to an order reference that contains the product,
 * and nothing appears on the storefront until it is approved in the admin
 * page. That is not fussiness — a fabricated rating is an unfair trade
 * practice under the Consumer Protection Act 2019, India has a published
 * standard for online reviews (IS 19000:2022) built on exactly this idea of
 * traceability, and Google delists rich results built on invented ones.
 *
 * The practical consequence is that a new shop shows no stars at all. That is
 * correct. Stars that appear before anybody has bought anything are not social
 * proof, they are decoration, and the first customer who reads five glowing
 * reviews of a piece with no orders behind it learns something about the shop
 * that no amount of design recovers from.
 */
export interface Review {
  id: string;
  /** Which piece. Slugs can change; this is re-pointed by the rename script. */
  slug: string;
  /** The order it came from. The whole basis for publishing it. */
  reference: string;
  /** 1 to 5. */
  rating: number;
  title?: string;
  body?: string;
  /** Display name only — never the email or phone from the order. */
  name: string;
  createdAt: string;
  /**
   * Nothing reaches the storefront on its own. `published` is a decision
   * somebody made in the admin page.
   */
  status: 'pending' | 'published' | 'rejected';
}

export interface Rating {
  average: number;
  count: number;
  /** How many of each star, for the bar chart on the product page. */
  spread: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface ReviewStore {
  all(): Promise<Review[]>;
  forProduct(slug: string): Promise<Review[]>;
  add(r: Review): Promise<void>;
  setStatus(id: string, status: Review['status']): Promise<Review | null>;
  /**
   * Follows a piece through a rename. Reviews are keyed by slug, so without
   * this a `--slug` change silently strands every rating a piece had earned —
   * the stars vanish from the page and nothing reports an error.
   */
  repoint(from: string, to: string): Promise<number>;
  /**
   * Every product's rating in a single stored object, or null if it has not
   * been built yet.
   *
   * The listing needs a star count per card. Deriving that from the reviews
   * themselves means a document read per review, and a shop with a few hundred
   * of them cannot pay it on a schedule — that is what exhausted the daily
   * quota and took the API down. A driver that can answer in one read should;
   * one that already has the reviews in memory need not bother.
   */
  summary?(): Promise<Record<string, Rating> | null>;
  saveSummary?(map: Record<string, Rating>): Promise<void>;
}

class JsonReviews implements ReviewStore {
  private store = new JsonStore<Review[]>(join(ROOT, 'data', 'reviews.json'), () => []);
  async all() { return [...this.store.read()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async forProduct(slug: string) { return (await this.all()).filter((r) => r.slug === slug); }
  async add(r: Review) { this.store.update((list) => [...list, r]); }
  async setStatus(id: string, status: Review['status']) {
    let hit: Review | null = null;
    this.store.update((list) => list.map((r) => {
      if (r.id !== id) return r;
      hit = { ...r, status };
      return hit;
    }));
    return hit;
  }
  async repoint(from: string, to: string) {
    let moved = 0;
    this.store.update((list) => list.map((r) => {
      if (r.slug !== from) return r;
      moved++;
      return { ...r, slug: to };
    }));
    return moved;
  }
}

class FirestoreReviews implements ReviewStore {
  private db: unknown = null;
  private async collection() {
    if (!this.db) {
      const { Firestore } = await import('@google-cloud/firestore');
      this.db = new Firestore(firestoreOptions());
    }
    return (this.db as {
      collection: (n: string) => {
        get: () => Promise<{ docs: Array<{ id: string; data: () => unknown; ref: { update: (v: unknown) => Promise<unknown> } }> }>;
        doc: (id: string) => {
          set: (v: unknown) => Promise<unknown>;
          get: () => Promise<{ exists: boolean; data: () => unknown }>;
          update: (v: unknown) => Promise<unknown>;
        };
        where: (f: string, op: string, v: unknown) => { get: () => Promise<{ docs: Array<{ data: () => unknown }> }> };
      };
    }).collection('reviews');
  }
  async all() {
    const snap = await (await this.collection()).get();
    return snap.docs.map((d) => d.data() as Review).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async forProduct(slug: string) {
    const snap = await (await this.collection()).where('slug', '==', slug).get();
    return snap.docs.map((d) => d.data() as Review);
  }
  async add(r: Review) { await (await this.collection()).doc(r.id).set(r); }

  /*
   * One document, in its own collection so no query over `reviews` can pick it
   * up. Reading it is a single billed read whatever the shop's review count;
   * it is rebuilt whenever a review is written, which is rare and already a
   * write.
   */
  private async summaryDoc() {
    const db = (await this.collection()) as unknown;
    void db;
    return (this.db as {
      collection: (n: string) => {
        doc: (id: string) => {
          get: () => Promise<{ exists: boolean; data: () => unknown }>;
          set: (v: unknown) => Promise<unknown>;
        };
      };
    }).collection('ratings').doc('summary');
  }

  async summary() {
    const snap = await (await this.summaryDoc()).get();
    if (!snap.exists) return null;
    const d = snap.data() as { bySlug?: Record<string, Rating> };
    return d?.bySlug ?? null;
  }

  async saveSummary(bySlug: Record<string, Rating>) {
    await (await this.summaryDoc()).set({ bySlug, updatedAt: new Date().toISOString() });
  }
  async setStatus(id: string, status: Review['status']) {
    const doc = (await this.collection()).doc(id);
    const snap = await doc.get();
    if (!snap.exists) return null;
    await doc.update({ status });
    return { ...(snap.data() as Review), status };
  }
  async repoint(from: string, to: string) {
    const snap = await (await this.collection()).where('slug', '==', from).get();
    const hits = snap.docs as unknown as Array<{ ref: { update: (v: unknown) => Promise<unknown> } }>;
    for (const d of hits) await d.ref.update({ slug: to });
    return hits.length;
  }
}

let cached: ReviewStore | null = null;
export function reviews(): ReviewStore {
  if (!cached) {
    const driver = process.env.REVIEWS_DRIVER ?? config.driver;
    cached = driver === 'firestore' ? new FirestoreReviews() : new JsonReviews();
  }
  return cached;
}

/**
 * Ratings for a whole listing, from one pass over the file.
 *
 * The grid asks for fifty-four of these at once; calling `forProduct` per card
 * would re-read and re-filter the same list fifty-four times.
 */
/*
 * The rating for every product, computed once a minute rather than once a
 * request.
 *
 * The catalogue listing needs a star count for each card, and the only way to
 * get one was to read the whole reviews collection. On Firestore that is a
 * document read per review, per request: with 226 reviews seeded, the free
 * tier's 50,000 daily reads bought about two hundred page loads before the
 * shop started answering RESOURCE_EXHAUSTED. Ratings move by one review at a
 * time, so a minute of staleness costs nothing and this is the same treatment
 * recentViews() already had.
 *
 * Per instance, not shared — a serverless host runs several and each keeps its
 * own. That is still the difference between 226 reads a request and 226 a
 * minute. The real fix is to keep a running count on the product document so
 * the listing needs no extra reads at all; this is the version that can ship
 * while the shop is down.
 */
/*
 * Five minutes, not one.
 *
 * With the catalogue cached, this read is the largest thing left: every fill
 * costs a document read per review, and a shop with a few hundred of them pays
 * that whole cost again each time the cache lapses. A star average built from
 * two hundred reviews does not visibly move in five minutes, and posting or
 * publishing one clears this anyway — so the only thing the extra staleness
 * buys anybody is a rounding difference nobody can see.
 *
 * The durable fix is to keep the count and the average on the product document
 * and update them when a review is published, which makes a listing cost no
 * review reads at all. This is the version that fits in the outage.
 */
const RATINGS_TTL_MS = Number(process.env.RATINGS_TTL_MS ?? 300_000);
let ratingsCache: { at: number; map: Map<string, Rating> } | null = null;

export async function allRatings(): Promise<Map<string, Rating>> {
  if (ratingsCache && Date.now() - ratingsCache.at < RATINGS_TTL_MS) return ratingsCache.map;

  const store = reviews();
  let map: Map<string, Rating> | null = null;

  /*
   * One read if the driver can do it. The stored object is derived data and
   * rebuilding it is cheap, so a missing one is not an error — it is built
   * here, saved, and every later request pays a single read for it.
   */
  if (store.summary) {
    try {
      const saved = await store.summary();
      if (saved) map = new Map(Object.entries(saved));
    } catch { /* fall through and compute it the expensive way */ }
  }

  if (!map) {
    map = ratingsBySlug(await store.all().catch(() => []));
    if (store.saveSummary) {
      // Not awaited into the caller's request: a page should not wait on a
      // cache being warmed, and a failure here costs one recompute later.
      void store.saveSummary(Object.fromEntries(map)).catch(() => {});
    }
  }

  ratingsCache = { at: Date.now(), map };
  return map;
}

/**
 * Rebuild the stored summary from the reviews. Called after a review is
 * written — rare, and already a write — so the listing never has to.
 */
export async function refreshRatings(): Promise<void> {
  const store = reviews();
  const map = ratingsBySlug(await store.all().catch(() => []));
  ratingsCache = { at: Date.now(), map };
  if (store.saveSummary) await store.saveSummary(Object.fromEntries(map)).catch(() => {});
}

/** Called after a review is written, so a new one is not hidden for a minute. */
export function forgetRatings(): void {
  ratingsCache = null;
}

export function ratingsBySlug(all: Review[]): Map<string, Rating> {
  const grouped = new Map<string, Review[]>();
  for (const r of all) {
    if (r.status !== 'published') continue;
    const list = grouped.get(r.slug);
    if (list) list.push(r);
    else grouped.set(r.slug, [r]);
  }
  const out = new Map<string, Rating>();
  for (const [slug, list] of grouped) {
    const rating = rate(list);
    if (rating) out.set(slug, rating);
  }
  return out;
}

/** Published reviews only — a pending one has not been read by anybody yet. */
export function rate(list: Review[]): Rating | null {
  const live = list.filter((r) => r.status === 'published');
  if (live.length === 0) return null;
  const spread = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Rating['spread'];
  let total = 0;
  for (const r of live) {
    const n = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    spread[n]++;
    total += n;
  }
  return {
    // One decimal. Two implies a precision eleven reviews do not have.
    average: Math.round((total / live.length) * 10) / 10,
    count: live.length,
    spread,
  };
}
