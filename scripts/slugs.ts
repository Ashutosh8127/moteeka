import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
import { products as store, categories } from '../src/lib/catalogue.ts';
import { widthVariantPath } from '../src/lib/resize.ts';
import type { Product } from '../src/types.ts';

/**
 * The slugs `images:import --slug` and `product:add` will accept, and what a
 * visitor downloads to open each one.
 *
 * The weight column is the point: a product page that costs 4 MB is a page
 * most people on a phone leave before it renders, and if an ad sent them there
 * you paid for the click anyway. An image count cannot tell you that.
 */
const IMAGES = join(ROOT, 'public', 'images');
const sizeOf = (rel: string) => {
  const f = join(IMAGES, rel);
  return existsSync(f) ? statSync(f).size : 0;
};

/** Roughly what the product page fetches on load: hero, thumbnails, chips. */
function pageBytes(p: Product): { bytes: number; unsized: number } {
  let bytes = 0;
  let unsized = 0;
  const pick = (path: string, widths: number[] | undefined, want: number) => {
    const w = widths?.find((x) => x >= want) ?? widths?.at(-1);
    if (w === undefined) { unsized++; return sizeOf(path); }
    return sizeOf(widthVariantPath(path, w)) || sizeOf(path);
  };

  const [hero, ...rest] = p.images;
  const first = p.variants.find((v) => v.stock > 0) ?? p.variants[0];
  // A colourway is selected on load, so its photograph is the hero.
  if (first?.swatch) bytes += sizeOf(first.swatch);
  else if (hero) bytes += pick(hero.path, hero.widths, 800);
  for (const im of rest) bytes += pick(im.path, im.widths, 160);
  for (const v of p.variants) if (v.swatch) bytes += sizeOf(widthVariantPath(v.swatch, 160)) || sizeOf(v.swatch);
  return { bytes, unsized };
}

const products = store.all();
console.log(`\n  ${products.length} product(s)\n`);
console.log(`  ${'SLUG'.padEnd(42)}${'STATUS'.padEnd(9)}${'IMAGES'.padEnd(18)}PAGE WEIGHT`);

let heavy = 0;
let unsizedTotal = 0;
/*
 * A live product with no photograph. There are no stand-in images any more —
 * a piece nobody can see is a piece nobody buys, and it renders as a broken
 * image rather than as an obvious gap, so it has to be named here.
 */
const blind: string[] = [];
for (const p of products) {
  const real = p.images.length;
  if (real === 0 && p.status === 'active') blind.push(p.slug);
  const { bytes, unsized } = pageBytes(p);
  unsizedTotal += unsized;
  // A megabyte of images is roughly where a phone on 4G starts losing people.
  if (bytes > 1024 * 1024) heavy++;
  const weight = bytes ? `${(bytes / 1024).toFixed(0).padStart(5)} kB${bytes > 1024 * 1024 ? '  heavy' : ''}` : '';
  console.log(
    `  ${p.slug.padEnd(42)}${p.status.padEnd(9)}` +
    `${(real ? `${real} image(s)` : 'NO IMAGES').padEnd(18)}${weight}` +
    `${unsized ? `  ${unsized} unsized` : ''}`,
  );
}

/*
 * A product whose category no longer exists shows under "All pieces" and under
 * no category at all — visible enough to sell, invisible to anyone browsing.
 */
const known = new Set(categories.read().map((c) => c.slug));
const orphans = products.filter((p) => !known.has(p.category));
if (orphans.length) {
  console.log(`\n  ${orphans.length} product(s) in a category that no longer exists:`);
  for (const p of orphans) console.log(`    ${p.slug}  →  ${p.category}`);
  console.log(`  npm run edit -- <slug> --category <existing slug>`);
}
/*
 * Jewellery bought unseen is returned over fit more than over anything else,
 * and the costing model charges 18% for returns. A piece with no measurement
 * anywhere on its page is a return waiting to happen — and unlike the other
 * warnings here this one cannot be fixed by a script, because the number has
 * to come off the listing or a ruler.
 */
const MEASURES = ['Size', 'Length', 'Drop length', 'Weight', 'Weight per pair', 'Diameter'];
const unmeasured = products.filter((p) =>
  p.status === 'active' && !MEASURES.some((k) => p.details?.[k]));
if (unmeasured.length) {
  console.log(`\n  ${unmeasured.length} live piece(s) with no size or weight on the page`);
  console.log(`    ${unmeasured.slice(0, 8).map((p) => p.slug).join(', ')}${unmeasured.length > 8 ? ', …' : ''}`);
  console.log(`  npm run edit -- <slug> --detail "Size=20 cm + 8 cm extender"`);
}

if (blind.length) {
  console.log(`\n  ${blind.length} live product(s) with no photograph: ${blind.join(', ')}`);
  console.log(`  npm run images:import -- --slug <slug> --dir ./photos/<folder>`);
  console.log(`  or take them down:  npm run edit -- <slug> --status draft`);
}
if (unsizedTotal) {
  console.log(`\n  ${unsizedTotal} image(s) have no smaller sizes — npm run images:resize`);
}
if (heavy) {
  console.log(`  ${heavy} product page(s) over 1 MB of images`);
}
console.log(`\n  npm run images:import -- --slug <slug> --dir ./photos/<folder>\n`);
