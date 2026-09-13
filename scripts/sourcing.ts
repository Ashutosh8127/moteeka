import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
import { products } from '../src/lib/catalogue.ts';
import { getSourcing, setSourcing, allSourcing, type VariantSourcing } from '../src/lib/sourcing.ts';
import { parseDetailData, extractDetailData, type ScrapedProduct } from '../src/lib/supplier-payload.ts';

/**
 * Turning an order into a reorder.
 *
 *   npm run sourcing -- --sku HOO-STU-GOLDMI     one line, for fulfilling
 *   npm run sourcing -- --slug hoop-earring-set  the whole product
 *   npm run sourcing -- --audit                  every product, gaps flagged
 *   npm run sourcing -- --link <slug> --from ./captured/<id>.json
 *
 * The catalogue shows your SKU and your brand and nothing about who makes it.
 * That is the point — but it means the private record in data/sourcing.json is
 * the only thing that can answer "a customer bought HOO-STU-GOLDMI, what do I
 * order?". This prints that answer.
 *
 * Nothing here is served: data/sourcing.json is gitignored and no route reads it.
 */
const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf('--' + k);
  return i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const has = (k: string) => argv.includes('--' + k);
const inr = (paise?: number) => (paise == null ? '—' : '₹' + (paise / 100).toFixed(2));

async function show(slug: string): Promise<boolean> {
  const p = products.get((x) => x.slug === slug || x.id === slug);
  if (!p) { console.error(`\n  no product "${slug}"\n`); return false; }
  const src = await getSourcing(p.id);
  console.log(`\n  ${p.title}`);
  console.log(`  supplier  ${src?.supplier ?? '— not recorded'}`);
  if (src?.sourceUrl) console.log(`  listing   ${src.sourceUrl}`);
  console.log('');
  console.log(`    ${'YOUR SKU'.padEnd(18)}${'VARIANT'.padEnd(26)}${'THEIR CODE'.padEnd(20)}THEIR COST`);
  let gaps = 0;
  for (const v of p.variants) {
    const s = src?.variants?.[v.sku];
    if (!s) gaps++;
    console.log(`    ${v.sku.padEnd(18)}${v.label.padEnd(26)}${(s?.supplierSku ?? '— MISSING').padEnd(20)}${inr(s?.costPaise)}`);
  }
  if (gaps) {
    console.log(`\n  ${gaps} variant(s) have no supplier reference — you could not reorder these.`);
    console.log(`  npm run sourcing -- --link ${p.slug} --from ./captured/<id>.json`);
  }
  return gaps === 0;
}

// ---- one SKU, the fulfilment case ----------------------------------------
const sku = flag('sku');
if (sku) {
  for (const p of products.all()) {
    const v = p.variants.find((x) => x.sku === sku);
    if (!v) continue;
    const src = await getSourcing(p.id);
    const s = src?.variants?.[sku];
    console.log(`\n  ${sku}  —  ${p.title}, ${v.label}`);
    console.log(`  you sell at   ${inr(v.price)}   (${v.stock} in stock)`);
    console.log(`  order from    ${src?.supplier ?? '— not recorded'}`);
    console.log(`  their code    ${s?.supplierSku ?? '— MISSING, cannot reorder'}`);
    if (s?.supplierSkuId) console.log(`  their sku id  ${s.supplierSkuId}`);
    console.log(`  their price   ${inr(s?.costPaise)}`);
    if (src?.sourceUrl) console.log(`  listing       ${src.sourceUrl}`);
    console.log('');
    process.exit(s ? 0 : 1);
  }
  console.error(`\n  no variant with SKU "${sku}" in the catalogue\n`);
  process.exit(1);
}

