import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
import { products as productStore } from '../src/lib/catalogue.ts';
import { imageSize } from '../src/lib/image-size.ts';
import { resize, SWATCH_WIDTH, SWATCH_CHIP_WIDTHS, widthVariantPath } from '../src/lib/resize.ts';
import type { Product, Variant } from '../src/types.ts';

/**
 * Downloads a photograph per colourway and attaches it to the matching variant.
 *
 *   npm run swatches -- --slug jhumka --from intake/1600303524801.json
 *   npm run swatches -- --slug jhumka --set "Navy Blue=https://…/x.jpg"
 *   npm run swatches -- --slug jhumka --from intake/x.json --add-missing
 *
 * A colour name tells a buyer very little — "Gold3" tells them nothing at all.
 * The swatch is what makes 23 colourways shoppable, so the product page shows
 * the picture and keeps the name for screen readers and the cart.
 *
 * --add-missing also creates variants for colourways the product does not have
 * yet, priced from the cheapest existing variant and with zero stock.
 */
const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf('--' + k);
  return i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const all = (k: string) => argv.reduce<string[]>((acc, a, i) => (a === '--' + k && argv[i + 1] ? [...acc, argv[i + 1]!] : acc), []);

const slug = flag('slug');
if (!slug) {
  console.error('\n  usage: npm run swatches -- --slug <product> (--from <intake.json> | --set "Colour=url") [--add-missing]\n');
  process.exit(1);
}

const store = productStore;
const product = store.get((p) => p.slug === slug || p.id === slug);
if (!product) {
  console.error(`\n  no product "${slug}". Available:\n`);
  for (const p of store.all()) console.error(`    ${p.slug}`);
  console.error('');
  process.exit(1);
}

// Sources: an intake file's _swatchUrls map, and/or --set pairs.
const map: Record<string, string> = {};
const from = flag('from');
if (from) {
  if (!existsSync(from)) { console.error(`\n  no such file: ${from}\n`); process.exit(1); }
  const intake = JSON.parse(readFileSync(from, 'utf8')) as { _swatchUrls?: Record<string, string> };
  Object.assign(map, intake._swatchUrls ?? {});
}
for (const pair of all('set')) {
  const at = pair.indexOf('=');
  if (at > 0) map[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
}
if (Object.keys(map).length === 0) {
  console.error('\n  no swatch URLs given — pass --from <intake.json> or --set "Colour=url"\n');
  process.exit(1);
}

const dir = join(ROOT, 'public', 'images', product.slug, 'swatch');
mkdirSync(dir, { recursive: true });

const fileFor = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const EXT: Array<[string, (b: Buffer) => boolean]> = [
  ['.jpg', (b) => b[0] === 0xff && b[1] === 0xd8],
  ['.png', (b) => b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG'],
  ['.webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];

const downloaded: Record<string, string> = {};
for (const [label, url] of Object.entries(map)) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'oxide-jewelry/0.1 swatch import' } });
    if (!res.ok) { console.warn(`  skip (HTTP ${res.status}) ${label}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = EXT.find(([, test]) => test(buf))?.[0];
    if (!ext) { console.warn(`  skip (not an image) ${label}`); continue; }
    // Swatches are small by nature, so only reject the truly degenerate.
    const size = imageSize(buf);
    if (size && Math.min(size.width, size.height) < 40) {
      console.warn(`  skip (${size.width}x${size.height}, too small) ${label}`);
      continue;
    }
    // A swatch also becomes the hero when clicked, so a thumbnail-sized one
    // looks soft at full width. This catches a URL whose _250x250 suffix was
    // never stripped, which otherwise imports silently and looks fine as a chip.
    if (size && Math.min(size.width, size.height) < SWATCH_WIDTH / 2) {
      console.warn(`  ${label}: only ${size.width}x${size.height} — it will look soft as the hero image`);
    }
    const name = fileFor(label) + ext;
    // A swatch is rendered at 68 px. Storing the 1920 px original meant nine
    // colourways cost 2.5 MB to draw nine thumbnails.
    const small = resize(buf, SWATCH_WIDTH, ext);
    writeFileSync(join(dir, name), small ?? buf);
    // Chip-sized siblings, so nine colourways cost ~70 kB to draw rather than
    // nine full photographs.
    for (const w of SWATCH_CHIP_WIDTHS) {
      const chip = resize(small ?? buf, w, ext);
      if (chip) writeFileSync(join(dir, widthVariantPath(name, w)), chip);
    }
    downloaded[label] = `${product.slug}/swatch/${name}`;
    const kb = ((small ?? buf).length / 1024).toFixed(0).padStart(4);
    console.log(`  + ${label.padEnd(20)} ${kb} kB  ${size ? `${size.width}x${size.height}` : ''}`
      + `${small ? ` → ${SWATCH_WIDTH}px` : ''}`);
  } catch (e) {
    console.warn(`  skip (${e instanceof Error ? e.message : 'failed'}) ${label}`);
  }
}

if (Object.keys(downloaded).length === 0) {
  console.error('\n  nothing downloaded\n');
  process.exit(1);
}

const addMissing = argv.includes('--add-missing');
const cheapest = Math.min(...product.variants.map((v) => v.price));
const skuBase = product.variants[0]?.sku.split('-').slice(0, 2).join('-') ?? 'VAR';
const taken = new Set(product.variants.map((v) => v.sku));

/**
 * A swatch is keyed by its colourway, but a variant label can carry more than
 * one axis ("Silver / Small"), so an exact match alone silently attaches
 * nothing. Match the whole label first, then any one segment of it.
 */
function swatchFor(label: string): string | undefined {
  if (downloaded[label]) return downloaded[label];
  const segments = label.split('/').map((s) => s.trim());
  for (const seg of segments) if (downloaded[seg]) return downloaded[seg];
  return undefined;
}

const variants: Variant[] = product.variants.map((v) => {
  const swatch = swatchFor(v.label);
  return swatch ? { ...v, swatch } : v;
});

let added = 0;
if (addMissing) {
  for (const [label, path] of Object.entries(downloaded)) {
    if (variants.some((v) => v.swatch === path || v.label === label)) continue;
    let sku = `${skuBase}-${fileFor(label).toUpperCase().replace(/-/g, '').slice(0, 6)}`;
    let n = 2;
    while (taken.has(sku)) sku = `${sku}-${n++}`;
    taken.add(sku);
    // Priced off the cheapest existing variant, with no stock until you say so.
    variants.push({ sku, label, price: cheapest, stock: 0, swatch: path });
    added++;
  }
}

store.put({ ...product, variants, updatedAt: new Date().toISOString() });

console.log(`\n  ${product.title}`);
// Report what actually landed on a variant, not what downloaded — those two
// numbers came apart silently when the labels did not match.
const attached = variants.filter((v) => v.swatch).length;
console.log(`  ${attached} swatch(es) attached` + (added ? `, ${added} new colourway(s) added at stock 0` : ''));
const orphans = Object.keys(downloaded).filter((k) => !variants.some((v) => v.swatch === downloaded[k]));
if (orphans.length) {
  console.warn(`  ${orphans.length} swatch(es) matched no variant: ${orphans.join(', ')}`);
  console.warn('  pass --add-missing to create variants for them, or check the variant labels');
}
console.log(`  ${variants.filter((v) => v.swatch).length} of ${variants.length} variant(s) now show a colour image\n`);
