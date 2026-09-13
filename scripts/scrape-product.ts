import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { ROOT } from '../src/config.ts';
import {
  extractDetailData, parseDetailData, bestCostPaise, costAtQtyPaise, suggestRetail, type ScrapedProduct,
} from '../src/lib/supplier-payload.ts';
import { deriveTitle } from '../src/lib/naming.ts';
import { describe, visibleDetails } from '../src/lib/describe.ts';
import { priceFor } from '../src/lib/landed-cost.ts';

/**
 * Turns a saved supplier listing into an intake file `product:add` can consume.
 *
 *   node scripts/scrape-product.ts ./html/listing.html
 *   node scripts/scrape-product.ts ./html/listing.html --category jhumka --markup 6
 *   node scripts/scrape-product.ts ./captured/1600303524801.json
 *
 * Two ways to get the input:
 *   1. Open the listing in your browser, Save Page As → HTML.
 *   2. Open the listing, then paste scripts/capture-snippet.js into the browser
 *      console — it saves the payload as JSON, which is smaller and cleaner.
 *
 * the supplier site shows a slider check to anything that looks automated, which is why
 * the capture step is yours and this script only reads what you already have.
 */
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (k: string) => {
  const i = args.indexOf('--' + k);
  return i !== -1 ? args[i + 1] : undefined;
};
if (!file) {
  console.error('\n  usage: node scripts/scrape-product.ts <saved.html|captured.json> [--category <slug>] [--markup 6] [--qty <n>] [--weight <g>] [--out file.json]\n');
  process.exit(1);
}

const raw = readFileSync(file, 'utf8');
const data = extname(file).toLowerCase() === '.json' ? JSON.parse(raw) : extractDetailData(raw);
if (!data) {
  console.error('\n  No product payload in that file.');
  console.error('  If it is a saved page, it is probably the supplier site\'s verification screen rather than');
  console.error('  the listing — open the product, clear the slider, then save the page again.\n');
  process.exit(1);
}

const p = parseDetailData(data as never, flag('url'));
if (!p) {
  console.error('\n  Payload found but it has no product in it — was this a search or store page?\n');
  process.exit(1);
}

const markup = Number(flag('markup') ?? 6);
/** Shipped weight of one piece: freight and therefore duty both turn on it. */
const weight = flag('weight') ? Number(flag('weight')) : undefined;
const floor = bestCostPaise(p);
const cost = costAtQtyPaise(p, Number(flag('qty') ?? p.moq));
const inr = (paise: number) => '₹' + (paise / 100).toFixed(2);

console.log(`\n  ${p.title}`);
console.log(`  product ${p.productId} · ${p.supplier.name || 'supplier unknown'}` +
  `${p.supplier.years ? ` · ${p.supplier.years} yrs on the supplier site` : ''}`);
console.log(`  MOQ ${p.moq} ${p.unit}${p.moq === 1 ? '' : 's'}` +
  `${p.customsMoq ? ` · customs MOQ ${p.customsMoq}` : ''}`);

if (p.ladder.length) {
  console.log('\n  QUANTITY PRICING');
  for (const t of p.ladder) {
    const span = t.maxQty ? `${t.minQty}–${t.maxQty}` : `${t.minQty}+`;
    console.log(`    ${span.padEnd(12)} $${t.usd.toFixed(2).padStart(6)}   ₹${t.inr.toFixed(2)}`);
  }
} else if (p.range) {
  console.log(`\n  PRICE RANGE  $${p.range.lowUsd}–${p.range.highUsd}  (₹${p.range.lowInr}–${p.range.highInr})`);
}

if (p.skuAxes.length) {
  console.log('\n  VARIANTS');
  for (const a of p.skuAxes) console.log(`    ${a.name}: ${a.values.join(', ')}`);
  console.log(`    ${p.variants.length} combination(s) priced`);
  const withSwatch = Object.keys(p.swatches).length;
  if (withSwatch) console.log(`    ${withSwatch} colourway(s) have a swatch image`);
}

console.log(`\n  ATTRIBUTES (${Object.keys(p.attributes).length})`);
for (const [k, v] of Object.entries(p.attributes)) console.log(`    ${k.padEnd(26)} ${v}`);

console.log(`\n  IMAGES  ${p.images.length} product` +
  `${p.descriptionImages.length ? ` · ${p.descriptionImages.length} description` : ''}`);

