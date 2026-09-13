import { join } from 'node:path';
import { ROOT, config } from '../config.ts';
import { JsonStore } from './json-store.ts';

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
      this.db = new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.FIRESTORE_PROJECT_ID,
        ignoreUndefinedProperties: true,
      });
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
