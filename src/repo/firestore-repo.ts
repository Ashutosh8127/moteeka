import type { Firestore, Query, DocumentData } from '@google-cloud/firestore';
import type { Category, ListQuery, Order, Page, Product } from '../types.ts';
import { InsufficientStock, type Repo, type VariantHit } from './index.ts';

/**
 * The catalogue in Firestore.
 *
 * Firestore is not a relational database and pretending otherwise produces a
 * driver that works on fifteen products and falls over on five hundred. Three
 * things had to change shape rather than be translated:
 *
 * 1. **Price is denormalised.** The API filters and sorts on the cheapest
 *    variant, which lives inside an array. Firestore cannot compute that, so
 *    `priceFrom` is written alongside and kept in step on every write.
 * 2. **Search is a keyword array.** There is no substring matching. Titles,
 *    tags and material are tokenised into `keywords` and queried with
 *    `array-contains`, so "jhum" finds nothing and "jhumka" finds the product.
 *    Real search is Algolia or Typesense; this is honest prefixless matching.
 * 3. **SKUs are their own collection.** `variantsBySku` maps a SKU to its
 *    product id, because a cart line needs one read, not a scan.
 *
 * Stock is decremented in a transaction, which is the reason to be here at all:
 * unlike the JSON driver this holds across processes, so two containers cannot
 * sell the same last piece.
 */
const PRODUCTS = 'products';
const CATEGORIES = 'categories';
const ORDERS = 'orders';
const SKUS = 'variantsBySku';

/** Lowercased words of three characters or more, deduped. */
export function keywordsFor(p: Product): string[] {
  const text = [p.title, p.tagline, p.material, p.finish, p.category, ...p.tags,
    ...p.variants.map((v) => v.label)].join(' ');
  return [...new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3),
  )].slice(0, 300);   // Firestore caps array-contains indexes; 300 is generous
}

export const priceFrom = (p: Product): number => Math.min(...p.variants.map((v) => v.price));

/** What is stored: the product, plus the fields Firestore needs to query it. */
interface StoredProduct extends Product { priceFrom: number; keywords: string[] }

const strip = (d: StoredProduct): Product => {
  const { priceFrom: _p, keywords: _k, ...product } = d;
  return product as Product;
};

export class FirestoreRepo implements Repo {
  private db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async listProducts(q: ListQuery): Promise<Page<Product>> {
    let query: Query<DocumentData> = this.db.collection(PRODUCTS);
    if (!q.includeDrafts) query = query.where('status', '==', 'active');
    if (q.category) query = query.where('category', '==', q.category);

    // `array-contains` may appear once per query, and search and tag both want
    // it. Search is the stronger filter, so it takes the index and the tag is
    // applied to the returned page.
    const tagAfter = Boolean(q.tag && q.search);
    if (q.search) query = query.where('keywords', 'array-contains', q.search.toLowerCase());
    else if (q.tag) query = query.where('tags', 'array-contains', q.tag);

    if (q.minPrice !== undefined) query = query.where('priceFrom', '>=', q.minPrice);
    if (q.maxPrice !== undefined) query = query.where('priceFrom', '<=', q.maxPrice);

    /*
     * A range filter must be the first field ordered. So a price range plus a
     * name or newest sort orders by price first and by the asked-for field
     * second — a Firestore constraint, not a preference. Sorting the page in
     * memory instead would only be right within that page and wrong across the
     * next one, which is worse than a documented ordering.
     */
    const priceFiltered = q.minPrice !== undefined || q.maxPrice !== undefined;
    switch (q.sort) {
      case 'price-asc': query = query.orderBy('priceFrom', 'asc'); break;
      case 'price-desc': query = query.orderBy('priceFrom', 'desc'); break;
      case 'name':
        if (priceFiltered) query = query.orderBy('priceFrom', 'asc');
        query = query.orderBy('title', 'asc');
        break;
      default:
        if (priceFiltered) query = query.orderBy('priceFrom', 'asc');
        query = query.orderBy('createdAt', 'desc');
    }

    const perPage = Math.min(Math.max(q.perPage ?? 24, 1), 100);
    const page = Math.max(q.page ?? 1, 1);

    // count() is one aggregation read rather than a document each — offset
    // paging still charges for the documents it skips, which is why the
    // storefront should move to cursors once the catalogue is large.
    const [countSnap, snap] = await Promise.all([
      query.count().get(),
      query.offset((page - 1) * perPage).limit(perPage).get(),
    ]);

    let items = snap.docs.map((d) => strip(d.data() as StoredProduct));
    // The tag could not be indexed alongside the search, so it filters the page.
    // `total` then overstates by the tag's share; the alternative is a second
    // full query per request.
    if (tagAfter) items = items.filter((p) => p.tags.includes(q.tag!));

    const total = countSnap.data().count;
    return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
  }

  async getProduct(idOrSlug: string): Promise<Product | null> {
    const byId = await this.db.collection(PRODUCTS).doc(idOrSlug).get();
    if (byId.exists) return strip(byId.data() as StoredProduct);
    const bySlug = await this.db.collection(PRODUCTS).where('slug', '==', idOrSlug).limit(1).get();
    return bySlug.empty ? null : strip(bySlug.docs[0]!.data() as StoredProduct);
  }

