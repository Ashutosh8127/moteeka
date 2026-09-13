import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payload } from '../src/lib/notify.ts';
import type { Order } from '../src/types.ts';

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1', reference: 'OXJ-260913-AAAA',
  lines: [
    { sku: 'A-1', productId: 'p1', title: 'Zirconia Tennis Anklet', variantLabel: 'Gold', unitPrice: 82900, quantity: 2 },
    { sku: 'B-1', productId: 'p2', title: 'Bell Jhumka', variantLabel: 'Silver', unitPrice: 84900, quantity: 1 },
  ],
  subtotal: 250700, shipping: 0, taxRate: 0.18, tax: 45126, total: 295826,
  customer: { name: 'A Buyer', email: 'a@example.com', phone: '+919876543210' },
  address: { line1: '12 Road', line2: 'Near the market', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
  status: 'pending', createdAt: '2026-09-13T09:00:00.000Z', ...over,
});

test('the webhook carries everything needed to act on an order', () => {
  const p = payload(order(), 'https://shop.example');
  // Flat on purpose: a no-code tool maps fields, it does not walk a tree.
  for (const k of ['reference', 'total', 'customerName', 'customerPhone', 'address', 'trackUrl']) {
    assert.ok(k in p, `missing ${k}`);
    assert.notEqual((p as Record<string, unknown>)[k], undefined);
  }
  assert.equal(p.itemCount, 3, 'quantities, not line count');
  assert.equal(p.address, '12 Road, Near the market, Pune, Maharashtra, 411001');
});

test('the track link is the one the customer is told to keep', () => {
  const p = payload(order(), 'https://shop.example');
  assert.equal(p.trackUrl, 'https://shop.example/order.html?ref=OXJ-260913-AAAA');
});

test('money crosses as a decimal string, not paise', () => {
  // A webhook lands in a spreadsheet or a message. 295826 in a WhatsApp alert
  // reads as three lakh rupees.
  const p = payload(order(), 'https://shop.example');
  assert.equal(p.total, '2958.26');
  assert.match(p.message, /₹2,958/);
});

test('the ready-made message names the order, the money and who to call', () => {
  const p = payload(order(), 'https://shop.example');
  assert.match(p.message, /OXJ-260913-AAAA/);
  assert.match(p.message, /A Buyer/);
  assert.match(p.message, /\+919876543210/);
  assert.match(p.message, /2× Zirconia Tennis Anklet/);
});

test('an address with no second line does not leave a double comma', () => {
  const p = payload(order({
    address: { line1: '9 Lane', city: 'Nashik', state: 'Maharashtra', pincode: '422001' },
  }), 'https://shop.example');
  assert.equal(p.address, '9 Lane, Nashik, Maharashtra, 422001');
});
