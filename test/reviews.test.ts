import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rate, type Review } from '../src/lib/reviews.ts';

const review = (over: Partial<Review> = {}): Review => ({
  id: 'r1', slug: 'a-piece', reference: 'OXJ-260913-AAAA', rating: 5,
  name: 'A', createdAt: '2026-09-13T00:00:00Z', status: 'published', ...over,
});

test('a shop with no reviews shows no stars at all', () => {
  // Not zero stars, not five empty ones — nothing. Stars that appear before
  // anybody has bought anything are decoration, and a customer who works that
  // out has learned something about the shop that design does not recover.
  assert.equal(rate([]), null);
});

test('a pending review counts for nothing until somebody approves it', () => {
  assert.equal(rate([review({ status: 'pending' })]), null);
  assert.equal(rate([review({ status: 'rejected' })]), null);
  const mixed = rate([review(), review({ id: 'r2', rating: 1, status: 'pending' })]);
  assert.equal(mixed?.count, 1, 'only the published one');
  assert.equal(mixed?.average, 5, 'and the pending one does not drag it down');
});

test('the average is one decimal, and the spread adds up to the count', () => {
  const r = rate([
    review({ id: '1', rating: 5 }), review({ id: '2', rating: 4 }), review({ id: '3', rating: 4 }),
  ])!;
  // 13/3 = 4.333…; two decimals would imply a precision three reviews do not have.
  assert.equal(r.average, 4.3);
  assert.equal(r.count, 3);
  assert.equal(Object.values(r.spread).reduce((a, b) => a + b, 0), 3);
  assert.equal(r.spread[4], 2);
});

test('a rating outside 1-5 is clamped rather than trusted', () => {
  const r = rate([review({ id: '1', rating: 9 }), review({ id: '2', rating: 0 })])!;
  assert.equal(r.spread[5], 1);
  assert.equal(r.spread[1], 1);
  assert.equal(r.average, 3);
});
