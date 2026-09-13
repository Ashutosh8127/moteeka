import { renameSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
import { reviews } from '../src/lib/reviews.ts';
import { categories as categoryStore } from '../src/lib/catalogue.ts';
import { products as productStore } from '../src/lib/catalogue.ts';
import type { Category, Product } from '../src/types.ts';
import { rekeySourcingVariants } from '../src/lib/sourcing.ts';

/**
 * Changes a product without opening data/products/<slug>.json by hand.
 *
 *   npm run edit -- filigree-chandbali-pearl-drops --status active
 *   npm run edit -- filigree-chandbali-pearl-drops --slug jhumka --category jhumka
 *   npm run edit -- jhumka --price 699 --stock 40 --featured
 *   npm run edit -- jhumka --sku EAR-WOM-SILV --price 649 --stock 12
 *
 * Renaming the slug also moves the image folder and rewrites every image path,
 * which is the step that is easy to forget and leaves a product with no
 * pictures.
 */
const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--') && !isValueOfFlag(argv, a));

function isValueOfFlag(args: string[], value: string): boolean {
  const i = args.indexOf(value);
  return i > 0 && args[i - 1]!.startsWith('--');
}
const flag = (k: string): string | undefined => {
  const i = argv.indexOf('--' + k);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : 'true';
};
const has = (k: string) => argv.includes('--' + k);
/** Every occurrence of a repeatable flag, in order. */
const flags = (k: string): string[] => {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a !== '--' + k) return;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) out.push(next);
  });
  return out;
};

if (!target) {
  console.error(`
  usage: npm run edit -- <slug|id> [changes]

    --status draft|active|archived   publish or unpublish
    --slug <new-slug>                rename (moves images too)
    --category <slug>                move to another category
    --title "..."  --tagline "..."   copy
    --description "..."              the paragraph under the price
    --detail "Size=20 cm"            add or replace one spec row (repeatable)
    --drop-detail "Style"            remove one spec row (repeatable)
    --material "..." --finish "..."  spec rows
    --tags a,b,c                     search and the related rail
    --rename "old=new"               rename a variant, by label or SKU
    --resku                          rebuild SKUs from labels (unsold only)
    --price <rupees>                 all variants, or one with --sku
    --stock <n>                      all variants, or one with --sku
    --sku <SKU>                      limit --price/--stock to one variant
    --featured / --not-featured      home page placement

  npm run slugs lists what you can target.
`);
  process.exit(1);
}

const store = productStore;
const products = store.all();
const product = products.find((p) => p.slug === target || p.id === target);
if (!product) {
  console.error(`\n  no product "${target}". Available:\n`);
  for (const p of products) console.error(`    ${p.slug}`);
  console.error('');
  process.exit(1);
}

const changes: string[] = [];
const patch: Partial<Product> = {};

// Read once here rather than at the rename step below: --resku builds SKUs
// from the slug, and running both in one command should use the slug you are
// renaming *to*, not the one you are leaving behind.
const newSlug = flag('slug');
const finalSlug = newSlug && newSlug !== product.slug ? newSlug : product.slug;

/*
 * Spec rows, one at a time. Measurements are the ones that matter: forty-five
 * live pieces have no size or weight anywhere on the page, and jewellery bought
 * unseen comes back over fit more than over anything else.
 */
const details = flags('detail');
const dropped = flags('drop-detail');
if (details.length || dropped.length) {
  const next = { ...product.details };
  for (const pair of details) {
    const at = pair.indexOf('=');
    if (at < 1) {
      console.error(`\n  --detail needs Key=Value, got "${pair}"\n`);
      process.exit(1);
    }
    const key = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (!key || !value) {
      console.error(`\n  --detail needs both a key and a value, got "${pair}"\n`);
      process.exit(1);
    }
    next[key] = value;
    changes.push(`detail ${key} = ${value}`);
  }
  for (const key of dropped) {
    if (key in next) { delete next[key]; changes.push(`detail ${key} removed`); }
    else console.warn(`  no spec row called "${key}" — nothing removed`);
  }
  patch.details = next;
}

