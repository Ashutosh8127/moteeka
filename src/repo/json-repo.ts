import { join } from 'node:path';
import { JsonStore } from '../lib/json-store.ts';
import { DirStore } from '../lib/dir-store.ts';
import type { Category, ListQuery, Order, Page, Product } from '../types.ts';
import { InsufficientStock, type Repo, type VariantHit } from './index.ts';

/**
 * The catalogue on disk.
 *
 * Filtering and sorting happen in memory, which is the right trade at a few
 * hundred SKUs and the wrong one at a few hundred thousand — by then the
 * Postgres driver behind the same interface is doing it in the query.
 */
export class JsonRepo implements Repo {
  /** One file per product, named by slug — see src/lib/dir-store.ts. */
  private products: DirStore<Product>;
  private categories: JsonStore<Category[]>;
  private orders: JsonStore<Order[]>;

  constructor(root: string) {
    this.products = new DirStore<Product>(join(root, 'data', 'products'), (p) => p.slug);
    this.categories = new JsonStore<Category[]>(join(root, 'data', 'categories.json'), () => []);
    this.orders = new JsonStore<Order[]>(join(root, 'data', 'orders.json'), () => []);
  }

  private priceOf(p: Product): number {
    return Math.min(...p.variants.map((v) => v.price));
  }

  async listProducts(q: ListQuery): Promise<Page<Product>> {
    let items = this.products.all();
    if (!q.includeDrafts) items = items.filter((p) => p.status === 'active');
    if (q.category) items = items.filter((p) => p.category === q.category);
    if (q.tag) items = items.filter((p) => p.tags.includes(q.tag!));

    if (q.search) {
      const needle = q.search.toLowerCase();
      items = items.filter((p) =>
        p.title.toLowerCase().includes(needle) ||
        p.tagline.toLowerCase().includes(needle) ||
        p.tags.some((t) => t.includes(needle)) ||
        p.material.toLowerCase().includes(needle));
    }
    if (q.minPrice !== undefined) items = items.filter((p) => this.priceOf(p) >= q.minPrice!);
    if (q.maxPrice !== undefined) items = items.filter((p) => this.priceOf(p) <= q.maxPrice!);

    const sorted = [...items];
    switch (q.sort) {
      case 'price-asc': sorted.sort((a, b) => this.priceOf(a) - this.priceOf(b)); break;
      case 'price-desc': sorted.sort((a, b) => this.priceOf(b) - this.priceOf(a)); break;
      case 'name': sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
      default: sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const perPage = Math.min(Math.max(q.perPage ?? 24, 1), 100);
    const page = Math.max(q.page ?? 1, 1);
    const start = (page - 1) * perPage;
    return {
      items: sorted.slice(start, start + perPage),
      total: sorted.length,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(sorted.length / perPage)),
    };
  }

  async getProduct(idOrSlug: string): Promise<Product | null> {
    return this.products.get((p) => p.id === idOrSlug || p.slug === idOrSlug);
  }

  async getVariantBySku(sku: string): Promise<VariantHit | null> {
    for (const p of this.products.all()) {
      const variant = p.variants.find((v) => v.sku === sku);
      if (variant) return { product: p, variant };
    }
    return null;
  }

  async createProduct(p: Product): Promise<Product> {
    this.products.put(p);
    return p;
  }

  async updateProduct(id: string, patch: Partial<Product>): Promise<Product | null> {
    const current = await this.getProduct(id);
    if (!current) return null;
    const updated: Product = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
    // The filename follows the slug, so a slug change renames the file.
    this.products.put(updated, current.slug);
    return updated;
  }

  async deleteProduct(id: string): Promise<boolean> {
    const current = await this.getProduct(id);
    return current ? this.products.remove(current) : false;
  }

  async listCategories(): Promise<Category[]> {
    return [...this.categories.read()].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * The check and the decrement happen with no `await` between them, so within
   * one process nothing can interleave and oversell — Node runs this to
   * completion before the next request is touched.
   *
   * Across processes it is not safe, and cannot be: two containers each hold
   * their own copy of data/. That is a reason to move orders to a database
   * before scaling past one instance, not a reason to pretend here.
   */
  async createOrder(o: Order): Promise<Order> {
    const touched = new Map<string, Product>();
    for (const p of this.products.all()) touched.set(p.id, p);

    // Re-check every line against what stock is now, not what the quote saw.
    for (const line of o.lines) {
      const product = touched.get(line.productId);
      const variant = product?.variants.find((v) => v.sku === line.sku);
      if (!variant) throw new InsufficientStock(line.sku, line.quantity, 0);
      if (variant.stock < line.quantity) {
        throw new InsufficientStock(line.sku, line.quantity, variant.stock);
      }
    }

    const ordered = new Set(o.lines.map((l) => l.productId));
    for (const p of touched.values()) {
      if (!ordered.has(p.id)) continue;
      this.products.put({
        ...p,
        variants: p.variants.map((v) => {
          const line = o.lines.find((l) => l.sku === v.sku);
          return line ? { ...v, stock: v.stock - line.quantity } : v;
        }),
      });
    }
    // Written last: an order recorded against stock that was never taken down
    // is worse than a failed order.
    this.orders.update((all) => [...all, o]);
    return o;
  }

  async getOrder(reference: string): Promise<Order | null> {
    return this.orders.read().find((o) => o.reference === reference) ?? null;
  }

  async listOrders(): Promise<Order[]> {
    return [...this.orders.read()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setOrderStatus(reference: string, status: Order['status']): Promise<Order | null> {
    let updated: Order | null = null;
    this.orders.update((all) => all.map((o) => {
      if (o.reference !== reference) return o;
      updated = { ...o, status };
      return updated;
    }));
    return updated;
  }

  async priceBounds(): Promise<{ min: number; max: number }> {
    const live = this.products.all().filter((p) => p.status === 'active');
    if (live.length === 0) return { min: 0, max: 0 };
    const prices = live.map((p) => this.priceOf(p));
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }
}
