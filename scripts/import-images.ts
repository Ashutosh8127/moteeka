import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { ROOT } from '../src/config.ts';
import { products as productStore } from '../src/lib/catalogue.ts';
import { imageSize } from '../src/lib/image-size.ts';
import { resize, findResizer, resizerName, GALLERY_WIDTHS, widthVariantPath } from '../src/lib/resize.ts';
import type { Product } from '../src/types.ts';

/**
 * Brings real product photography into the catalogue.
 *
 *   npm run images:import -- --slug ethnic-retro-carved-jhumka ./photos/jhumka/*.jpg
 *   npm run images:import -- --slug ethnic-retro-carved-jhumka --url https://.../a.jpg
 *   npm run images:import -- --slug ethnic-retro-carved-jhumka --dir ./photos/jhumka
 *
 * Anything smaller than 400px on its short side is rejected: supplier pages are
 * full of badges, trust seals and logos that are technically valid images and
 * have no business on a product page. Override with --min-px.
 *
 * Importing replaces whatever was there; the first file becomes the
 * card image, so pass them in the order you want them shown.
 */
const argv = process.argv.slice(2);
const flags = new Map<string, string[]>();
const files: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const vals: string[] = [];
    while (argv[i + 1] && !argv[i + 1]!.startsWith('--')) vals.push(argv[++i]!);
    // Repeated flags accumulate — `--url a --url b` means both, not just b.
    flags.set(key, [...(flags.get(key) ?? []), ...vals]);
  } else files.push(a);
}
const first = (k: string) => flags.get(k)?.[0];

const slug = first('slug');
if (!slug) {
  console.error('\n  usage: npm run images:import -- --slug <product-slug> <files...|--dir ./folder|--url https://...>\n');
  process.exit(1);
}

const store = productStore;
const product = store.get((p) => p.slug === slug || p.id === slug);
if (!product) {
  // Listing the real slugs here saves a round trip — the names are long and
  // easy to shorten by accident ("jhumka" instead of "ethnic-retro-carved-jhumka").
  console.error(`\n  no product with slug "${slug}". Available:\n`);
  for (const p of store.all()) console.error(`    ${p.slug}`);
  console.error('');
  process.exit(1);
}

// Signature bytes, because a file called .jpg is not necessarily a JPEG and a
// broken image on a product page costs a sale.
const SIGNATURES: Array<[string, (b: Buffer) => boolean]> = [
  ['.jpg', (b) => b[0] === 0xff && b[1] === 0xd8],
  ['.png', (b) => b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG'],
  ['.webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
  ['.gif', (b) => b.subarray(0, 3).toString('latin1') === 'GIF'],
];
function extensionOf(buf: Buffer): string | null {
  for (const [ext, test] of SIGNATURES) if (test(buf)) return ext;
  return null;
}

const MIN_PX = Number(first('min-px') ?? 400);

/** Rejects anything too small to be a product photograph. */
function tooSmall(buf: Buffer, label: string): boolean {
  const size = imageSize(buf);
  if (!size) return false;                    // unknown shape — let it through
  if (Math.min(size.width, size.height) >= MIN_PX) return false;
  console.warn(`  skip (${size.width}x${size.height}, below ${MIN_PX}px — looks like a badge or logo): ${label}`);
  return true;
}

const sources: string[] = [...files];
for (const dir of flags.get('dir') ?? []) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir).sort()) {
    if (/\.(jpe?g|png|webp|gif)$/i.test(f)) sources.push(join(dir, f));
  }
}

const outDir = join(ROOT, 'public', 'images', product.slug);
mkdirSync(outDir, { recursive: true });

const imported: Array<{ path: string; alt: string; widths?: number[] }> = [];
let index = 1;
const nextName = (ext: string) => `${String(index++).padStart(2, '0')}${ext}`;

/**
 * Write the responsive sizes beside the original and report which exist.
 * A supplier photograph is 1200-1920px and a product card shows it at 400 —
 * sending the original is most of a page's weight for none of its detail.
 */
function writeWidths(buf: Buffer, name: string, ext: string): number[] {
  const made: number[] = [];
  for (const w of GALLERY_WIDTHS) {
    const smaller = resize(buf, w, ext);
    if (!smaller) continue;
    writeFileSync(join(outDir, widthVariantPath(name, w)), smaller);
    made.push(w);
  }
  return made;
}

for (const src of sources) {
  if (!existsSync(src)) { console.warn(`  skip (missing): ${src}`); continue; }
  const buf = readFileSync(src);
  const ext = extensionOf(buf) ?? extname(src).toLowerCase();
  if (!/\.(jpg|png|webp|gif)$/.test(ext)) { console.warn(`  skip (not an image): ${src}`); continue; }
  if (tooSmall(buf, src)) continue;
  const name = nextName(ext);
  writeFileSync(join(outDir, name), buf);
  const widths = writeWidths(buf, name, ext);
  imported.push({
    path: `${product.slug}/${name}`,
    alt: `${product.title} — ${basename(src, extname(src))}`,
    ...(widths.length ? { widths } : {}),
  });
  console.log(`  + ${name}  ← ${src}  (${(buf.length / 1024).toFixed(0)} kB`
    + `${widths.length ? `, +${widths.join('/')}px` : ''})`);
}

for (const url of flags.get('url') ?? []) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'oxide-jewelry/0.1 image import' } });
    if (!res.ok) { console.warn(`  skip (HTTP ${res.status}): ${url}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = extensionOf(buf);
    if (!ext) { console.warn(`  skip (server did not return an image): ${url}`); continue; }
    if (tooSmall(buf, url)) continue;
    const name = nextName(ext);
    writeFileSync(join(outDir, name), buf);
    const widths = writeWidths(buf, name, ext);
    imported.push({
      path: `${product.slug}/${name}`, alt: product.title,
      ...(widths.length ? { widths } : {}),
    });
    console.log(`  + ${name}  ← ${url}  (${(buf.length / 1024).toFixed(0)} kB`
      + `${widths.length ? `, +${widths.join('/')}px` : ''})`);
  } catch (e) {
    console.warn(`  skip (${e instanceof Error ? e.message : 'fetch failed'}): ${url}`);
  }
}

if (!findResizer()) {
  console.warn(`\n  no image resizer found, so only full-size files were written.`);
  console.warn(`  ${resizerName()}`);
}

if (imported.length === 0) {
  console.error('\n  nothing imported — no readable image files were given.\n');
  process.exit(1);
}

const keep = flags.has('append') ? [...product.images] : [];
const images = [...keep, ...imported];

/**
 * A replacing import writes 01..NN afresh. If the previous import had more
 * photographs, its files — and the -160/-400/-800 siblings beside each — stay
 * on disk unreferenced, and get served to anyone who guesses the URL.
 */
const referenced = new Set<string>();
for (const im of images) {
  const name = im.path.split('/').pop()!;
  referenced.add(name);
  for (const w of GALLERY_WIDTHS) referenced.add(widthVariantPath(name, w));
}
let pruned = 0;
for (const name of readdirSync(outDir)) {
  if (statSync(join(outDir, name)).isDirectory()) continue;   // swatch/ is not ours
  if (referenced.has(name)) continue;
  unlinkSync(join(outDir, name));
  pruned++;
}
if (pruned) console.log(`  − ${pruned} file(s) from a previous import removed`);

store.put({ ...product, images, updatedAt: new Date().toISOString() });

console.log(`\n  ${product.title}: ${imported.length} image(s) now live${keep.length ? `, ${keep.length} kept` : ''}\n`);
