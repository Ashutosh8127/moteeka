import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
import { products as store, categories } from '../src/lib/catalogue.ts';
import { widthVariantPath } from '../src/lib/resize.ts';

/**
 * Builds the hero out of the catalogue's own photographs.
 *
 *   npm run hero
 *
 * It writes a mosaic of real product images into index.html, between two
 * markers, replacing what was a line drawing of a jhumka in an empty box.
 *
 * **A mosaic rather than one flattened file**, for three reasons. This machine
 * has `cwebp` and `sips`, which resize but cannot composite — there is no
 * ImageMagick to montage with. The tiles are the responsive variants that
 * already exist, so the hero is sharp on a retina screen without anybody
 * generating a 2x version of anything. And a flattened file goes stale the day
 * a piece sells out or a photograph is replaced, whereas this is re-run with
 * one command.
 *
 * Written into the HTML rather than fetched at load: the hero is the largest
 * thing on the first screen, and making it wait on an API call is how a page
 * scores badly on the one metric an ad click cares about.
 */
const START = '<!-- hero:start -->';
const END = '<!-- hero:end -->';

/** Widths written beside each catalogue image — see src/lib/resize.ts. */
const pickWidth = (widths: number[] | undefined, want: number) =>
  widths?.find((w) => w >= want) ?? widths?.at(-1);

const argv = process.argv.slice(2);
const at = argv.indexOf('--slugs');
const wanted = at >= 0 ? (argv[at + 1] ?? '').split(',').map((x) => x.trim()).filter(Boolean) : [];

const cats = categories.read().map((c) => c.slug);
const live = store.all().filter((p) => p.status === 'active' && p.images.length > 0);

/*
 * Which photographs go in the hero is a judgement the script cannot make. It
 * can tell which imports came in cleanly; it cannot tell that the first frame
 * of one of them is a hand holding a card with another seller's branding on it.
 * So the automatic pick is a starting point and `--slugs` is the real control:
 *
 *   npm run hero -- --slugs a-piece,another,third,fourth,fifth
 */
if (wanted.length) {
  const missing = wanted.filter((sl) => !live.some((p) => p.slug === sl));
  if (missing.length) {
    console.error(`\n  no live product with slug: ${missing.join(', ')}\n`);
    process.exit(1);
  }
}

/*
 * One piece per category, so the mosaic shows the range of the shop rather
 * than five variations on a necklace. Within a category, the piece whose first
 * photograph has the most resized widths available — a proxy for "this one
 * imported cleanly" — and ties broken by stock, so the hero does not lead with
 * something nobody can buy.
 */
const automatic = cats.map((slug) => {
  const inCat = live.filter((p) => p.category === slug);
  return inCat.sort((a, b) => {
    const w = (b.images[0]?.widths?.length ?? 0) - (a.images[0]?.widths?.length ?? 0);
    if (w !== 0) return w;
    return b.variants.reduce((n, v) => n + v.stock, 0) - a.variants.reduce((n, v) => n + v.stock, 0);
  })[0];
}).filter((p): p is NonNullable<typeof p> => Boolean(p));

const chosen = wanted.length
  ? wanted.map((sl) => live.find((p) => p.slug === sl)!)
  : automatic;

if (chosen.length < 3) {
  console.error(`\n  only ${chosen.length} usable photograph(s) — nothing to build a hero from\n`);
  process.exit(1);
}

// Five tiles: a tall one, then four in a block beside it. More than five at
// this size stops reading as jewellery and starts reading as a texture.
const tiles = chosen.slice(0, 5);

const IMAGES = join(ROOT, 'public', 'images');
const html = tiles.map((p, i) => {
  const im = p.images[0]!;
  // The first tile is drawn about twice the size of the others.
  const want = i === 0 ? 400 : 240;
  const w = pickWidth(im.widths, want);
  const path = w ? widthVariantPath(im.path, w) : im.path;
  const src = existsSync(join(IMAGES, path)) ? path : im.path;
  const srcset = (im.widths ?? [])
    .filter((x) => x <= 800)
    .map((x) => `/images/${widthVariantPath(im.path, x)} ${x}w`)
    .join(', ');
  return `      <a class="t${i + 1}" href="/product.html?slug=${p.slug}" aria-label="${p.title.replace(/"/g, '&quot;')}">`
    + `<img src="/images/${src}"${srcset ? ` srcset="${srcset}" sizes="${i === 0 ? '(max-width: 860px) 45vw, 220px' : '(max-width: 860px) 22vw, 110px'}"` : ''}`
    + ` alt="" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></a>`;
}).join('\n');

const file = join(ROOT, 'public', 'index.html');
const page = readFileSync(file, 'utf8');
const from = page.indexOf(START);
const to = page.indexOf(END);
if (from === -1 || to === -1) {
  console.error(`\n  ${START} / ${END} markers not found in public/index.html\n`);
  process.exit(1);
}

writeFileSync(file, page.slice(0, from + START.length) + '\n' + html + '\n    ' + page.slice(to));

console.log(`\n  hero rebuilt from ${tiles.length} photograph(s):`);
for (const p of tiles) console.log(`    ${p.category.padEnd(12)} ${p.slug}`);
console.log(`\n  re-run after importing or removing pieces:  npm run hero`);
console.log(`  choose the photographs yourself:  npm run hero -- --slugs a,b,c,d,e\n`);
