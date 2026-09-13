import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTitle, tidyVariantLabel, looksUnnamed } from '../src/lib/naming.ts';

const bangleAttrs = {
  'Jewelry Type': 'Bracelets, Bangles',
  'Bracelets or Bangles Type': 'BANGLES',
  'Material Type': 'Zinc Alloy',
  'Plating': '24K Gold Plated',
  'Occasion': 'Wedding',
};

test('a keyword-stuffed title becomes a short name', () => {
  const soup = 'Dubai Fashion Openable Bracelets Gift Jewelry 24K Gold Plating '
    + 'Ethiopia Bridal Saudi Arabia Design Indian Wedding Gifts Bangles';
  assert.equal(deriveTitle(bangleAttrs, soup).title, 'Gold-Plated Openable Bangle');
});

test('the occasion fills in only when nothing more specific is there', () => {
  const soup = 'Africa Fashion Bracelets Set Jewelry 24K Gold Plating Women Bangles';
  assert.equal(deriveTitle(bangleAttrs, soup).title, 'Gold-Plated Bridal Bangle');
});

test('oxidised silver is recognised over the gold rule', () => {
  const attrs = { 'Jewelry Type': 'Earrings', 'Plating': 'Antique Silver Oxidised' };
  assert.equal(deriveTitle(attrs, 'Ethnic Retro Carved Indian Jhumka Earrings').title,
    'Oxidised Carved Jhumka');
});

test('no plating attribute still gives a usable name', () => {
  assert.equal(deriveTitle({ 'Jewelry Type': 'Anklets' }, 'Ghungroo Payal Pair').title,
    'Ghungroo Anklet');
});

test('similar listings get names of their own', () => {
  // Four real listings from the same category. Every attribute they share —
  // oxidised, alloy, earrings, wedding — is the same, so the obvious name
  // collides on the second import and the slug grows a "-2".
  const attrs = {
    'Jewelry Type': 'Earrings', 'Plating': 'Gold Plated, Silver Plated, oxidized',
    'Material Type': 'Alloy', 'Occasion': 'Wedding',
  };
  const listings = [
    'Indian Jhumka Gypsy Jewelry Boho Vintage Ethnic Womens Earrings Hollow Dangle Hanging Earrings',
    'Vintage Multistyle Silver Jhumka Drop Dangle Ethnic Tribal Earrings Retro Bollywood Oxidized',
    "2024 Women's India Geometric Long Chain Tassel Hanging Dangle Drop Earrings Bohemia Bell Jhumka",
    'Indian Bollywood Oxidized Women Water Drop Earrings Juhmka Vintage Ethnic Carved Bell Tassel',
  ];
  const taken: string[] = [];
  for (const l of listings) taken.push(deriveTitle(attrs, l, 'Earrings', taken).title);
  assert.equal(new Set(taken).size, 4, `expected four distinct names, got ${taken.join(' / ')}`);
  for (const t of taken) assert.ok(/^Oxidised /.test(t), t);
});

test('the noun is never repeated as its own descriptor', () => {
  const attrs = { 'Jewelry Type': 'Earrings', 'Plating': 'oxidized' };
  const { title } = deriveTitle(attrs, 'Indian Jhumka Jhumka Earrings Jhumka', 'Jhumka');
  assert.ok(!/Jhumka Jhumka/.test(title), title);
});

test('a plural noun still names the thing', () => {
  // "Rings" against /\bring\b/ never matches, because "s" is a word character.
  // Four real products were imported as "Piece" before this was fixed.
  for (const [type, title, expect] of [
    ['Rings', 'Adjustable Rings For Women', 'Ring'],
    ['Anklets', 'Fashion Anklets For Woman', 'Anklet'],
    ['Earrings', 'Drop Earrings', 'Earrings'],
    ['Bracelets, Bangles', 'Bangles Bracelet', 'Bangle'],
  ] as const) {
    const { noun } = deriveTitle({ 'Jewelry Type': type }, title);
    assert.equal(noun, expect, `${type} should read as ${expect}`);
  }
});