const status = flag('status');
if (status) {
  if (!['draft', 'active', 'archived'].includes(status)) {
    console.error(`\n  --status must be draft, active or archived\n`);
    process.exit(1);
  }
  patch.status = status as Product['status'];
  changes.push(`status ${product.status} → ${status}`);
}

const category = flag('category');
if (category) {
  // Categories are data, not a type — validate against the file that defines them.
  const known = categoryStore.read();
  if (!known.some((c) => c.slug === category)) {
    console.error(`\n  unknown category "${category}". Known: ${known.map((c) => c.slug).join(', ')}\n`);
    process.exit(1);
  }
  patch.category = category;
  changes.push(`category ${product.category} → ${category}`);
}

for (const [key, label] of [['title', 'title'], ['tagline', 'tagline'], ['description', 'description'],
  ['material', 'material'], ['finish', 'finish']] as const) {
  const v = flag(key);
  if (v && v !== 'true') {
    (patch as Record<string, unknown>)[key] = v;
    changes.push(`${label} → ${v.slice(0, 48)}${v.length > 48 ? '…' : ''}`);
  }
}

/*
 * Image alt text is written from the title at import, and a rename left it
 * behind — a product renamed away from "Rhodium-Plated Piece" still described
 * every photograph as one. Alt text is what a screen reader reads aloud and
 * what a search engine indexes, so it is not cosmetic.
 *
 * Only alts that still look derived are rewritten; anything someone wrote by
 * hand is left exactly as they wrote it.
 */
const newTitle = flag('title');
if (newTitle && newTitle !== product.title) {
  let rewritten = 0;
  const images = product.images.map((i) => {
    if (i.alt !== product.title && !i.alt.startsWith(`${product.title} — `)) return i;
    rewritten++;
    return { ...i, alt: i.alt.replace(product.title, newTitle) };
  });
  if (rewritten) {
    patch.images = images;
    changes.push(`${rewritten} image alt(s) followed the new title`);
  }
}

// Tags drive search and the related-pieces rail, so an untagged product is
// invisible to both — comma-separated is what you would type anyway.
const tags = flag('tags');
if (tags && tags !== 'true') {
  patch.tags = tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  changes.push(`tags → ${patch.tags.join(', ')}`);
}

if (has('featured') || has('not-featured')) {
  patch.featured = has('featured');
  changes.push(`featured → ${patch.featured}`);
}