  async getVariantBySku(sku: string): Promise<VariantHit | null> {
    const index = await this.db.collection(SKUS).doc(sku).get();
    if (!index.exists) return null;
    const product = await this.getProduct(String(index.data()!.productId));
    const variant = product?.variants.find((v) => v.sku === sku);
    return product && variant ? { product, variant } : null;
  }

  async createProduct(p: Product): Promise<Product> {
    await this.write(p);
    return p;
  }

  async updateProduct(id: string, patch: Partial<Product>): Promise<Product | null> {
    const current = await this.getProduct(id);
    if (!current) return null;
    const updated: Product = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
    await this.write(updated, current);
    return updated;
  }

  async deleteProduct(id: string): Promise<boolean> {
    const current = await this.getProduct(id);
    if (!current) return false;
    const batch = this.db.batch();
    batch.delete(this.db.collection(PRODUCTS).doc(id));
    for (const v of current.variants) batch.delete(this.db.collection(SKUS).doc(v.sku));
    await batch.commit();
    return true;
  }

  async listCategories(): Promise<Category[]> {
    const snap = await this.db.collection(CATEGORIES).orderBy('sortOrder').get();
    return snap.docs.map((d) => d.data() as Category);
  }

  /**
   * Reads every ordered product, checks stock and writes the decrements and the
   * order in one transaction. Firestore retries it on contention, so two
   * buyers racing for the last piece resolve to one success and one
   * `InsufficientStock` — the guarantee the JSON driver cannot make.
   */
  async createOrder(o: Order): Promise<Order> {
    const ids = [...new Set(o.lines.map((l) => l.productId))];
    await this.db.runTransaction(async (tx) => {
      const refs = ids.map((id) => this.db.collection(PRODUCTS).doc(id));
      // Every read must happen before every write inside a transaction.
      const snaps = await tx.getAll(...refs);
      const products = new Map<string, StoredProduct>();
      for (const s of snaps) if (s.exists) products.set(s.id, s.data() as StoredProduct);

      for (const line of o.lines) {
        const variant = products.get(line.productId)?.variants.find((v) => v.sku === line.sku);
        if (!variant) throw new InsufficientStock(line.sku, line.quantity, 0);
        if (variant.stock < line.quantity) {
          throw new InsufficientStock(line.sku, line.quantity, variant.stock);
        }
      }

      for (const [id, p] of products) {
        const variants = p.variants.map((v) => {
          const line = o.lines.find((l) => l.sku === v.sku);
          return line ? { ...v, stock: v.stock - line.quantity } : v;
        });
        tx.update(this.db.collection(PRODUCTS).doc(id), { variants, updatedAt: new Date().toISOString() });
      }
      tx.set(this.db.collection(ORDERS).doc(o.id), o);
    });
    return o;
  }

  async getOrder(reference: string): Promise<Order | null> {
    const snap = await this.db.collection(ORDERS).where('reference', '==', reference).limit(1).get();
    return snap.empty ? null : (snap.docs[0]!.data() as Order);
  }

  async listOrders(): Promise<Order[]> {
    const snap = await this.db.collection(ORDERS).orderBy('createdAt', 'desc').limit(500).get();
    return snap.docs.map((d) => d.data() as Order);
  }

  async setOrderStatus(reference: string, status: Order['status']): Promise<Order | null> {
    // Orders are keyed by id, not reference, so the write needs the document
    // the lookup found rather than a second guess at its path.
    const snap = await this.db.collection(ORDERS).where('reference', '==', reference).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0]!;
    await doc.ref.update({ status });
    return { ...(doc.data() as Order), status };
  }

  async priceBounds(): Promise<{ min: number; max: number }> {
    const live = this.db.collection(PRODUCTS).where('status', '==', 'active');
    const [lo, hi] = await Promise.all([
      live.orderBy('priceFrom', 'asc').limit(1).get(),
      live.orderBy('priceFrom', 'desc').limit(1).get(),
    ]);
    if (lo.empty) return { min: 0, max: 0 };
    return {
      min: (lo.docs[0]!.data() as StoredProduct).priceFrom,
      max: (hi.docs[0]!.data() as StoredProduct).priceFrom,
    };
  }

  /** Writes a product and keeps the derived fields and the SKU index in step. */
  private async write(p: Product, previous?: Product): Promise<void> {
    const stored: StoredProduct = { ...p, priceFrom: priceFrom(p), keywords: keywordsFor(p) };
    const batch = this.db.batch();
    batch.set(this.db.collection(PRODUCTS).doc(p.id), stored);
    // A renamed or removed SKU must not keep pointing at this product.
    for (const v of previous?.variants ?? []) {
      if (!p.variants.some((n) => n.sku === v.sku)) batch.delete(this.db.collection(SKUS).doc(v.sku));
    }
    for (const v of p.variants) {
      batch.set(this.db.collection(SKUS).doc(v.sku), { productId: p.id, slug: p.slug });
    }
    await batch.commit();
  }
}
