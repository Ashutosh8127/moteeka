import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, displayDetails, facts, visibleDetails } from '../src/lib/describe.ts';

const product = (over: Record<string, unknown> = {}) => ({
  slug: 'a-piece', title: 'Gold-Plated Drop Earrings', category: 'earrings',
  material: 'Copper Alloy', finish: 'Gold Plated',
  details: {} as Record<string, string>,
  variants: [{ sku: 'X', label: 'Gold', price: 1, stock: 1 }],
  ...over,
} as never);

test('a listing that names five occasions has named none', () => {
  const spam = facts(product({
    details: { Occasion: 'Other, Anniversary, Engagement, Gift, Wedding, Party, Prom' },
  }));
  assert.equal(spam.occasionSpam, true);
  assert.ok(!describe(product({
    details: { Occasion: 'Other, Anniversary, Engagement, Gift, Wedding, Party, Prom' },
  })).description.includes('made for'));

  // Two is a statement about the piece, and it gets said.
  const real = describe(product({ details: { Occasion: 'Wedding, Party' } }));
  assert.match(real.description, /weddings and parties/);
});

test('a plural noun does not take a singular article', () => {
  // The opening sentence varies by slug, so check every form it can take.
  const seen = new Set<string>();
  for (const slug of ['a-piece', 'b-piece', 'c-piece', 'tassel-earrings', 'drop-earrings']) {
    const copy = describe(product({ slug, details: { 'Jewelry Type': 'Earrings' } }));
    assert.ok(!/\ba earrings/i.test(copy.description), copy.description);
    seen.add(copy.description.split('.')[0]!);
  }
  // …and that the pair form is one of them, rather than every form dodging it.
  assert.ok([...seen].some((s) => s.startsWith('A pair of')), [...seen].join(' | '));
});

test('never claims a piece is unplated just because the listing was silent', () => {
  const copy = describe(product({ finish: '', details: { 'Jewelry Main Material': 'Alloy' } }));
  assert.ok(!/unplated|no plating/i.test(copy.description), copy.description);
});

test('the specific plating wins over the generic one it contains', () => {
  const rose = facts(product({ finish: 'Rose Gold Plated' }));
  assert.deepEqual(rose.platings, ['rose gold']);
  // A listing offering both still gets both.
  const both = facts(product({ finish: '18K Gold Plated, Rose Gold Plated' }));
  assert.deepEqual(both.platings.sort(), ['gold', 'rose gold']);
  const oxidised = facts(product({ finish: 'Oxidised Silver' }));
  assert.deepEqual(oxidised.platings, ['oxidised silver']);
});

test('options are only called colourways when each one is photographed', () => {
  const plain = describe(product({
    variants: [{ sku: 'A', label: 'One' }, { sku: 'B', label: 'Two' }],
  }));
  assert.match(plain.description, /two options/);
  const shot = describe(product({
    variants: [{ sku: 'A', label: 'One', swatch: 'a/1.jpg' }, { sku: 'B', label: 'Two', swatch: 'a/2.jpg' }],
  }));
  assert.match(shot.description, /two colourways/);
});

test('the same product is described the same way every time', () => {
  const p = product({ details: { 'Main Stone': 'ZIRCON', 'Diamond shape': 'Pear Cut' } });
  assert.equal(describe(p).description, describe(p).description);
});

test('a supplier attribute a customer must never see is dropped', () => {
  const rows = visibleDetails({
    CN: 'Zhejiang',
    'Factory Advantage': '10 Years Experience',
    'Place of Origin': 'China',
    Brand: 'Moteeka',
    'Main Stone': 'ZIRCON',
  });
  assert.deepEqual(rows, { 'Main Stone': 'Cubic zirconia' });
});

test('the stored keys stay the listing\'s own, so derivation keeps working', () => {
  // Renaming on the way into the data left deriveTitle and facts() reading
  // keys that no longer existed, and a second run wrote a worse description
  // than the first. The rename happens on the way out instead.
  const stored = { 'Main Stone': 'ZIRCON', 'Jewelry Type': 'Jewelry Sets' };
  const once = visibleDetails(stored);
  assert.deepEqual(visibleDetails(once), once, 'cleaning must be idempotent');
  assert.ok('Main Stone' in once);
  assert.equal(facts(product({ details: once })).stone, 'cubic zirconia');
});

test('a keyword-stuffed occasion field is not printed as a spec', () => {
  const spam = { Occasion: 'Other, Anniversary, Engagement, Gift, Wedding, Party, Prom' };
  assert.deepEqual(visibleDetails(spam), {});
  assert.deepEqual(visibleDetails({ Occasion: 'Wedding, Party' }), { Occasion: 'Wedding, Party' });
});

test('the table cannot contradict the two rows the page prints above it', () => {
  const rows = displayDetails(
    { 'Jewelry Main Material': 'Brass', 'Metal Color': 'Gold Plated' },
    { material: 'Copper Alloy', finish: 'Gold Plated' },
  );
  assert.deepEqual(rows, {});
});

test('a junk value costs more than a missing row', () => {
  assert.deepEqual(visibleDetails({
    'Inlay technology': '/', 'Pearl Type': 'none', 'Purity of precious metals': 'Null',
    Style: 'Vintage',
  }), { Style: 'Vintage' });
});

test('supplier keys are renamed to what a buyer would call them, on the way out', () => {
  const rows = displayDetails({ 'Jewelry Main Material': 'Brass', 'Shape / pattern': 'Water Drop' });
  assert.deepEqual(rows, { Metal: 'Brass', Shape: 'Water Drop' });
});

test('the listing\'s caps lock and American spelling do not reach the page', () => {
  assert.deepEqual(
    displayDetails({ 'Main Stone': 'ZIRCON', 'Jewelry Type': 'Jewelry Sets', 'Bracelets or Bangles Type': 'BANGLES' }),
    { Stone: 'Cubic zirconia', Type: 'Jewellery Sets' },
  );
});

test('tags carry the words a search would use, since every listing arrived with none', () => {
  const copy = describe(product({
    details: { 'Main Stone': 'ZIRCON', Occasion: 'Wedding', 'Shape / pattern': 'Water Drop' },
  }));
  assert.ok(copy.tags.includes('cubic zirconia'), copy.tags.join(','));
  assert.ok(copy.tags.includes('wedding'));
  assert.ok(copy.tags.includes('water drop'));
});
