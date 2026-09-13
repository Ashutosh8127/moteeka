import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonRepo } from '../src/repo/json-repo.ts';
import { InsufficientStock } from '../src/repo/index.ts';
import type { Product } from '../src/types.ts';

let dir: string;
let repo: JsonRepo;

const now = new Date().toISOString();
function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', slug: 'test-jhumka', title: 'Test Jhumka', category: 'jhumka',
    tagline: 't', description: 'd', material: 'brass', finish: 'oxidised',
    details: {}, images: [], tags: ['jhumka'], featured: false, status: 'active',
    variants: [{ sku: 'T-1', label: 'Small', price: 49900, stock: 5 }],
    createdAt: now, updatedAt: now, ...over,
  };
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'oxj-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'categories.json'), JSON.stringify([
    { slug: 'jhumka', name: 'Jhumka', description: '', sortOrder: 1 },
  ]));
  // One file per product, as the repo now stores them.
  mkdirSync(join(dir, 'data', 'products'), { recursive: true });
  for (const p of [
    product(),
    product({ id: 'p2', slug: 'cheap-ring', title: 'Cheap Ring', category: 'rings', tags: ['ring'],
      variants: [{ sku: 'R-1', label: 'One size', price: 19900, stock: 50 }] }),
    product({ id: 'p3', slug: 'hidden', title: 'Draft Piece', status: 'draft',
      variants: [{ sku: 'D-1', label: 'x', price: 99900, stock: 1 }] }),
  ]) {
    writeFileSync(join(dir, 'data', 'products', `${p.slug}.json`), JSON.stringify(p));
  }
  writeFileSync(join(dir, 'data', 'orders.json'), '[]');
  repo = new JsonRepo(dir);
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('drafts stay out of the storefront', async () => {
  const page = await repo.listProducts({});
  assert.equal(page.total, 2);
  assert.ok(!page.items.some((p) => p.status === 'draft'));
  const withDrafts = await repo.listProducts({ includeDrafts: true });
  assert.equal(withDrafts.total, 3);
});

test('filtering by category and search', async () => {
  assert.equal((await repo.listProducts({ category: 'jhumka' })).total, 1);
  assert.equal((await repo.listProducts({ search: 'ring' })).total, 1);
  assert.equal((await repo.listProducts({ search: 'nothing here' })).total, 0);
});

test('sorting uses the lowest variant price', async () => {
  const asc = await repo.listProducts({ sort: 'price-asc' });
  assert.equal(asc.items[0]!.slug, 'cheap-ring');
  const desc = await repo.listProducts({ sort: 'price-desc' });
  assert.equal(desc.items[0]!.slug, 'test-jhumka');
});

test('a product is reachable by slug and by id', async () => {
  assert.equal((await repo.getProduct('test-jhumka'))?.id, 'p1');
  assert.equal((await repo.getProduct('p1'))?.slug, 'test-jhumka');
  assert.equal(await repo.getProduct('no-such-thing'), null);
});

test('price bounds ignore drafts', async () => {
  const b = await repo.priceBounds();
  assert.equal(b.min, 19900);
  assert.equal(b.max, 49900);   // not the 99900 draft
});

test('placing an order takes the stock down', async () => {
  await repo.createOrder({
    id: 'o1', reference: 'OXJ-TEST-0001',
    lines: [{ sku: 'T-1', productId: 'p1', title: 'Test Jhumka', variantLabel: 'Small', unitPrice: 49900, quantity: 2 }],
    subtotal: 99800, shipping: 0, taxRate: 0.18, tax: 17964, total: 117764,
    customer: { name: 'A', email: 'a@b.com', phone: '9999999999' },
    address: { line1: 'x', city: 'Nagpur', state: 'MH', pincode: '440001' },
    status: 'pending', createdAt: now,
  });
  const p = await repo.getProduct('p1');
  assert.equal(p!.variants[0]!.stock, 3, '5 less 2');
  assert.equal((await repo.getOrder('OXJ-TEST-0001'))!.total, 117764);
});

test('paging reports the right shape', async () => {
  const page = await repo.listProducts({ perPage: 1, page: 2 });
  assert.equal(page.items.length, 1);
  assert.equal(page.pages, 2);
  assert.equal(page.perPage, 1);
});

test('an update does not let the id be overwritten', async () => {
  const updated = await repo.updateProduct('p2', { title: 'Renamed', id: 'hacked' } as never);
  assert.equal(updated!.id, 'p2');
  assert.equal(updated!.title, 'Renamed');
});

test('each product is its own file, and a rename moves it', async () => {
  const { existsSync } = await import('node:fs');
  const file = (slug: string) => join(dir, 'data', 'products', `${slug}.json`);
  assert.ok(existsSync(file('cheap-ring')));

  await repo.updateProduct('p2', { slug: 'renamed-ring' });
  assert.ok(existsSync(file('renamed-ring')), 'new file written');
  assert.ok(!existsSync(file('cheap-ring')), 'old file removed');
  assert.equal((await repo.getProduct('renamed-ring'))?.id, 'p2');

  await repo.deleteProduct('p2');
  assert.ok(!existsSync(file('renamed-ring')));
});

