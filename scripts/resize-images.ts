import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extname } from 'node:path';
import { ROOT } from '../src/config.ts';
import { products } from '../src/lib/catalogue.ts';
import { resize, findResizer, resizerName, GALLERY_WIDTHS, SWATCH_WIDTH, SWATCH_CHIP_WIDTHS, widthVariantPath } from '../src/lib/resize.ts';
import type { Product } from '../src/types.ts';

/**
 * Backfill responsive sizes for images imported before they were generated.
 *
 *   npm run images:resize              every product
 *   npm run images:resize -- --slug x  one
 *   npm run images:resize -- --dry-run what it would save
 *
 * Gallery photographs gain 400/800/1200px siblings and the product records
 * which exist, so the storefront can emit a srcset. Swatches are rewritten in
 * place at 320px, because they are drawn at 68 and nothing is gained by
 * sending more.
 */
const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf('--' + k);
  return i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const dryRun = argv.includes('--dry-run');

if (!findResizer()) {
  console.error(`\n  ${resizerName()}\n`);
  process.exit(1);
}

const only = flag('slug');
const targets = only
  ? products.all().filter((p) => p.slug === only || p.id === only)
  : products.all();
if (targets.length === 0) { console.error(`\n  no product "${only}"\n`); process.exit(1); }

const IMAGES = join(ROOT, 'public', 'images');
const kb = (n: number) => (n / 1024).toFixed(0).padStart(5);
let before = 0, after = 0, written = 0;

for (const p of targets) {
  const lines: string[] = [];
  const images: Product['images'] = [];

  for (const im of p.images) {
    const file = join(IMAGES, im.path);
    if (!existsSync(file)) { images.push(im); continue; }
    const buf = readFileSync(file);
    const ext = extname(im.path).toLowerCase();
    const made: number[] = [];
    let smallest = buf.length;

    for (const w of GALLERY_WIDTHS) {
      const target = join(IMAGES, widthVariantPath(im.path, w));
      if (existsSync(target)) { made.push(w); smallest = Math.min(smallest, statSync(target).size); continue; }
      const small = resize(buf, w, ext);
      if (!small) continue;
      if (!dryRun) writeFileSync(target, small);
      made.push(w);
      smallest = Math.min(smallest, small.length);
      written++;
    }
    // What the page actually sends is the smallest size the layout asks for,
    // so that is the number worth comparing against.
    before += buf.length;
    after += smallest;
    images.push(made.length ? { ...im, widths: made } : im);
    lines.push(`    ${im.path.split('/').pop()!.padEnd(16)}${kb(buf.length)} kB → ${kb(smallest)} kB  (${made.join('/') || 'no change'})`);
  }

  const variants = p.variants.map((v) => {
    if (!v.swatch) return v;
    const file = join(IMAGES, v.swatch);
    if (!existsSync(file)) return v;
    const buf = readFileSync(file);
    const ext = extname(v.swatch).toLowerCase();
    const small = resize(buf, SWATCH_WIDTH, ext);
    const full = small ?? buf;
    if (small && !dryRun) writeFileSync(file, small);
    if (small) written++;

    // The chip is what the page draws nine of, so that is the size that counts
    // towards the page weight; the full file is only fetched on a click.
    let chipSize = full.length;
    for (const w of SWATCH_CHIP_WIDTHS) {
      const target = join(IMAGES, widthVariantPath(v.swatch, w));
      const chip = existsSync(target) ? readFileSync(target) : resize(full, w, ext);
      if (!chip) continue;
      if (!existsSync(target) && !dryRun) { writeFileSync(target, chip); written++; }
      chipSize = Math.min(chipSize, chip.length);
    }
    before += buf.length;
    after += chipSize;
    lines.push(`    ${('swatch ' + v.label).padEnd(24).slice(0, 24)}${kb(buf.length)} kB → ${kb(chipSize)} kB chip`);
    return v;
  });

  if (lines.length === 0) continue;
  console.log(`\n  ${p.title}`);
  for (const l of lines) console.log(l);
  if (!dryRun) products.put({ ...p, images, variants });
}

console.log(`\n  ${written} file(s) ${dryRun ? 'would be ' : ''}written`);
console.log(`  a product page's images: ${kb(before)} kB → ${kb(after)} kB`
  + `  (${before ? (100 - (after / before) * 100).toFixed(0) : 0}% lighter)`);
if (dryRun) console.log('  --dry-run, nothing changed');
console.log('');