test('a set is named after the set, not one of its parts', () => {
  // The title lists every component, and the noun list is ordered, so
  // "Bracelet" won over the declared type on a four-piece bridal set.
  const { title, noun } = deriveTitle(
    { 'Jewelry Type': 'Jewelry Sets', 'Plating': 'Silver Plated', 'Occasion': 'Wedding' },
    '4pcs Bridal Jewelry Set for Wedding Ring Earring Bracelets Necklace');
  assert.equal(noun, 'Jewellery Set');
  assert.ok(/Jewellery Set$/.test(title), title);
});

test('a plural descriptor is still found', () => {
  // "Bells" against /\bBell\b/ fails for the same reason "Rings" did.
  assert.ok(/Bell/.test(deriveTitle({ 'Jewelry Type': 'Earrings' },
    'Heart Shape Accessories Bells Indian Jewelry Earrings').title));
});

test('"Other" is not a finish', () => {
  // The listing's placeholder for an unfilled field, not a plating.
  const { finish } = deriveTitle({ 'Jewelry Type': 'Earrings', 'Plating': 'Other' }, 'Plain Earrings');
  assert.equal(finish, '');
});

test('nose jewellery is not a finger ring', () => {
  // "Nose Rings" matched the generic ring rule, and a no-piercing clip fell
  // through to "Piece" entirely.
  const cases: Array<[string, string, string]> = [
    ['Body Jewelry', 'Punk Nose Cuff Piercing Jewelry Petal', 'Nose Cuff'],
    ['Nose Rings', '18K Gold Plated Copper Nose Ring', 'Nose Pin'],
    ['Body Jewelry', 'Hot Sale No-piercing Nose Clip', 'Nose Clip'],
    ['Rings', 'Adjustable Cocktail Rings', 'Ring'],
  ];
  for (const [type, title, expect] of cases) {
    assert.equal(deriveTitle({ 'Jewelry Type': type }, title).noun, expect, title);
  }
});

test('a descriptor already inside the noun is dropped', () => {
  // "Cuff" beside a noun of "Nose Cuff" read "Gold-Plated Cuff Nose Cuff".
  const t = deriveTitle({ 'Jewelry Type': 'Body Jewelry', 'Plating': 'Gold Plated' },
    'Punk Nose Cuff Piercing Jewelry').title;
  assert.equal((t.match(/Cuff/g) ?? []).length, 1, t);
});

test('a word is never used twice in one name', () => {
  const t = deriveTitle(
    { 'Jewelry Type': 'Earrings', 'Plating': 'Rhodium Plated', 'Occasion': 'Wedding' },
    'Bridal Wedding Long Drop Earrings For Brides').title;
  assert.ok(!/(\b\w+\b).*\b\1\b/i.test(t), `"${t}" repeats a word`);
});

test('supplier variant codes are tidied, not invented', () => {
  assert.equal(tidyVariantLabel('Design 5 One Piece - Gold Color'), 'Pattern 5');
  assert.equal(tidyVariantLabel('Design 1 One Piece'), 'Pattern 1');
  assert.equal(tidyVariantLabel('Star Jaali'), 'Star Jaali');
  assert.equal(tidyVariantLabel('Silver'), 'Silver');
});

test('a tidied code is still flagged as unnamed', () => {
  assert.ok(looksUnnamed('Pattern 5'));
  assert.ok(looksUnnamed('Design 2'));
  assert.ok(!looksUnnamed('Star Jaali'));
  assert.ok(!looksUnnamed('Silver'));
});

test('supplier part numbers count as unnamed too', () => {
  for (const code of ['A-3', 'A-19', 'FX916-1', 'Gold3', 'Silver4', '7']) {
    assert.ok(looksUnnamed(code), `${code} should read as a code`);
  }
  // A measurement is a name — a bangle's real sizes are not supplier codes.
  for (const size of ['Size 2.4', 'Size 2.6', '18 in', '45 cm', 'Length 60mm']) {
    assert.ok(!looksUnnamed(size), `${size} should read as a name`);
  }
  for (const name of ['Rose Gold', 'Pearl Drop', 'Kundan', 'Star Jaali', '24-Piece Set']) {
    assert.ok(!looksUnnamed(name), `${name} should read as a name`);
  }
});
