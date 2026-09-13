import { test } from 'node:test';
import assert from 'node:assert/strict';
import { here, watching, LIVE_FLOOR } from '../src/lib/live.ts';

/**
 * The counter sites most often invent. These tests exist to pin the properties
 * that make it countable rather than decorative.
 */
test('one tab is one person, however often it says so', () => {
  const slug = 'piece-a';
  assert.equal(here(slug, 'tab-1'), 1);
  assert.equal(here(slug, 'tab-1'), 1, 'a heartbeat is not a second visitor');
  assert.equal(here(slug, 'tab-1'), 1);
  assert.equal(here(slug, 'tab-2'), 2);
  assert.equal(watching(slug), 2);
});

test('presence is per piece, not per shop', () => {
  here('piece-b', 'x');
  here('piece-c', 'y');
  here('piece-c', 'z');
  assert.equal(watching('piece-b'), 1);
  assert.equal(watching('piece-c'), 2);
  assert.equal(watching('piece-nobody-opened'), 0);
});

test('the floor is two, because the one is you', () => {
  // "1 person is looking at this" on a page you are looking at is a shop
  // telling you about yourself.
  assert.equal(LIVE_FLOOR, 2);
});

test('a visit that stops saying it is here drops out', async (t) => {
  // The window is 90s, so rather than waiting, check the shape: a token that
  // never beats again is not counted forever — `here` prunes on every call.
  const slug = 'piece-d';
  here(slug, 'old');
  assert.equal(watching(slug), 1);

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 120_000 });
  assert.equal(watching(slug), 0, 'gone from the count after the window');
  assert.equal(here(slug, 'new'), 1, 'and pruned from the map, not just hidden');
  t.mock.timers.reset();
});