if (cost !== null) {
  const qty = Number(flag('qty') ?? p.moq);
  console.log(`\n  SUPPLIER     ${inr(cost)} per ${p.unit} at ${qty} ${p.unit}s`);
  if (floor !== null && floor !== cost) console.log(`  best tier    ${inr(floor)} — only at the listing's top quantity break`);

  // A multiple of the supplier's price ignores freight, duty, the courier and
  // the parcels that come back — all of which fall hardest on a cheap piece.
  try {
    const b = priceFor({ supplierPaise: cost, orderQty: qty, weightGrams: weight });
    console.log(`  LANDED       ${inr(b.landed.landed)} — after freight, duty and clearance`);
    console.log(`  COST TO SERVE ${inr(b.costToServe)} — plus courier, packaging and returns`);
    console.log(`  SUGGESTION   ${inr(b.price)} to keep ${b.marginPct.toFixed(0)}% of net revenue`
      + `  (${b.multipleOfSupplier.toFixed(1)}× the supplier price)`);
    console.log(`  npm run cost -- --supplier ${(cost / 100).toFixed(2)} --qty ${qty}   shows every line`);
  } catch (e) {
    console.warn(`  could not price it: ${e instanceof Error ? e.message : e}`);
  }
}

// ---- write the intake file ----
const category = flag('category') ?? '';
const slugBase = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
const out = flag('out') ?? join(ROOT, 'intake', `${p.productId}.json`);

const qtyOrdered = Number(flag('qty') ?? p.moq);
/** The same model the `cost` script uses, so one number cannot drift from the other. */
const retailFor = (costPaise: number): number => {
  try {
    return priceFor({ supplierPaise: costPaise, orderQty: qtyOrdered, weightGrams: weight }).price;
  } catch {
    return suggestRetail(costPaise, markup);
  }
};

const variants = (p.variants.length ? p.variants : [{ label: 'Default', inr: null, usd: null }])
  .map((v) => {
    const costPaise = v.inr != null ? Math.round(v.inr * 100) : cost;
    return {
      label: v.label,
      priceRupees: costPaise ? retailFor(costPaise) / 100 : 0,
      stock: 0,
      // The label is renamed on the way in; these two are what you quote back
      // to the supplier when you reorder, so they travel separately.
      _supplierSku: v.label,
      _supplierSkuId: v.skuId != null ? String(v.skuId) : null,
      _supplierCostRupees: costPaise ? costPaise / 100 : null,
      _supplierUsd: v.usd,
      swatchUrl: v.swatchUrl ?? null,
    };
  });

const intake = {
  _generatedFrom: file,
  /** The quantity the prices below were costed at — add-product reuses it. */
  _orderQty: qtyOrdered,
  _generatedAt: new Date().toISOString(),
  _warning: [
    'priceRupees is a SUGGESTION from data/costs.json: landed cost, courier, returns and the target margin. Check it.',
    '_supplierCostRupees is what you pay at the order quantity used, excluding shipping, customs duty and GST.',
    'stock is 0 — set it when the shipment lands.',
    'Confirm in writing that you may use the supplier images before publishing them.',
  ],
  title: p.title,
  category,
  // Filled in below, once there is a title and a category to compose from.
  tagline: '',
  description: '',
  material: p.attributes['Material Type'] ?? p.attributes['Jewelry Main Material'] ?? '',
  // The listing states the plating; leaving `finish` blank puts an empty row on
  // the product page and makes you retype something already in the payload.
  // "other" is the listing's own placeholder and is worse than blank.
  finish: [p.attributes['Plating'], deriveTitle(p.attributes, p.title).finish]
    .find((v) => v && !/^other$/i.test(v)) ?? '',
  /*
   * Only the rows a customer should read. The listing's own keys carry things
   * that are not ours to publish — a "Factory Advantage", a `CN` row naming a
   * province — and junk values ("/", "Null") that cost more than a missing row.
   * Where the piece came from is sourcing, and sourcing is never on a product.
   */
  details: visibleDetails(p.attributes),
  variants,
  tags: [] as string[],
  featured: false,
  status: 'draft',
  sourceUrl: p.url ?? `https://www.the supplier site/product-detail/x_${p.productId}.html`,
  supplier: p.supplier.name,
  images: [],
  _imageUrls: p.images,
  _swatchUrls: p.swatches,
  _descriptionImageUrls: p.descriptionImages,
};

/*
 * The page's opening paragraph, composed from the attributes above. Every
 * listing before this one arrived with `description: ''` and stayed that way,
 * so fifty products opened with a title, a price and a table. A generated
 * paragraph is a default to edit, never a finished sentence.
 */
const copy = describe({
  ...intake,
  slug: slugBase,
  variants: variants.map((v) => ({ ...v, swatch: v.swatchUrl ?? undefined })) as never,
});
intake.tagline = copy.tagline;
intake.description = copy.description;
intake.tags = copy.tags;

mkdirSync(join(ROOT, 'intake'), { recursive: true });
writeFileSync(out, JSON.stringify(intake, null, 2) + '\n');

console.log(`\n  written  ${out.replace(ROOT + '/', '')}`);
if (!category) console.log(`  set "category" in it (npm run slugs shows what exists), then:`);
console.log(`\n    npm run product:add -- ${out.replace(ROOT + '/', '')}`);
console.log(`    npm run images:import -- --slug <slug> ${p.images.slice(0, 2).map((u) => `--url ${u}`).join(' ')} …\n`);
