import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
import { products as productStore, categories as categoryStore } from '../src/lib/catalogue.ts';
import { deriveTitle, tidyVariantLabel, looksUnnamed } from '../src/lib/naming.ts';

/**
 * One command from a captured listing to a live product.
 *
 *   npm run onboard -- ./captured/1601927462795.json --category bangles
 *   npm run onboard -- ./captured/1601927462795.json --category bangles \
 *     --title "Gold-Plated Broad Bridal Bangle" --slug broad-bridal-bangle \
 *     --qty 20 --price 1079 --stock 20 \
 *     --rename "Design 1=Star Jaali" --rename "Design 2=Fine Jaali" \
 *     --activate
 *
 * It runs the same six scripts you would run by hand — scrape, product:add,
 * images:import, swatches, debrand, edit — so each step stays the one place
 * that knows how to do its job. Nothing here talks to the supplier site: the
 * capture is yours (scripts/capture-snippet.js), because that site shows a
 * slider check to anything that looks automated.
 *
 * Without --activate the product lands as a draft, which is the right default:
 * look at the photographs before it reaches a customer.
 */
const argv = process.argv.slice(2);
const VALUELESS = new Set(['activate', 'force']);
/** The one positional argument, skipping over every flag and its value. */
const file = (() => {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) return a;
    if (!VALUELESS.has(a.slice(2))) i++;
  }
  return undefined;
})();
const flag = (k: string) => {
  const i = argv.indexOf('--' + k);
  return i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const every = (k: string) => argv.reduce<string[]>(
  (acc, a, i) => (a === '--' + k && argv[i + 1] ? [...acc, argv[i + 1]!] : acc), []);
const has = (k: string) => argv.includes('--' + k);


if (!file || !existsSync(file)) {
  console.error(`
  usage: npm run onboard -- <captured.json|saved.html> --category <slug> [options]

  Everything but --category has a default. The command prints the one edit
  command to run afterwards, with your slug and variant labels filled in.

    --category <slug>    required — npm run slugs shows what exists
    --activate           put it on the storefront straight away
    --brand <name>       your label, stamped on after de-branding

    --title "..."        default: built from the listing's own attributes
    --slug <slug>        default: derived from that name
    --tagline "..."      one line under the title
    --qty <n>            order quantity the cost is taken from (default: MOQ)
    --markup <n>         retail suggestion multiplier (default: 6)
    --price <rupees>     your price, overriding the suggestion
    --stock <n>          default: 10 with --activate, 0 without
    --rename "A=B"       rename a variant; repeatable, matches on substring
                         (or do it afterwards with npm run edit -- --rename)
    --force              import the same listing a second time
`);
  process.exit(1);
}
const category = flag('category');
if (!category) { console.error('\n  --category is required. npm run slugs lists them.\n'); process.exit(1); }

// ---- pre-flight ---------------------------------------------------------
// Everything that can be checked before a file is written, is. A pipeline that
// creates the product and then fails on step four leaves you an orphan to find
// and delete by hand — which is exactly what happened the first time.
const wanted = flag('slug');
if (wanted && productStore.get((p) => p.slug === wanted)) {
  console.error(`\n  slug "${wanted}" already belongs to another product.`);
  console.error('  Pick another, or rename that one first:  npm run edit -- ' + wanted + ' --slug <other>\n');
  process.exit(1);
}

// The same listing imported twice is two products competing with each other.
const sourcing = existsSync(join(ROOT, 'data', 'sourcing.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'data', 'sourcing.json'), 'utf8')) as Record<string, { sourceUrl?: string }>
  : {};
const listingId = (file.match(/(\d{10,})/) ?? [])[1];
if (listingId && !has('force')) {
  const already = Object.entries(sourcing).find(([, v]) => v.sourceUrl?.includes(listingId));
  if (already) {
    console.error(`\n  this listing is already imported as "${already[0]}".`);
    console.error('  --force imports it again as a second product.\n');
    process.exit(1);
  }
}

const node = process.execPath;
const run = (script: string, args: string[]) => {
  console.log(`\n  ── ${script.replace('scripts/', '').replace('.ts', '')} ${'─'.repeat(Math.max(0, 54 - script.length))}`);
  execFileSync(node, [join(ROOT, script), ...args], { stdio: 'inherit' });
};

// 1. scrape → intake file
const intakeOut = join(ROOT, 'intake', 'onboard.json');
run('scripts/scrape-product.ts', [
  file, '--category', category, '--out', intakeOut,
  ...(flag('qty') ? ['--qty', flag('qty')!] : []),
  ...(flag('markup') ? ['--markup', flag('markup')!] : []),
]);

// 2. apply your copy to the intake before anything is created
interface Intake {
  title: string; tagline?: string; details?: Record<string, string>;
  variants: Array<{ label: string; priceRupees: number; stock?: number }>;
  _swatchUrls?: Record<string, string>;
  _imageUrls?: string[];
}
const intake = JSON.parse(readFileSync(intakeOut, 'utf8')) as Intake;

// "Design 1=Star Jaali" matches a label containing "Design 1", so you can name
// a variant from the fragment the listing shows rather than the full SKU path.
const renames = every('rename').map((pair) => {
  const at = pair.indexOf('=');
  return { from: pair.slice(0, at).trim(), to: pair.slice(at + 1).trim() };
}).filter((r) => r.from && r.to);
const rename = (label: string) => renames.find((r) => label.includes(r.from))?.to ?? label;

// Name it from its own attributes unless you said otherwise. A supplier title
// pasted straight in gives a 53-character slug and a page that reads like spam.
const supplierTitle = intake.title;
if (flag('title')) {
  intake.title = flag('title')!;
} else {
  const categoryName = categoryStore.read().find((c) => c.slug === category)?.name;
  // Pass the titles already in use, so a second listing from the same category
  // gets a name of its own rather than a duplicate with a "-2" slug.
  const { title } = deriveTitle(intake.details ?? {}, supplierTitle, categoryName,
    productStore.all().map((p) => p.title));
  intake.title = title;
  console.log(`\n  named "${title}"  (from the listing's attributes, not its title)`);
  console.log(`  supplier called it: ${supplierTitle.slice(0, 72)}…`);
}
if (flag('tagline')) intake.tagline = flag('tagline')!;
const price = flag('price') ? Number(flag('price')) : null;
const stock = flag('stock') ? Number(flag('stock')) : null;
// --activate means you want it buyable, and 0 stock everywhere means it is
// not. Say what was assumed rather than quietly refusing or quietly inventing.
const PLACEHOLDER_STOCK = 10;
const openingStock = stock ?? (has('activate') ? PLACEHOLDER_STOCK : 0);

intake.variants = intake.variants.map((v) => ({
  ...v,
  label: tidyVariantLabel(rename(v.label)),
  priceRupees: price ?? v.priceRupees,
  stock: openingStock,
}));
// Swatches attach by label, so the two have to be renamed together.
if (intake._swatchUrls) {
  intake._swatchUrls = Object.fromEntries(
    Object.entries(intake._swatchUrls).map(([k, u]) => [tidyVariantLabel(rename(k)), u]));
}
writeFileSync(intakeOut, JSON.stringify(intake, null, 2) + '\n');

// A --rename that matches nothing is a silent typo, and a label left as the
// supplier wrote it is a label no buyer understands. Say so, loudly, once.
const unmatched = renames.filter((r) => !intake.variants.some((v) => v.label === r.to));
if (unmatched.length) {
  console.warn(`\n  ${unmatched.length} --rename matched no variant: ${unmatched.map((r) => `"${r.from}"`).join(', ')}`);
}
const unnamed = intake.variants.filter((v) => looksUnnamed(v.label));

// 3. create it, then find what slug it got by diffing the catalogue
const before = new Set(productStore.all().map((p) => p.slug));
run('scripts/add-product.ts', [intakeOut]);
const created = productStore.all().find((p) => !before.has(p.slug));
if (!created) { console.error('\n  the product was not created — see above\n'); process.exit(1); }

let slug = created.slug;
if (flag('slug') && flag('slug') !== slug) {
  run('scripts/edit-product.ts', [slug, '--slug', flag('slug')!]);
  slug = flag('slug')!;
}

// 4. photographs, then the per-colourway swatches
if (intake._imageUrls?.length) {
  run('scripts/import-images.ts', ['--slug', slug, ...intake._imageUrls.flatMap((u) => ['--url', u])]);
}
if (intake._swatchUrls && Object.keys(intake._swatchUrls).length) {
  run('scripts/import-swatches.ts', ['--slug', slug, '--from', intakeOut]);
}

// 5. supplier identity out, your label on
run('scripts/debrand.ts', flag('brand') ? ['--brand', flag('brand')!] : []);

if (has('activate')) run('scripts/edit-product.ts', [slug, '--status', 'active']);

const done = productStore.get((p) => p.slug === slug)!;
console.log(`\n  ${done.title}`);
console.log(`  /product.html?slug=${slug} · ${done.status} · ${done.variants.length} variant(s) · ${done.images.length} image(s)`);
// ---- what to run next ---------------------------------------------------
// Everything above is a default. This is the single command that turns the
// defaults into your product, with the slug and the real variant names already
// filled in — open the page, look at the photographs, then edit this line.
const stillUnnamed = done.variants.filter((v) => looksUnnamed(v.label));
const quote = (t: string) => `"${t.replace(/"/g, '\\"')}"`;

console.log('\n  ' + '─'.repeat(66));
console.log('  NEXT: open the page, then paste this back with your own words\n');
console.log(`    open http://localhost:4000/product.html?slug=${slug}\n`);

const lines: string[] = [`npm run edit -- ${slug} \\`];
lines.push(`      --title ${quote(done.title)} \\`);
if (!done.tagline) lines.push(`      --tagline "one line a buyer would read" \\`);
if (!done.description) lines.push(`      --description "a paragraph about the piece" \\`);
if (!done.tags.length) lines.push(`      --tags "${[done.category, ...(done.finish ? [done.finish.toLowerCase()] : [])].join(',')},..." \\`);
for (const v of stillUnnamed) lines.push(`      --rename ${quote(`${v.label}=name it`)} \\`);
if (openingStock === PLACEHOLDER_STOCK && stock === null) lines.push(`      --stock <real count> \\`);
if (done.status !== 'active') lines.push(`      --status active \\`);
console.log('    ' + lines.join('\n    ').replace(/ \\$/, ''));

if (openingStock === PLACEHOLDER_STOCK && stock === null) {
  console.log(`\n  stock was set to ${PLACEHOLDER_STOCK} on every variant so the page is buyable.`);
  console.log('  That is a placeholder, not a count — the --stock line above replaces it.');
}
if (stillUnnamed.length) {
  console.log(`\n  ${stillUnnamed.length} variant(s) are named ${stillUnnamed.map((v) => v.label).join(', ')}.`);
  console.log('  The swatch shows the buyer which is which, so this is not urgent —');
  console.log('  but a name beats a number in the cart and for screen readers.');
}
console.log('');
console.log('');
