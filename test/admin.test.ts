import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonRepo } from '../src/repo/json-repo.ts';
import type { Order, Product } from '../src/types.ts';

/**
 * The admin surface. The gate itself is exercised against the running server in
 * `npm run dev`; what is worth a test here is the write it lets through, since
 * an order status is the only field an operator may change and the only one a
 * bug could silently change something else alongside.
 */
const now = new Date().toISOString();

function shop() {
  const dir = mkdtempSync(join(tmpdir(), 'oxj-admin-'));
  mkdirSync(join(dir, 'data', 'products'), { recursive: true });
  const p: Product = {
    id: 'p1', slug: 'a-piece', title: 'A Piece', category: 'jhumka',
    tagline: '', description: '', material: 'brass', finish: '',
    details: {}, images: [], tags: [], featured: false, status: 'active',
    variants: [{ sku: 'T-1', label: 'Small', price: 49900, stock: 5 }],
    createdAt: now, updatedAt: now,
  };
  writeFileSync(join(dir, 'data', 'products', 'a-piece.json'), JSON.stringify(p));
  writeFileSync(join(dir, 'data', 'categories.json'), '[]');
  writeFileSync(join(dir, 'data', 'orders.json'), '[]');
  return new JsonRepo(dir);
}

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1', reference: 'OXJ-260913-AAAA',
  lines: [{ sku: 'T-1', productId: 'p1', title: 'A Piece', variantLabel: 'Small', unitPrice: 49900, quantity: 2 }],
  subtotal: 99800, shipping: 0, taxRate: 0.18, tax: 17964, total: 117764,
  customer: { name: 'A Buyer', email: 'a@example.com', phone: '+919999999999' },
  address: { line1: '1 Road', city: 'Pune', state: 'MH', pincode: '411001' },
  status: 'pending', createdAt: now, ...over,
});

test('an order moves along, and nothing else on it moves with it', async () => {
  const repo = shop();
  const placed = await repo.createOrder(order());

  const updated = await repo.setOrderStatus(placed.reference, 'shipped');
  assert.equal(updated?.status, 'shipped');

  // Everything an operator must not be able to edit after the fact.
  const { status: _was, ...before_ } = placed;
  const { status: _now, ...after_ } = updated!;
  assert.deepEqual(after_, before_, 'only the status changed');

  const reread = await repo.getOrder(placed.reference);
  assert.equal(reread?.status, 'shipped', 'and it was written, not just returned');
});

test('a reference that does not exist returns null rather than creating one', async () => {
  const repo = shop();
  assert.equal(await repo.setOrderStatus('OXJ-NOPE', 'paid'), null);
  assert.deepEqual(await repo.listOrders(), []);
});

test('cancelling does not put stock back', async () => {
  // Deliberate: what came off the shelf may already be in a box, and returning
  // it is a physical event, not a status change.
  const repo = shop();
  const placed = await repo.createOrder(order());
  const afterOrder = await repo.getProduct('a-piece');
  assert.equal(afterOrder!.variants[0]!.stock, 3);

  await repo.setOrderStatus(placed.reference, 'cancelled');
  const afterCancel = await repo.getProduct('a-piece');
  assert.equal(afterCancel!.variants[0]!.stock, 3, 'still 3 — stock is adjusted by hand');
});

test('an order records what was bought, not what was left or what it was called', async () => {
  const repo = shop();
  const placed = await repo.createOrder(order());
  const line = placed.lines[0]! as unknown as Record<string, unknown>;
  assert.ok(!('stock' in line), 'stock belongs to a quote, not an order');
  assert.ok(!('slug' in line), 'a slug is what a piece was called that week; productId is stable');
});

test('the public product API cannot serve sourcing, however the admin page shows it', async () => {
  // The admin /pieces route reads data/sourcing.json. That file is the supplier
  // relationship — their SKU, their listing, what you pay — and the guarantee
  // is that it lives nowhere a customer can reach. A Product has no field for
  // any of it, which is what makes the guarantee structural rather than a rule
  // somebody has to remember.
  const repo = shop();
  const p = await repo.getProduct('a-piece');
  const served = JSON.stringify(p);
  for (const leak of ['sourceUrl', 'supplier', 'supplierSku', 'costPaise', 'pricing', 'moq']) {
    assert.ok(!served.includes(leak), `a public product must not carry ${leak}`);
  }
  const listed = JSON.stringify(await repo.listProducts({ perPage: 100 }));
  assert.ok(!/sourceUrl|supplierSku|costPaise/.test(listed));
});