// Renaming a variant after the fact is the whole point: you cannot name a
// pattern you have not seen, and the import happens before you look at it.
// SKUs stay put — orders reference them.
const renames = argv.reduce<Array<[string, string]>>((acc, a, i) => {
  if (a !== '--rename' || !argv[i + 1]) return acc;
  const at = argv[i + 1]!.indexOf('=');
  return at > 0 ? [...acc, [argv[i + 1]!.slice(0, at).trim(), argv[i + 1]!.slice(at + 1).trim()]] : acc;
}, []);
let renamed: Product['variants'] | null = null;
if (renames.length) {
  const miss = renames.filter(([from]) =>
    !product.variants.some((v) => v.label === from || v.sku === from));
  if (miss.length) {
    console.error(`\n  no variant called ${miss.map(([f]) => `"${f}"`).join(' or ')}. This product has:`);
    for (const v of product.variants) console.error(`    ${v.sku.padEnd(16)} ${v.label}`);
    console.error('');
    process.exit(1);
  }
  const fileFor = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const swatchDir = join(ROOT, 'public', 'images', product.slug, 'swatch');

  /*
   * Renaming a set of variants can shuffle names between them — A takes B's
   * name while B is still using it. Moving each file as it is decided would
   * overwrite the one that has not moved yet and lose the image for good, so
   * the moves are planned first and then made in two passes via a temporary
   * name.
   */
  const moves: Array<{ from: string; to: string }> = [];
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plan = (fromBase: string, toBase: string, ext: string) => {
    if (fromBase === toBase || !existsSync(swatchDir)) return 0;
    let n = 0;
    for (const name of readdirSync(swatchDir)) {
      const m = name.match(new RegExp(`^${escape(fromBase)}(-\\d+)?${escape(ext)}$`));
      if (!m) continue;
      moves.push({ from: name, to: `${toBase}${m[1] ?? ''}${ext}` });
      n++;
    }
    return n;
  };

  renamed = product.variants.map((v) => {
    const hit = renames.find(([from]) => v.label === from || v.sku === from);
    const label = hit ? hit[1] : v.label;
    if (hit && hit[1] !== v.label) changes.push(`${v.sku} label "${v.label}" → "${hit[1]}"`);
    if (!v.swatch) return { ...v, label };

    // The swatch file is named after whatever the variant was called when it
    // was imported — usually the supplier's code, which then sits in a public
    // image URL long after the label was fixed. Move the file with it, and the
    // chip sizes beside it: leaving those behind is invisible, because the page
    // silently falls back to the full-size file for every chip.
    const ext = v.swatch.slice(v.swatch.lastIndexOf('.'));
    const want = `${product.slug}/swatch/${fileFor(label)}${ext}`;
    if (want === v.swatch) return { ...v, label };
    const n = plan(v.swatch.split('/').pop()!.slice(0, -ext.length), fileFor(label), ext);
    if (n) changes.push(`${v.sku} swatch → ${fileFor(label)}${ext}${n > 1 ? ` (+${n - 1} size${n > 2 ? 's' : ''})` : ''}`);
    return { ...v, label, swatch: want };
  });

  // Out to temporaries, then in to the final names. Two passes, no clobber.
  const stamp = `.mv${process.pid}`;
  for (const m of moves) {
    const src = join(swatchDir, m.from);
    if (existsSync(src)) renameSync(src, src + stamp);
  }
  for (const m of moves) {
    const tmp = join(swatchDir, m.from + stamp);
    if (existsSync(tmp)) renameSync(tmp, join(swatchDir, m.to));
  }
}

// Variant edits, optionally narrowed to one SKU.
const onlySku = flag('sku');
const priceRupees = flag('price');
const stock = flag('stock');
if (priceRupees || stock) {
  patch.variants = (renamed ?? product.variants).map((v) => {
    if (onlySku && v.sku !== onlySku) return v;
    const next = { ...v };
    if (priceRupees) {
      next.price = Math.round(Number(priceRupees) * 100);
      changes.push(`${v.sku} price ₹${(v.price / 100).toFixed(0)} → ₹${Number(priceRupees).toFixed(0)}`);
    }
    if (stock) {
      next.stock = Math.max(0, Math.trunc(Number(stock)));
      changes.push(`${v.sku} stock ${v.stock} → ${next.stock}`);
    }
    return next;
  });
  if (onlySku && !product.variants.some((v) => v.sku === onlySku)) {
    console.error(`\n  no variant "${onlySku}" on this product. It has: ${product.variants.map((v) => v.sku).join(', ')}\n`);
    process.exit(1);
  }
}

if (renamed && !patch.variants) patch.variants = renamed;

/**
 * Regenerate SKUs from the current labels. Imported variants are keyed by the
 * supplier's part number ("EAR-GOL-FX9161"), which is both meaningless to you
 * and the supplier's reference, not yours — but a SKU is what an order points
 * at, so this is refused once anything has been sold.
 */
/** Old SKU → new, so the private reorder table follows the rename. */
const skuMoves: Record<string, string> = {};
let renamedSkus = 0;