// ---- backfill from the captured payload -----------------------------------
const link = flag('link');
if (link) {
  const from = flag('from');
  if (!from || !existsSync(from)) {
    console.error('\n  --link <slug> needs --from ./captured/<id>.json\n');
    process.exit(1);
  }
  const p = products.get((x) => x.slug === link || x.id === link);
  if (!p) { console.error(`\n  no product "${link}"\n`); process.exit(1); }

  const raw = readFileSync(from, 'utf8');
  const data = from.endsWith('.json') ? JSON.parse(raw) : extractDetailData(raw);
  const parsed: ScrapedProduct | null = data ? parseDetailData(data as never) : null;
  if (!parsed) { console.error('\n  no product payload in that file\n'); process.exit(1); }

  /**
   * Two ways to pair a catalogue variant with a listing one, in this order:
   *
   *   by label    the variant still carries the name the listing gave it
   *   by position what is left over, in import order
   *
   * Position is a guess, not a fact — a product built by hand or extended with
   * --add-missing is in no particular order, and pairing it that way produced
   * "Silver → Green". So every row says which method it used and nothing is
   * written until you have read them.
   */
  interface Slot { t: ScrapedProduct['variants'][number]; taken: boolean }
  const pool: Slot[] = parsed.variants.map((t) => ({ t, taken: false }));
  const byLabel = new Map<string, Slot>();
  for (const e of pool) if (!byLabel.has(e.t.label)) byLabel.set(e.t.label, e);

  const pairs: Array<{ v: typeof p.variants[number]; e: Slot | null; how: 'label' | 'position' }> =
    p.variants.map((v) => {
      const hit = byLabel.get(v.label);
      if (hit && !hit.taken) { hit.taken = true; return { v, e: hit, how: 'label' }; }
      return { v, e: null, how: 'position' };
    });
  const leftovers = pool.filter((e) => !e.taken);
  for (const pair of pairs) {
    if (pair.e) continue;
    const next = leftovers.shift();
    if (next) { next.taken = true; pair.e = next; }
  }

  const guessed = pairs.filter((x) => x.how === 'position').length;
  const table: Record<string, VariantSourcing> = {};
  console.log(`\n  ${p.title} — check every row before accepting:\n`);
  for (const { v, e, how } of pairs) {
    if (!e) { console.log(`    ${v.sku.padEnd(18)}${v.label.padEnd(26)}→  — nothing left to pair with`); continue; }
    table[v.sku] = {
      supplierSku: e.t.label,
      ...(e.t.skuId != null ? { supplierSkuId: String(e.t.skuId) } : {}),
      ...(e.t.inr != null ? { costPaise: Math.round(e.t.inr * 100) } : {}),
    };
    console.log(`    ${how === 'label' ? '=' : '?'} ${v.sku.padEnd(18)}${v.label.padEnd(26)}→  ${e.t.label}`);
  }

  console.log(`\n  ${pairs.length - guessed} matched by label (=), ${guessed} guessed by position (?)`);
  if (parsed.variants.length !== p.variants.length) {
    console.log(`  the listing has ${parsed.variants.length} variant(s), this product has ${p.variants.length}`);
  }
  if (guessed) console.log('  a ? row is a guess. Wrong here means you reorder the wrong thing.');

  if (!has('yes')) {
    console.log('\n  add --yes to write this.\n');
    process.exit(0);
  }
  await setSourcing(p.id, {
    sourceUrl: parsed.url, supplier: parsed.supplier.name || undefined, variants: table,
  });
  console.log(`\n  written — ${Object.keys(table).length} reorder reference(s)\n`);
  process.exit(0);
}

// ---- a product, or everything ---------------------------------------------
const slug = flag('slug');
if (slug) { process.exit(await show(slug) ? 0 : 1); }

if (has('audit') || argv.length === 0) {
  const all = await allSourcing();
  let unfulfillable = 0;
  console.log('');
  for (const p of products.all()) {
    const src = all[p.id];
    const missing = p.variants.filter((v) => !src?.variants?.[v.sku]);
    const mark = missing.length === 0 ? 'ok  ' : `${String(missing.length).padStart(2)} × `;
    if (missing.length) unfulfillable += missing.length;
    console.log(`  ${mark}${p.slug.padEnd(40)}${p.variants.length} variant(s)  ${src?.supplier ?? '—'}`);
  }
  console.log(unfulfillable === 0
    ? '\n  every variant in the catalogue can be reordered\n'
    : `\n  ${unfulfillable} variant(s) have no supplier reference — an order for one could not be filled.\n`
      + '  npm run sourcing -- --slug <slug>   shows which\n');
  process.exit(unfulfillable === 0 ? 0 : 1);
}

console.error('\n  usage: npm run sourcing -- [--sku <SKU> | --slug <slug> | --audit | --link <slug> --from <captured.json> --yes]\n');
process.exit(1);
