import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLive, priceAfter, withDiscount, discountLabel } from '../src/lib/discount.ts';
import type { Product } from '../src/types.ts';

const now = new Date('2026-09-13T12:00:00Z');
const piece = (over: Partial<Product> = {}): Product => ({
  id: 'p1', slug: 'a-piece', title: 'A Piece', category: 'jhumka',
  tagline: '', description: '', material: '', finish: '',
  details: {}, images: [], tags: [], featured: false, status: 'active',
  variants: [
    { sku: 'A', label: 'One', price: 121900, stock: 5 },
    { sku: 'B', label: 'Two', price: 110900, stock: 2 },
  ],
  createdAt: now.toISOString(), updatedAt: now.toISOString(), ...over,
});

test('the struck-through price is the stored list price, never a typed-in one', () => {
  // The whole legal position rests on this: a Discount has no field for a
  // reference price, so there is no way to publish one that was never charged.
  const p = withDiscount(piece({ discount: { pct: 15 } }), now);
  assert.equal(p.variants[0]!.compareAt, 121900, 'compareAt is the list price');
  assert.equal(p.variants[0]!.price, 103600);
});

test('applying it twice does not discount twice', () => {
  const once = withDiscount(piece({ discount: { pct: 15 } }), now);
  const twice = withDiscount(once, now);
  assert.deepEqual(twice.variants, once.variants);
});

test('a sale price rounds down, so the discount is never smaller than advertised', () => {
  // 20% off ₹1,219 is ₹975.20. Rounding up would charge more than 20% off.
  assert.equal(priceAfter(121900, { pct: 20 }), 97500);
  const off = 121900 - priceAfter(121900, { pct: 20 });
  assert.ok(off / 121900 >= 0.20, 'at least the advertised percentage');
});

test('a discount cannot raise a price or take it below zero', () => {
  assert.equal(priceAfter(10000, { pct: -50 }), 10000, 'a negative percentage is a typo');
  assert.equal(priceAfter(10000, { amountPaise: -500 }), 10000);
  assert.equal(priceAfter(10000, { amountPaise: 999999 }), 0);
});

test('a sale that has not started does not show, and one that has ended stops on its own', () => {
  assert.equal(isLive({ pct: 10, startsAt: '2026-10-01' }, now), false);
  assert.equal(isLive({ pct: 10, endsAt: '2026-09-01' }, now), false);
  assert.equal(isLive({ pct: 10, startsAt: '2026-09-01', endsAt: '2026-09-30' }, now), true);
  assert.equal(isLive(undefined, now), false);
  assert.equal(isLive({ label: 'empty' }, now), false, 'no percentage and no amount is not a sale');
});

test('the last day of a sale is a sale day', () => {
  // "Ends 13 September" has to include the 13th, or every sale is a day short.
  const lateOnTheLastDay = new Date('2026-09-13T23:30:00+05:30');
  assert.equal(isLive({ pct: 10, endsAt: '2026-09-13' }, lateOnTheLastDay), true);
  assert.equal(isLive({ pct: 10, endsAt: '2026-09-13' }, new Date('2026-09-15T00:00:00Z')), false);
});

test('a product with no live discount comes back untouched', () => {
  const p = piece({ discount: { pct: 20, startsAt: '2027-01-01' } });
  assert.equal(withDiscount(p, now), p, 'the same object, not a copy');
  assert.equal(withDiscount(p, now).variants[0]!.compareAt, undefined);
});

test('the label says what it is', () => {
  assert.equal(discountLabel({ pct: 15 }), '15% off');
  assert.equal(discountLabel({ amountPaise: 20000 }), '₹200 off');
  assert.equal(discountLabel({ pct: 15, label: 'Diwali' }), 'Diwali · 15% off');
});
