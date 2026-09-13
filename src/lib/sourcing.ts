import { join } from 'node:path';
import { ROOT, config } from '../config.ts';
import { JsonStore } from './json-store.ts';

/**
 * Private sourcing notes — where a piece comes from and who supplies it.
 *
 * Kept out of the catalogue on purpose. `data/sourcing.json` is gitignored and
 * no route reads it, so the storefront and the public API cannot reveal who you
 * buy from, however the data is queried.
 */
/** What the supplier calls one variant — what you quote when you reorder. */
export interface VariantSourcing {
  /** Their name for it, exactly as the listing had it: "FX916-2", "A-19". */
  supplierSku: string;
  /** Their internal SKU id from the listing payload, where there is one. */
  supplierSkuId?: string;
  /** Their price for this variant, at the quantity the import was priced at. */
  costPaise?: number;
  /** The whole cost stack, written by `npm run price`. */
  pricing?: VariantPricing;
}

/**
 * The full cost of one variant, in the order the money actually moves:
 * what you pay the supplier, what it costs to get here, what it costs to
 * reach the customer, what the returns cost, and what is left.
 *
 * Private, like everything else in this file. `final` is the only number that
 * reaches the catalogue — the rest would tell anyone reading the API exactly
 * what you pay and to whom.
 */
export interface VariantPricing {
  /** When this was computed, and against which order size and weight. */
  computedAt: string;
  orderQty: number;
  weightGrams: number;

  /** What the supplier charges. */
  purchase: number;
  /** Freight from the supplier to India, per piece. */
  shippingIn: number;
  insurance: number;
  /** Cost, insurance and freight — the value customs assesses. */
  customsValue: number;
  duty: number;
  surcharge: number;
  clearance: number;
  /** Everything above: what one piece costs to have in your hands. */
  landed: number;
  /** Paid at the border, credited against output GST. Funded, not spent. */
  igstCredit: number;

  /** Courier and packaging to the customer. */
  deliveryOut: number;
  /** What the parcels that come back cost, spread over the ones that stick. */
  returns: number;
  /** landed + deliveryOut + returns. */
  costToServe: number;

  /** Of the final price: GST collected and remitted. */
  gst: number;
  gateway: number;
  commission: number;
  /** What is left. */
  margin: number;
  marginPct: number;

  /** The price on the page, GST included. */
  final: number;
  /** True when someone set the price by hand instead of taking `final`. */
  manualOverride?: boolean;
}

export interface SourcingEntry {
  sourceUrl?: string;
  supplier?: string;
  supplierSku?: string;
  costPaise?: number;
  moq?: number;
  note?: string;
  /**
   * Your SKU → theirs. The catalogue SKU is yours and appears on the order;
   * this is how you turn one into a reorder line. Kept here rather than on the
   * product because it names the supplier by implication.
   */
  variants?: Record<string, VariantSourcing>;
}

/**
 * Where the private record lives.
 *
 * `data/sourcing.json` is right while the catalogue is authored on one laptop.
 * It is wrong the moment the shop runs somewhere with no real filesystem: it
 * changes every time you import, and a container that is replaced takes it
 * with it. So the same seam the catalogue has, for the same reason.
 *
 * `data/costs.json` and `data/business.json` deliberately do NOT get this.
 * They are configuration — you edit them, commit them, and ship them in the
 * image. Sourcing is data.
 */
export interface SourcingStore {
  get(productId: string): Promise<SourcingEntry | null>;
  set(productId: string, entry: SourcingEntry): Promise<void>;
  all(): Promise<Record<string, SourcingEntry>>;
}

class JsonSourcing implements SourcingStore {
  private store = new JsonStore<Record<string, SourcingEntry>>(
    join(ROOT, 'data', 'sourcing.json'), () => ({}),
  );
  async get(productId: string) { return this.store.read()[productId] ?? null; }
  async set(productId: string, entry: SourcingEntry) {
    this.store.update((all) => ({ ...all, [productId]: { ...all[productId], ...entry } }));
  }
  async all() { return this.store.read(); }
}

/**
 * One document per product in a `sourcing` collection.
 *
 * `firestore.rules` denies every client read, and no route touches this — the
 * scripts reach it with server credentials. That is the only thing standing
 * between a project id and a list of what you pay and to whom.
 */
class FirestoreSourcing implements SourcingStore {
  private db: { collection: (n: string) => never } | null = null;
  private async collection() {
    if (!this.db) {
      const { Firestore } = await import('@google-cloud/firestore');
      this.db = new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.FIRESTORE_PROJECT_ID,
        ignoreUndefinedProperties: true,
      }) as never;
    }
    return (this.db as unknown as {
      collection: (n: string) => {
        doc: (id: string) => { get: () => Promise<{ exists: boolean; data: () => unknown }>;
                               set: (v: unknown, o?: unknown) => Promise<unknown> };
        get: () => Promise<{ docs: Array<{ id: string; data: () => unknown }> }>;
      };
    }).collection('sourcing');
  }
  async get(productId: string) {
    const snap = await (await this.collection()).doc(productId).get();
    return snap.exists ? (snap.data() as SourcingEntry) : null;
  }
  async set(productId: string, entry: SourcingEntry) {
    await (await this.collection()).doc(productId).set(entry, { merge: true });
  }
  async all() {
    const snap = await (await this.collection()).get();
    return Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as SourcingEntry]));
  }
}

let store: SourcingStore | null = null;

/**
 * Defaults to whatever the catalogue is using, so one environment variable
 * moves both and they cannot end up in different places by accident.
 * `SOURCING_DRIVER` overrides it when you genuinely want them split.
 */
export function openSourcing(): SourcingStore {
  if (store) return store;
  const driver = process.env.SOURCING_DRIVER ?? config.driver;
  store = driver === 'firestore' ? new FirestoreSourcing() : new JsonSourcing();
  return store;
}

export function getSourcing(productId: string): Promise<SourcingEntry | null> {
  return openSourcing().get(productId);
}

export async function setSourcing(productId: string, entry: SourcingEntry): Promise<void> {
  await openSourcing().set(productId, entry);
}

export function allSourcing(): Promise<Record<string, SourcingEntry>> {
  return openSourcing().all();
}

/**
 * Re-key the reorder table when your SKUs change. A rename or a --resku must
 * not break the link to the supplier's part number — that link is the only
 * reason you can fulfil an order at all.
 */
export async function rekeySourcingVariants(
  productId: string, moves: Record<string, string>,
): Promise<number> {
  const entry = await getSourcing(productId);
  if (!entry?.variants) return 0;
  const result = rekeyVariants(entry.variants, moves);
  if (result.moved) await setSourcing(productId, { ...entry, variants: result.variants });
  return result.moved;
}

/** The re-keying itself, with no store behind it so it can be tested directly. */
export function rekeyVariants(
  variants: Record<string, VariantSourcing>,
  moves: Record<string, string>,
): { variants: Record<string, VariantSourcing>; moved: number } {
  const next: Record<string, VariantSourcing> = {};
  let moved = 0;
  for (const [sku, v] of Object.entries(variants)) {
    const to = moves[sku] ?? sku;
    if (to !== sku) moved++;
    next[to] = v;
  }
  return { variants: next, moved };
}
