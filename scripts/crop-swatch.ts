import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import { ROOT } from '../src/config.ts';
import { products } from '../src/lib/catalogue.ts';
import { cropInset, resize, imageSizeOf, SWATCH_CHIP_WIDTHS, widthVariantPath } from '../src/lib/resize.ts';

/**
 * Crops the supplier's spec overlay off a swatch.
 *
 *   npm run swatch:crop -- --slug stone-set-drops --variant "Leaf Drop, Blue" --inset 12
 *   npm run swatch:crop -- --slug stone-set-drops --all --inset 12 --dry-run
 *
 * A swatch doubles as the hero image, so "Wt: 8.40g/0.29oz/pair" and a set of
 * dimension arrows stop being invisible the moment someone clicks the
 * colourway. The piece is centred in these photographs and the text sits at
 * the edges, so an even inset removes it.
 *
 * This is a repair, not a substitute for your own photography — it throws away
 * real pixels. Re-running `swatches` restores the original.
 */
const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf('--' + k);
  return i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const every = (k: string) => argv.reduce<string[]>(
  (a, x, i) => (x === '--' + k && argv[i + 1] ? [...a, argv[i + 1]!] : a), []);
const dryRun = argv.includes('--dry-run');

const slug = flag('slug');
const inset = Number(flag('inset') ?? 12);
if (!slug) {
  console.error('\n  usage: npm run swatch:crop -- --slug <slug> (--variant "<label>" | --all) [--inset 12] [--dry-run]\n');
  process.exit(1);
}
const product = products.get((p) => p.slug === slug || p.id === slug);
if (!product) { console.error(`\n  no product "${slug}"\n`); process.exit(1); }

const wanted = every('variant');
const targets = argv.includes('--all')
  ? product.variants.filter((v) => v.swatch)
  : product.variants.filter((v) => v.swatch && wanted.includes(v.label));

if (targets.length === 0) {
  console.error(`\n  no matching variant with a swatch. This product has:\n`);
  for (const v of product.variants) console.error(`    ${v.label}`);
  console.error('');
  process.exit(1);
}

console.log(`\n  ${product.title} — cropping ${inset}% off each edge\n`);
for (const v of targets) {
  const rel = v.swatch!;
  const file = join(ROOT, 'public', 'images', rel);
  if (!existsSync(file)) { console.warn(`  skip (missing) ${v.label}`); continue; }
  const ext = extname(rel).toLowerCase();
  const buf = readFileSync(file);
  const before = imageSizeOf(buf);
  const cropped = cropInset(buf, inset, ext);
  if (!cropped) { console.warn(`  skip (could not crop) ${v.label}`); continue; }
  const after = imageSizeOf(cropped);
  console.log(`  ${v.label.padEnd(26)}${before?.width}×${before?.height} → ${after?.width}×${after?.height}`
    + `  ${(buf.length / 1024).toFixed(0)} kB → ${(cropped.length / 1024).toFixed(0)} kB`);
  if (dryRun) continue;
  writeFileSync(file, cropped);
  // The chips are cut from the swatch, so they have to be cut again.
  for (const w of SWATCH_CHIP_WIDTHS) {
    const chip = resize(cropped, w, ext);
    const target = join(ROOT, 'public', 'images', widthVariantPath(rel, w));
    if (chip) writeFileSync(target, chip);
    else if (existsSync(target)) unlinkSync(target);
  }
}

console.log(dryRun ? '\n  --dry-run, nothing changed\n' : `\n  ${targets.length} swatch(es) cropped\n`);
