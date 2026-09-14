import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limit } from '../src/lib/rate-limit.ts';

/**
 * The budget exists so a stranger cannot spend the shop's Firestore quota, so
 * what matters is that it refuses at the right point, tells the caller when to
 * come back, and counts each visitor separately.
 */
function call(mw: ReturnType<typeof limit>, ip: string) {
  const headers: Record<string, string> = {};
  let status = 0;
  let passed = false;
  const req = { get: (h: string) => (h.toLowerCase() === 'x-forwarded-for' ? ip : undefined), socket: {} };
  const res = {
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
    status(code: number) { status = code; return this; },
    json() { return this; },
  };
  mw(req as never, res as never, () => { passed = true; });
  return { passed, status, headers };
}

test('requests are allowed up to the budget and refused after it', () => {
  const mw = limit(`t-${Math.random()}`, { limit: 3, windowMs: 60_000 });
  assert.equal(call(mw, '1.1.1.1').passed, true);
  assert.equal(call(mw, '1.1.1.1').passed, true);
  assert.equal(call(mw, '1.1.1.1').passed, true);
  const fourth = call(mw, '1.1.1.1');
  assert.equal(fourth.passed, false);
  assert.equal(fourth.status, 429);
});

test('a refusal says when to come back, and is never cached', () => {
  const mw = limit(`t-${Math.random()}`, { limit: 1, windowMs: 60_000 });
  call(mw, '2.2.2.2');
  const blocked = call(mw, '2.2.2.2');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0, 'Retry-After should be a positive number of seconds');
  /*
   * A 429 stored by a shared cache would lock everyone behind that edge out
   * for the cache's lifetime rather than the window's.
   */
  assert.equal(blocked.headers['cache-control'], 'no-store');
});

test('one visitor running out does not block another', () => {
  const mw = limit(`t-${Math.random()}`, { limit: 1, windowMs: 60_000 });
  call(mw, '3.3.3.3');
  assert.equal(call(mw, '3.3.3.3').passed, false);
  assert.equal(call(mw, '4.4.4.4').passed, true, 'a second address has its own budget');
});

test('the window expires and the budget comes back', () => {
  const mw = limit(`t-${Math.random()}`, { limit: 1, windowMs: 1 });
  call(mw, '5.5.5.5');
  assert.equal(call(mw, '5.5.5.5').passed, false);
  const until = Date.now() + 10;
  while (Date.now() < until) { /* the window is a millisecond; wait it out */ }
  assert.equal(call(mw, '5.5.5.5').passed, true);
});

test('separate budgets do not share a counter', () => {
  const a = limit(`browse-${Math.random()}`, { limit: 1, windowMs: 60_000 });
  const b = limit(`write-${Math.random()}`, { limit: 1, windowMs: 60_000 });
  call(a, '6.6.6.6');
  assert.equal(call(a, '6.6.6.6').passed, false);
  assert.equal(call(b, '6.6.6.6').passed, true, 'browsing a lot must not stop somebody ordering');
});
