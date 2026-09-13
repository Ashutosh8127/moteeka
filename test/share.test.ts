import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productShare } from '../src/lib/share.ts';
import type { Product } from '../src/types.ts';

const req = { protocol: 'https', get: (h: string) => (h === 'host' ? 'shop.example' : undefined) };

const piece = (over: Partial<Product> = {}): Product => ({
  id: 'p1', slug: 'a-piece', title: 'A Piece', category: 'anklets',
  tagline: 'Short line', description: 'A longer paragraph about the piece.',
  material: 'Brass', finish: 'Gold Plated', details: {},
  images: [{ path: 'a-piece/01.webp', alt: 'A Piece' }],
  variants: [{ sku: 'A-1', label: 'Gold', price: 82900, stock: 3 }],
  tags: [], featured: false, status: 'active',
  createdAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:00Z', ...over,
});

test('share images are absolute, because a card cannot follow a relative path', () => {
  const s = productShare(piece(), req, null);
  assert.equal(s.image, 'https://shop.example/images/a-piece/01.webp');
  assert.equal(s.url, 'https://shop.example/product.html?slug=a-piece');
});

test('the card leads with the price, because that is what a glance takes in', () => {
  assert.match(productShare(piece(), req, null).description, /₹829/);
});

test('structured data says out of stock when nothing is left', () => {
  const gone = productShare(piece({
    variants: [{ sku: 'A-1', label: 'Gold', price: 82900, stock: 0 }],
  }), req, null);
  const offers = (gone.jsonLd as { offers: { availability: string } }).offers;
  assert.match(offers.availability, /OutOfStock/);
});

test('no aggregateRating without real published reviews', () => {
  // Google issues manual actions for rich results built on ratings a shop does
  // not have. Absent is the only correct value here.
  assert.ok(!('aggregateRating' in (productShare(piece(), req, null).jsonLd ?? {})));
  const rated = productShare(piece(), req,
    { average: 4.5, count: 8, spread: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 5 } });
  const agg = (rated.jsonLd as { aggregateRating?: { ratingValue: number; reviewCount: number } }).aggregateRating;
  assert.equal(agg?.ratingValue, 4.5);
  assert.equal(agg?.reviewCount, 8);
});

test('a proxy header decides the origin, so the card works behind one', () => {
  const behind = { protocol: 'http', get: (h: string) =>
    (h === 'x-forwarded-host' ? 'moteeka.in' : h === 'x-forwarded-proto' ? 'https' : 'internal:8080') };
  assert.match(productShare(piece(), behind, null).url, /^https:\/\/moteeka\.in\//);
});
