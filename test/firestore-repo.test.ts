import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreRepo, keywordsFor, priceFrom } from '../src/repo/firestore-repo.ts';
import { InsufficientStock } from '../src/repo/index.ts';
import type { Product, Order } from '../src/types.ts';

const now = new Date().toISOString();
const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', slug: 'jhumka', title: 'Filigree Jhumka', category: 'jhumka',
  tagline: 'Bell drops', description: '', material: 'Zinc Alloy', finish: 'Oxidised',
  details: {}, images: [], tags: ['jhumka', 'oxidised'], featured: false, status: 'active',
  variants: [{ sku: 'J-1', label: 'Silver', price: 60900, stock: 2 }],
  createdAt: now, updatedAt: now, ...over,
});

/**
 * Just enough Firestore to exercise the writes and the transaction.
 *
 * The query paths cannot be faked honestly — composite indexes, `count()` and
 * range-filter ordering are the database's behaviour, not ours — so those are
 * verified against the emulator, not here. What *is* here is the reason to be
 * on Firestore at all: the stock decrement must be atomic.
 */
function fakeDb() {
  const data = new Map<string, Map<string, Record<string, unknown>>>();
  const col = (name: string) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name)!;
  };
  const doc = (name: string, id: string) => ({
    id, _col: name,
    async get() {
      const v = col(name).get(id);
      return { exists: v !== undefined, id, data: () => v };
    },
  });
  const db = {
    _data: data,
    collection: (name: string) => ({
      doc: (id: string) => doc(name, id),
      where: () => { throw new Error('queries are verified against the emulator'); },
    }),
    batch() {
      const ops: Array<() => void> = [];
      return {
        set: (d: { id: string; _col: string }, v: Record<string, unknown>) =>
          ops.push(() => col(d._col).set(d.id, v)),
        delete: (d: { id: string; _col: string }) => ops.push(() => col(d._col).delete(d.id)),
        async commit() { for (const op of ops) op(); },
      };
    },
    async runTransaction<T>(fn: (tx: {
      getAll: (...refs: Array<{ id: string; _col: string }>) => Promise<Array<{ exists: boolean; id: string; data: () => unknown }>>;
      update: (d: { id: string; _col: string }, patch: Record<string, unknown>) => void;
      set: (d: { id: string; _col: string }, v: Record<string, unknown>) => void;
    }) => Promise<T>): Promise<T> {
      const staged: Array<() => void> = [];
      const result = await fn({
        getAll: async (...refs) => refs.map((r) => {
          const v = col(r._col).get(r.id);
          return { exists: v !== undefined, id: r.id, data: () => v };
        }),
        update: (d, patch) => staged.push(() => col(d._col).set(d.id, { ...col(d._col).get(d.id), ...patch })),
        set: (d, v) => staged.push(() => col(d._col).set(d.id, v)),
      });
      // A throw inside the callback must leave nothing written.
      for (const op of staged) op();
      return result;
    },
  };
  return db;
}

const order = (ref: string, sku: string, quantity: number): Order => ({
  id: ref, reference: ref,
  lines: [{ sku, productId: 'p1', title: 'Filigree Jhumka', variantLabel: 'Silver', unitPrice: 60900, quantity }],
  subtotal: 60900 * quantity, shipping: 0, taxRate: 0.18, tax: 0, total: 60900 * quantity,
  customer: { name: 'A', email: 'a@b.c', phone: '9' },
  address: { line1: 'x', city: 'y', state: 'z', pincode: '110001' },
  status: 'pending', createdAt: now,
});

test('a product write derives priceFrom and the keyword index', async () => {
  const db = fakeDb();
  const repo = new FirestoreRepo(db as never);
  await repo.createProduct(product({
    variants: [
      { sku: 'J-1', label: 'Silver', price: 60900, stock: 2 },
      { sku: 'J-2', label: 'Black', price: 54900, stock: 1 },
    ],
  }));
  const stored = db._data.get('products')!.get('p1') as { priceFrom: number; keywords: string[] };
  // The API filters and sorts on the cheapest variant, which Firestore cannot
  // compute from an array.
  assert.equal(stored.priceFrom, 54900);
  assert.ok(stored.keywords.includes('filigree'));
  assert.ok(stored.keywords.includes('oxidised'));
  assert.ok(!stored.keywords.includes('a'), 'one- and two-letter words are dropped');
});

test('every SKU is indexed to its product', async () => {
  const db = fakeDb();
  const repo = new FirestoreRepo(db as never);
  await repo.createProduct(product({
    variants: [
      { sku: 'J-1', label: 'Silver', price: 60900, stock: 2 },
      { sku: 'J-2', label: 'Black', price: 54900, stock: 1 },
    ],
  }));
  // A cart line has to resolve in one read, not a scan of the catalogue.
  assert.equal(db._data.get('variantsBySku')!.get('J-2')!.productId, 'p1');
});

test('a renamed SKU does not leave the old one pointing here', async () => {
  const db = fakeDb();
  const repo = new FirestoreRepo(db as never);
  const before = product();
  await repo.createProduct(before);
  await repo.updateProduct('p1', { variants: [{ sku: 'J-RENAMED', label: 'Silver', price: 60900, stock: 2 }] });
  assert.equal(db._data.get('variantsBySku')!.has('J-1'), false, 'the stale SKU should be gone');
  assert.equal(db._data.get('variantsBySku')!.get('J-RENAMED')!.productId, 'p1');
});

test('stock comes down inside the transaction', async () => {
  const db = fakeDb();
  const repo = new FirestoreRepo(db as never);
  await repo.createProduct(product());
  await repo.createOrder(order('OXJ-1', 'J-1', 1));
  const stored = db._data.get('products')!.get('p1') as unknown as Product;
  assert.equal(stored.variants[0]!.stock, 1);
  assert.equal(db._data.get('orders')!.has('OXJ-1'), true);
});

test('an oversell is refused and writes nothing', async () => {
  const db = fakeDb();
  const repo = new FirestoreRepo(db as never);
  await repo.createProduct(product());
  await assert.rejects(() => repo.createOrder(order('OXJ-2', 'J-1', 5)), (e) => {
    assert.ok(e instanceof InsufficientStock);
    assert.equal(e.available, 2);
    return true;
  });
  const stored = db._data.get('products')!.get('p1') as unknown as Product;
  assert.equal(stored.variants[0]!.stock, 2, 'stock must be untouched');
  // The collection may not exist at all, which is the strongest form of "not written".
  assert.equal(db._data.get('orders')?.has('OXJ-2') ?? false, false, 'no order should be recorded');
});

test('the derived helpers stand on their own', () => {
  assert.equal(priceFrom(product({ variants: [
    { sku: 'a', label: 'a', price: 999, stock: 1 },
    { sku: 'b', label: 'b', price: 499, stock: 1 },
  ] })), 499);
  assert.ok(keywordsFor(product({ title: 'Gold-Plated Wedding Kada' })).includes('kada'));
});