if (has('resku')) {
  const orders = JSON.parse(readFileSync(join(ROOT, 'data', 'orders.json'), 'utf8')) as
    Array<{ lines?: Array<{ sku?: string }>; items?: Array<{ sku?: string }> }>;
  const sold = new Set(orders.flatMap((o) => [...(o.lines ?? []), ...(o.items ?? [])].map((l) => l.sku)));
  const base = finalSlug.split('-').slice(0, 2).map((w) => w.slice(0, 3).toUpperCase()).join('-');
  const taken = new Set<string>();
  patch.variants = (patch.variants ?? renamed ?? product.variants).map((v) => {
    if (sold.has(v.sku)) {
      console.error(`\n  ${v.sku} appears on an order — SKUs cannot be regenerated once sold\n`);
      process.exit(1);
    }
    // Build each candidate from the stem, not from the last rejected one —
    // otherwise a third collision reads "SILVER-2-3".
    const stem = `${base}-${v.label.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()}`;
    let sku = stem;
    for (let n = 2; taken.has(sku); n++) sku = `${stem}-${n}`;
    taken.add(sku);
    if (sku !== v.sku) {
      skuMoves[v.sku] = sku;
      changes.push(`${v.sku} → ${sku}  (${v.label})`);
    }
    renamedSkus++;
    return { ...v, sku };
  });
}

// Renaming last, so the image move happens once everything else validated.
if (newSlug && newSlug !== product.slug) {
  if (products.some((p) => p.slug === newSlug)) {
    console.error(`\n  slug "${newSlug}" is already taken by another product\n`);
    process.exit(1);
  }
  const from = join(ROOT, 'public', 'images', product.slug);
  const to = join(ROOT, 'public', 'images', newSlug);
  if (existsSync(from)) {
    mkdirSync(join(ROOT, 'public', 'images'), { recursive: true });
    renameSync(from, to);
  }
  patch.slug = newSlug;
  // Every stored path is "<slug>/rest", so rewrite the leading segment rather
  // than matching the old slug as a prefix: a path that drifted out of sync in
  // an earlier rename would otherwise never be repaired.
  const repath = (path: string) => `${newSlug}/${path.split('/').slice(1).join('/')}`;
  // Start from any alt rewrite above, not from the original, or renaming the
  // title and the slug in one command loses the alt change.
  patch.images = (patch.images ?? product.images).map((i) => ({ ...i, path: repath(i.path) }));
  // Swatches live under the same folder but are stored per variant, so they
  // have to move with it — missing this left twelve broken images on a page
  // whose gallery still looked fine.
  const repoint = (v: Product['variants'][number]) =>
    (v.swatch ? { ...v, swatch: repath(v.swatch) } : v);
  patch.variants = (patch.variants ?? renamed ?? product.variants).map(repoint);
  const swatches = patch.variants.filter((v) => v.swatch).length;
  changes.push(`slug ${product.slug} → ${newSlug}  (${product.images.length} image path(s)`
    + `${swatches ? ` and ${swatches} swatch path(s)` : ''} rewritten)`);

  /*
   * Ratings are stored against the slug, so they have to follow it. Missing
   * this stranded eighteen reviews across four renames and reported nothing:
   * the stars simply stopped appearing on pages that had earned them.
   */
  const moved = await reviews().repoint(product.slug, newSlug);
  if (moved) changes.push(`${moved} review(s) followed the new slug`);
}

if (changes.length === 0) {
  console.log(`\n  nothing to change. Run with --help flags — npm run edit -- ${product.slug}\n`);
  process.exit(0);
}

// The file is named by slug, so a rename moves it.
const after = { ...product, ...patch, updatedAt: new Date().toISOString() };
store.put(after, product.slug);

// Your SKU is what an order carries; the supplier's part number is what you
// reorder against. Changing the first must not orphan the second.
if (Object.keys(skuMoves).length) {
  const moved = await rekeySourcingVariants(product.id, skuMoves);
  if (moved) console.log(`\n  ${moved} supplier reorder reference(s) followed the new SKUs`);
  // A cart lives in the customer's browser and holds SKUs, not products.
  console.log(`  anyone holding an old SKU in their cart will see the line as`);
  console.log(`  "no longer available" and can remove it — the cart still works.`);
}
void renamedSkus;
console.log(`\n  ${after.title}`);
for (const c of changes) console.log(`    ${c}`);
console.log(`\n  now: ${after.slug} · ${after.category} · ${after.status} · ` +
  `${after.variants.length} variant(s) · ${after.images.length} image(s)`);
console.log(after.status === 'active' ? '  live on the storefront\n' : '  not on the storefront\n');
