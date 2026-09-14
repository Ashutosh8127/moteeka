import type { Category, ListQuery, Order, Page, Product } from '../types.ts';
import type { Repo, VariantHit } from './index.ts';

/**
 * A read-through cache in front of another Repo.
 *
 * This exists because of an outage. The shop is 54 pieces that change when you
 * change them, and every request was paying Firestore to read them again: a
 * listing cost a document read per product returned plus the ones offset
 * skipped, a product page cost two, a cart line three. Add the review read on
 * top and the free tier's 50,000 daily reads bought about two hundred page
 * views before the API began answering RESOURCE_EXHAUSTED.
 *
 * Only reads are cached, and only the catalogue. Orders are never cached —
 * an operator looking at the order list needs what is actually there, and the
 * stock decrement inside createOrder must read fresh or it would be deciding
 * whether to sell the last piece from a minute-old copy.
 *
 * Stock on a *listing* can be up to one TTL stale, and that is deliberate: the
 * transaction in createOrder re-checks it and throws InsufficientStock, so the
 * worst case is a customer being told at checkout rather than on the card. The
 * alternative — a fresh read per card per request — is what took the shop down.
 *
 * Per process. A serverless host runs several instances and each keeps its own,
 * so this cuts reads by roughly the number of requests an instance serves in a
 * TTL rather than to zero.
 */
export class CachedRepo implements Repo {
  private inner: Repo;
  private ttlMs: number;
  private entries = new Map<string, { at: number; value: unknown }>();

  constructor(inner: Repo, ttlMs = 60_000) {
    this.inner = inner;
    this.ttlMs = ttlMs;
  }

  /** Everything the catalogue serves. Dropped whole on any write. */
  private forget(): void {
    this.entries.clear();
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as T;
    const value = await load();
    this.entries.set(key, { at: Date.now(), value });
    return value;
  }

  /* --------------------------------------------------------------- reads -- */

  listProducts(q: ListQuery): Promise<Page<Product>> {
    /*
     * Keyed by the whole query. The storefront asks a small, repeating set of
     * them — a category, a sort, a page — so this hits often; a price filter
     * someone drags produces keys that are missed once and then not asked for
     * again, which is the same cost as not caching.
     */
    const key = `list:${JSON.stringify([
      q.category ?? '', q.tag ?? '', q.search ?? '', q.sort ?? '',
      q.minPrice ?? '', q.maxPrice ?? '', q.page ?? 1, q.perPage ?? 24,
      q.includeDrafts ?? false,
    ])}`;
    return this.cached(key, () => this.inner.listProducts(q));
  }

  getProduct(idOrSlug: string): Promise<Product | null> {
    return this.cached(`product:${idOrSlug}`, () => this.inner.getProduct(idOrSlug));
  }

  getVariantBySku(sku: string): Promise<VariantHit | null> {
    return this.cached(`sku:${sku}`, () => this.inner.getVariantBySku(sku));
  }

  listCategories(): Promise<Category[]> {
    return this.cached('categories', () => this.inner.listCategories());
  }

  priceBounds(): Promise<{ min: number; max: number }> {
    return this.cached('bounds', () => this.inner.priceBounds());
  }

  /* -------------------------------------------------------------- writes -- */

  async createProduct(p: Product): Promise<Product> {
    const out = await this.inner.createProduct(p);
    this.forget();
    return out;
  }

  async updateProduct(id: string, patch: Partial<Product>): Promise<Product | null> {
    const out = await this.inner.updateProduct(id, patch);
    this.forget();
    return out;
  }

  async deleteProduct(id: string): Promise<boolean> {
    const out = await this.inner.deleteProduct(id);
    this.forget();
    return out;
  }

  async createOrder(o: Order): Promise<Order> {
    // Straight through: the transaction inside must read live stock, not this.
    const out = await this.inner.createOrder(o);
    // Stock came down, so every cached listing and card is now wrong.
    this.forget();
    return out;
  }

  /* ------------------------------------------------- never cached: orders -- */

  getOrder(reference: string): Promise<Order | null> {
    return this.inner.getOrder(reference);
  }

  listOrders(): Promise<Order[]> {
    return this.inner.listOrders();
  }

  setOrderStatus(reference: string, status: Order['status']): Promise<Order | null> {
    return this.inner.setOrderStatus(reference, status);
  }
}
