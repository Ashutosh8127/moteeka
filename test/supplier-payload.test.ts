import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDetailData } from '../src/lib/supplier-payload.ts';

/** A listing shaped like the real ones: two dead axes and one that varies. */
function payload() {
  return {
    globalData: {
      sourceUrl: 'https://example.test/listing_1601927491404.html',
      seller: { companyName: 'Some Supplier', companyRegisterCountry: 'CN' },
      product: {
        productId: 1601927491404,
        subject: 'Africa Fashion Bracelets Set 24K Gold Plating Women Bangles',
        moq: 2,
        price: {
          unit: 'piece',
          productLadderPrices: [
            { min: 2, max: 19, dollarPrice: 2.4, price: 235 },
            { min: 20, max: -1, dollarPrice: 2.05, price: 201 },
          ],
        },
        sku: {
          skuAttrs: [
            { id: 1, name: 'Length', values: [{ id: -2, name: 'Standard' }] },
            { id: 2, name: 'Design', values: [{ id: -1, name: 'Fashion' }] },
            {
              id: 3,
              name: 'Color',
              values: [
                { id: -1, name: 'Design 1 One Piece', largeImage: 'https://cdn.test/a.jpg_250x250.jpg' },
                { id: -2, name: 'Design 2 One Piece', largeImage: 'https://cdn.test/b.jpg_250x250.jpg' },
              ],
            },
          ],
          skuInfoMap: {
            '1:-2;2:-1;3:-1;': { id: 11 },
            '1:-2;2:-1;3:-2;': { id: 12 },
          },
        },
        mediaItems: [{ group: 'photos', imageUrl: { big: 'https://cdn.test/p1.jpg' } }],
      },
    },
  };
}

test('an axis with one value is left out of the variant label', () => {
  const p = parseDetailData(payload())!;
  // Not "Standard / Fashion / Design 1 One Piece" — those two say nothing.
  assert.deepEqual(p.variants.map((v) => v.label), ['Design 1 One Piece', 'Design 2 One Piece']);
});

test('the label matches the swatch key, so swatches can attach', () => {
  const p = parseDetailData(payload())!;
  for (const v of p.variants) {
    assert.ok(p.swatches[v.label], `no swatch for "${v.label}"`);
    assert.equal(v.swatchUrl, p.swatches[v.label]);
  }
});

test('a thumbnail suffix is stripped off the swatch image', () => {
  const p = parseDetailData(payload())!;
  assert.equal(p.swatches['Design 1 One Piece'], 'https://cdn.test/a.jpg');
});

test('the source URL comes from the capture when none is passed', () => {
  assert.equal(parseDetailData(payload())!.url, 'https://example.test/listing_1601927491404.html');
  assert.equal(parseDetailData(payload(), 'https://override.test/x')!.url, 'https://override.test/x');
});

test('every axis is kept when they all vary', () => {
  const d = payload();
  const sku = d.globalData.product.sku as unknown as {
    skuAttrs: Array<{ values: Array<{ id: number; name: string }> }>;
    skuInfoMap: Record<string, { id: number }>;
  };
  sku.skuAttrs[0]!.values.push({ id: -3, name: 'Large' });
  sku.skuInfoMap = {
    '1:-2;2:-1;3:-1;': { id: 11 },
    '1:-3;2:-1;3:-2;': { id: 12 },
  };
  const p = parseDetailData(d)!;
  assert.deepEqual(p.variants.map((v) => v.label), ['Standard / Design 1 One Piece', 'Large / Design 2 One Piece']);
});
