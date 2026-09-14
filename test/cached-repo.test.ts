import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CachedRepo } from '../src/repo/cached-repo.ts';
import type { Order, Product } from '../src/types.ts';
import type { Repo } from '../src/repo/index.ts';

/**
 * The cache in front of Firestore. What matters is not that it caches — it is
 * that a write makes the next read fresh. A stale price after an edit, or a
 * piece still on sale after the last one was bought, is worse than the read
 * bill this exists to avoid.
 */
function fake() {
  const calls: Record<string, number> = {};
  const bump = (k: string) => { calls[k] = (calls[k] ?? 0) + 1; };
  const product = { id: 'p1', slug: 'jhumka', variants: [] } as unknown as Product;
  const repo: Repo = {
    async listProducts() { bump('listProducts'); return { items: [product], total: 1, page: 1, perPage: 24, pages: 1 }; },
    async getProduct() { bump('getProduct'); return product; },
    async getVariantBySku() { bump('getVariantBySku'); return null; },
    async createProduct(p) { bump('createProduct'); return p; },
    async updateProduct() { bump('updateProduct'); return product; },
    async deleteProduct() { bump('deleteProduct'); return true; },
    async listCategories() { bump('listCategories'); return []; },
    async createOrder(o) { bump('createOrder'); return o; },
    async getOrder() { bump('getOrder'); return null; },
    async listOrders() { bump('listOrders'); return []; },
    async setOrderStatus() { bump('setOrderStatus'); return null; },
    async priceBounds() { bump('priceBounds'); return { min: 0, max: 0 }; },
  };
  return { repo, calls };
}

const q = { page: 1, perPage: 24 };

test('a repeated read reaches the database once', async () => {
  const { repo, calls } = fake();
  const c = new CachedRepo(repo, 60_000);
  for (let i = 0; i < 5; i++) await c.listProducts(q);
  for (let i = 0; i < 5; i++) await c.getProduct('jhumka');
  for (let i = 0; i < 5; i++) await c.listCategories();
  assert.equal(calls.listProducts, 1);
  assert.equal(calls.getProduct, 1);
  assert.equal(calls.listCategories, 1);
});

test('a different page is a different question', async () => {
  const { repo, calls } = fake();
  const c = new CachedRepo(repo, 60_000);
  await c.listProducts({ ...q, page: 1 });
  await c.listProducts({ ...q, page: 2 });
  await c.listProducts({ ...q, page: 1 });
  assert.equal(calls.listProducts, 2, 'page 1 should be answered from the cache the second time');
});

test('editing a product makes the next listing fresh', async () => {
  const { repo, calls } = fake();
  const c = new CachedRepo(repo, 60_000);
  await c.listProducts(q);
  await c.getProduct('jhumka');
  await c.updateProduct('p1', { featured: true });
  await c.listProducts(q);
  await c.getProduct('jhumka');
  assert.equal(calls.listProducts, 2);
  assert.equal(calls.getProduct, 2);
});

/*
 * The one that would cost money rather than tidiness: an order takes stock
 * down, so every cached card showing that piece is wrong from that moment.
 */
test('placing an order drops the cached catalogue', async () => {
  const { repo, calls } = fake();
  const c = new CachedRepo(repo, 60_000);
  await c.listProducts(q);
  await c.createOrder({ id: 'o1' } as unknown as Order);
  await c.listProducts(q);
  assert.equal(calls.listProducts, 2);
});

test('orders are never served from the cache', async () => {
  const { repo, calls } = fake();
  const c = new CachedRepo(repo, 60_000);
  await c.listOrders();
  await c.listOrders();
  await c.getOrder('OXJ-1');
  await c.getOrder('OXJ-1');
  assert.equal(calls.listOrders, 2, 'an operator must see what is actually there');
  assert.equal(calls.getOrder, 2);
});

test('a zero TTL means every read goes through', async () => {
  const { repo, calls } = fake();
  const c = new CachedRepo(repo, 0);
  await c.listProducts(q);
  await c.listProducts(q);
  assert.equal(calls.listProducts, 2);
});
