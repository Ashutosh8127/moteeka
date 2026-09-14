import type { Category, ListQuery, Order, Page, Product } from '../types.ts';
import { firestoreOptions } from '../lib/firestore-options.ts';

/**
 * Everything the API asks of storage.
 *
 * The routes only ever see this interface, never a JSON file and never a SQL
 * client. Moving to Postgres later is a new class implementing these methods
 * and one line in `openRepo()` — no route, no handler and no frontend call
 * changes. That is the whole point of the seam.
 */
/**
 * Thrown by `createOrder` when stock moved between quoting a cart and placing
 * it. Quoting and ordering are two round trips, so this is not an edge case —
 * it is what happens whenever two people want the last piece.
 */
export class InsufficientStock extends Error {
  readonly sku: string;
  readonly wanted: number;
  readonly available: number;
  constructor(sku: string, wanted: number, available: number) {
    super(`only ${available} left of ${sku}, ${wanted} requested`);
    this.name = 'InsufficientStock';
    this.sku = sku;
    this.wanted = wanted;
    this.available = available;
  }
}

/** A variant and the product it belongs to. */
export interface VariantHit { product: Product; variant: Product['variants'][number] }

export interface Repo {
  listProducts(q: ListQuery): Promise<Page<Product>>;
  getProduct(idOrSlug: string): Promise<Product | null>;
  /**
   * One variant by SKU. Pricing a cart used to page through the catalogue and
   * search it in memory, which cost a full listing per cart line and stopped
   * finding anything past the hundredth product.
   */
  getVariantBySku(sku: string): Promise<VariantHit | null>;
  createProduct(p: Product): Promise<Product>;
  updateProduct(id: string, patch: Partial<Product>): Promise<Product | null>;
  deleteProduct(id: string): Promise<boolean>;

  listCategories(): Promise<Category[]>;

  /**
   * Writes the order and takes the stock down together. Implementations must
   * re-check stock at write time and throw `InsufficientStock` rather than
   * trusting the quote — see the note on each driver about how far that
   * guarantee reaches.
   */
  createOrder(o: Order): Promise<Order>;
  getOrder(reference: string): Promise<Order | null>;
  listOrders(): Promise<Order[]>;
  /**
   * Moves an order along. The only field an operator may change: everything
   * else on an order is what was agreed at the time, and editing that after
   * the fact is how a dispute becomes unanswerable.
   *
   * Cancelling does **not** put stock back. What came off the shelf when the
   * order was placed may already be in a box; returning it is a stock
   * adjustment you make when the piece is physically back, with
   * `npm run edit -- <slug> --stock`.
   */
  setOrderStatus(reference: string, status: Order['status']): Promise<Order | null>;

  /** Price range across the live catalogue, for the filter UI. */
  priceBounds(): Promise<{ min: number; max: number }>;
}

export type RepoDriver = 'json' | 'firestore' | 'postgres';

export async function openRepo(driver: RepoDriver, root: string): Promise<Repo> {
  if (driver === 'json') {
    const { JsonRepo } = await import('./json-repo.ts');
    return new JsonRepo(root);
  }
  if (driver === 'firestore') {
    // Imported here, not at the top: the JSON path must not pay to load the
    // Firestore client, and a machine with no credentials must still run.
    const [{ Firestore }, { FirestoreRepo }] = await Promise.all([
      import('@google-cloud/firestore'),
      import('./firestore-repo.ts'),
    ]);
    const db = new Firestore(firestoreOptions());
    /*
     * Wrapped, because every read here is billed and the catalogue changes
     * when you change it. The JSON driver is not wrapped: it already answers
     * from memory, and a cache there would break the "edit data/*.json by
     * hand and reload" workflow the rest of this project is built around.
     *
     * CATALOGUE_TTL_MS=0 turns it off, for when you are watching a price
     * change land and do not want to wonder whether you are seeing a copy.
     */
    const { CachedRepo } = await import('./cached-repo.ts');
    const ttl = Number(process.env.CATALOGUE_TTL_MS ?? 60_000);
    const repo = new FirestoreRepo(db);
    return Number.isFinite(ttl) && ttl > 0 ? new CachedRepo(repo, ttl) : repo;
  }
  throw new Error(
    `repo driver "${driver}" is not wired up yet.\n` +
    `  json and firestore are. To move to Postgres:\n` +
    `    1. npx prisma migrate dev   (schema is already written)\n` +
    `    2. add src/repo/prisma-repo.ts implementing Repo\n` +
    `    3. return it from openRepo() and set REPO_DRIVER=postgres`,
  );
}
