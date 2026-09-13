import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDay, fold, totals, dayKey, pageKey, type Incoming } from '../src/lib/analytics.ts';

const known = (s: string) => s === 'wedding-kada' || s === 'bell-jhumka';
const roll = (events: Incoming[]) => fold(emptyDay('2026-09-13'), events, known);

test('a day is counters, and folding never mutates the day it was given', () => {
  const before = emptyDay('2026-09-13');
  const after = roll([{ t: 'page', path: '/', first: true }]);
  assert.equal(before.sessions, 0);
  assert.equal(after.sessions, 1);
  assert.equal(after.pages['/']!.views, 1);
  assert.equal(after.pages['/']!.entries, 1);
});

test('a slug that is not in the catalogue cannot create a key', () => {
  const day = roll([
    { t: 'product', slug: 'wedding-kada' },
    { t: 'product', slug: '../../etc/passwd' },
    { t: 'product', slug: 'made-up-slug' },
  ]);
  assert.deepEqual(Object.keys(day.products), ['wedding-kada']);
});

test('an event name outside the allow-list is dropped whole', () => {
  const day = roll([{ t: 'purchase' as never, slug: 'wedding-kada' }]);
  assert.deepEqual(day.products, {});
  assert.equal(day.sessions, 0);
});

test('a browser cannot report revenue', () => {
  // There is no client event that touches orders, units or revenue at all.
  const day = roll([
    { t: 'add', slug: 'wedding-kada' },
    { t: 'checkout', slug: 'wedding-kada' },
  ]);
  const p = day.products['wedding-kada']!;
  assert.equal(p.adds, 1);
  assert.equal(p.checkouts, 1);
  assert.equal(p.orders, 0);
  assert.equal(p.revenue, 0);
});

test('only the first event of a visit counts as a visit', () => {
  const day = roll([
    { t: 'page', path: '/', first: true },
    { t: 'page', path: '/product.html' },
    { t: 'page', path: '/checkout.html' },
  ]);
  assert.equal(day.sessions, 1);
  assert.equal(day.pages['/product.html']!.views, 1);
  assert.equal(day.pages['/product.html']!.entries, 0, 'a second page is not an entry');
});

test('a search that found nothing is counted separately from one that did', () => {
  const day = roll([
    { t: 'search', q: 'Pearl' },
    { t: 'search', q: 'pearl' },
    { t: 'search', q: 'kundan', empty: true },
  ]);
  assert.deepEqual(day.searches['pearl'], { count: 2, empty: 0 }, 'case is folded');
  assert.deepEqual(day.searches['kundan'], { count: 1, empty: 1 });
});

test('totals roll days together and compute the rate that matters', () => {
  const a = roll([{ t: 'product', slug: 'wedding-kada' }, { t: 'product', slug: 'wedding-kada' }]);
  const b = roll([{ t: 'product', slug: 'wedding-kada' }, { t: 'add', slug: 'wedding-kada' }]);
  const t = totals([a, b]);
  const kada = t.products.find((p) => p.slug === 'wedding-kada')!;
  assert.equal(kada.views, 3);
  assert.equal(kada.adds, 1);
  assert.equal(kada.addRate, 33.3);
  assert.equal(kada.buyRate, 0);
});

test('a day with no traffic divides by nothing rather than by zero', () => {
  const t = totals([emptyDay('2026-09-13')]);
  assert.equal(t.sessions, 0);
  assert.deepEqual(t.products, []);
  assert.equal(t.revenue, 0);
});

test('the day boundary is the shop\'s, not UTC\'s', () => {
  // 20:00 UTC on the 13th is already 01:30 on the 14th in Kolkata, and a sale
  // at that hour belongs to the day the shop was having.
  const at = new Date('2026-09-13T20:00:00Z');
  assert.equal(dayKey(at, 'Asia/Kolkata'), '2026-09-14');
  assert.equal(dayKey(at, 'UTC'), '2026-09-13');
});

test('a path we do not serve cannot create its own key', () => {
  // A browser sends the path, so a scanner probing /wp-admin a thousand times
  // must not put a thousand keys in the day file.
  const day = roll([
    { t: 'page', path: '/' },
    { t: 'page', path: '/wp-admin' },
    { t: 'page', path: '/nonsense-123' },
    { t: 'page', path: '/privacy.html' },
  ]);
  assert.deepEqual(Object.keys(day.pages).sort(), ['/', '/other', '/privacy.html']);
  assert.equal(day.pages['/other']!.views, 2, 'both probes fold into one key');
  assert.equal(pageKey('/index.html'), '/', 'the same page under two names is one row');
});