test('renaming a slug moves image and swatch paths together', async () => {
  await repo.createProduct(product({
    id: 'p-sw', slug: 'old-name', title: 'Swatched',
    images: [{ path: 'old-name/01.webp', alt: 'a' }],
    variants: [
      { sku: 'S-1', label: 'Gold', price: 10000, stock: 1, swatch: 'old-name/swatch/gold.webp' },
      { sku: 'S-2', label: 'Silver', price: 10000, stock: 1 },
    ],
  }));
  const after = await repo.updateProduct('p-sw', {
    slug: 'new-name',
    images: [{ path: 'new-name/01.webp', alt: 'a' }],
    variants: [
      { sku: 'S-1', label: 'Gold', price: 10000, stock: 1, swatch: 'new-name/swatch/gold.webp' },
      { sku: 'S-2', label: 'Silver', price: 10000, stock: 1 },
    ],
  });
  // A swatch left pointing at the old folder is a broken image on a page whose
  // gallery still looks fine, so nothing tells you it happened.
  assert.ok(!JSON.stringify(after).includes('old-name'), 'a path still points at the old slug');
});

test('a SKU is found past the first page of the catalogue', async () => {
  // Pricing a cart used to page the catalogue with perPage 100 and search the
  // page in memory, so a valid SKU on the 101st product read as unknown.
  for (let i = 0; i < 120; i++) {
    await repo.createProduct(product({
      id: `p-bulk-${i}`, slug: `bulk-${i}`, title: `Bulk ${i}`,
      variants: [{ sku: `BULK-${i}`, label: 'One', price: 10000 + i, stock: 3 }],
    }));
  }
  const hit = await repo.getVariantBySku('BULK-119');
  assert.ok(hit, 'the 120th product should be reachable by SKU');
  assert.equal(hit.product.slug, 'bulk-119');
  assert.equal(hit.variant.price, 10119);
  assert.equal(await repo.getVariantBySku('NOPE-1'), null);
  for (let i = 0; i < 120; i++) await repo.deleteProduct(`p-bulk-${i}`);
});

test('an order cannot take more stock than exists', async () => {
  await repo.createProduct(product({
    id: 'p-last', slug: 'last-one', title: 'Last One',
    variants: [{ sku: 'LAST-1', label: 'Only', price: 50000, stock: 1 }],
  }));
  const line = {
    sku: 'LAST-1', productId: 'p-last', title: 'Last One', variantLabel: 'Only',
    unitPrice: 50000, quantity: 1,
  };
  const order = (ref: string) => ({
    id: ref, reference: ref, lines: [line], subtotal: 50000, shipping: 0,
    taxRate: 0.18, tax: 9000, total: 59000,
    customer: { name: 'A', email: 'a@b.c', phone: '9' },
    address: { line1: 'x', city: 'y', state: 'z', pincode: '110001' },
    status: 'pending' as const, createdAt: now,
  });

  await repo.createOrder(order('OXJ-1'));
  // Both buyers quoted while stock was 1. The second must not succeed.
  await assert.rejects(() => repo.createOrder(order('OXJ-2')), (e) => {
    assert.ok(e instanceof InsufficientStock);
    assert.equal(e.available, 0);
    assert.equal(e.sku, 'LAST-1');
    return true;
  });

  const after = await repo.getProduct('p-last');
  assert.equal(after?.variants[0]?.stock, 0, 'stock must not go negative');
  const orders = await repo.listOrders();
  assert.equal(orders.filter((o) => o.reference === 'OXJ-2').length, 0,
    'the refused order must not be recorded');
  await repo.deleteProduct('p-last');
});

test('one dead cart line does not take the whole cart down', async () => {
  await repo.createProduct(product({
    id: 'p-live', slug: 'still-here', title: 'Still Here',
    variants: [{ sku: 'LIVE-1', label: 'One', price: 50000, stock: 4 }],
  }));
  await repo.createProduct(product({
    id: 'p-out', slug: 'sold-out', title: 'Sold Out',
    variants: [{ sku: 'OUT-1', label: 'One', price: 50000, stock: 0 }],
  }));

  // A SKU renamed by --resku, a variant that sold out, and a good one.
  assert.equal(await repo.getVariantBySku('EAR-WOM-GOLD'), null, 'the stale SKU is gone');
  const live = await repo.getVariantBySku('LIVE-1');
  assert.ok(live, 'the good line must still resolve');
  const out = await repo.getVariantBySku('OUT-1');
  assert.equal(out?.variant.stock, 0, 'and the sold-out one is findable but empty');

  await repo.deleteProduct('p-live');
  await repo.deleteProduct('p-out');
});

test('a malformed file does not take the catalogue down', async () => {
  const { writeFileSync: w, rmSync } = await import('node:fs');
  const bad = join(dir, 'data', 'products', 'broken.json');
  w(bad, '{ not json');
  const page = await repo.listProducts({ includeDrafts: true });
  assert.ok(page.total >= 1, 'the readable products still load');
  rmSync(bad);
});
