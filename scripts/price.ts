import { products, saveProduct } from '../src/lib/catalogue.ts';
import { getSourcing, setSourcing, type VariantPricing } from '../src/lib/sourcing.ts';
import { costs, priceFor, pricingRecord, marginAt } from '../src/lib/landed-cost.ts';
import type { Product } from '../src/types.ts';

/**
 * Computes the whole cost stack for every variant and keeps it on file.
 *
 *   npm run price                      what would change, nothing written
 *   npm run price -- --write           store the breakdown in data/sourcing.json
 *   npm run price -- --write --apply   and set the catalogue price to it
 *   npm run price -- --slug jhumka --write --apply
 *   npm run price -- --keep-price      recompute the stack, leave prices alone
 *
 * The breakdown is private, because it names what you pay. Only `final`
 * reaches the catalogue, as the price on the page.
 *
 * Re-run it whenever data/costs.json changes — freight quotes, a budget that
 * moves duty, or the first month of real return data. Everything here is
 * derived, so it can always be rebuilt.
 */
const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf('--' + k);
  return i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const has = (k: string) => argv.includes('--' + k);

const write = has('write');
const apply = has('apply');
const keepPrice = has('keep-price');
const qty = Number(flag('qty') ?? 50);
const c = costs();

const inr = (p: number) => '₹' + (p / 100).toFixed(2);
const only = flag('slug');
const targets = only
  ? products.all().filter((p) => p.slug === only || p.id === only)
  : products.all();
if (targets.length === 0) { console.error(`\n  no product "${only}"\n`); process.exit(1); }

let priced = 0, repriced = 0, skipped = 0, kept = 0;
const moves: Array<{ sku: string; label: string; from: number; to: number }> = [];

for (const product of targets) {
  const src = await getSourcing(product.id);
  const table = src?.variants ?? {};
  const nextVariants: Product['variants'] = [];
  const nextTable: Record<string, typeof table[string]> = { ...table };
  let touched = false;

  for (const v of product.variants) {
    const entry = table[v.sku];
    if (!entry?.costPaise) {
      // Nothing to price against — a seeded placeholder, or an import that
      // predates the sourcing table.
      skipped++;
      nextVariants.push(v);
      continue;
    }

    const input = { supplierPaise: entry.costPaise, orderQty: qty, weightGrams: v.weightGrams };
    let record: Record<string, unknown>;
    try {
      record = pricingRecord(priceFor(input, c), input, c);
    } catch (e) {
      console.warn(`  ${v.sku}: ${e instanceof Error ? e.message : e}`);
      nextVariants.push(v);
      continue;
    }

    const final = record['final'] as number;
    const differs = final !== v.price;
    const willApply = apply && !keepPrice && differs;
    if (differs) moves.push({ sku: v.sku, label: v.label, from: v.price, to: final });

    // A price that ends up different from the computed one is a decision
    // someone made, so it is recorded as such — the next audit can then tell a
    // deliberate price from a stale one.
    if (differs && !willApply) {
      const at = marginAt(v.price, record['costToServe'] as number, c);
      record['margin'] = at.profit;
      record['marginPct'] = Number(at.marginPct.toFixed(1));
      record['gst'] = at.gst;
      record['gateway'] = at.fees;
      record['final'] = v.price;
      record['manualOverride'] = true;
      kept++;
    }

    nextTable[v.sku] = { ...entry, pricing: record as unknown as VariantPricing };
    nextVariants.push(willApply ? { ...v, price: final } : v);
    if (willApply) repriced++;
    priced++;
    touched = true;
  }

  if (touched && write) {
    await setSourcing(product.id, { ...src, variants: nextTable } as never);
    if (apply && !keepPrice) saveProduct({ ...product, variants: nextVariants, updatedAt: new Date().toISOString() });
  }
}

const applying = apply && !keepPrice;
if (moves.length) {
  // Biggest move first: that is the one worth arguing about.
  moves.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  console.log(`\n  ${'SKU'.padEnd(18)}${'VARIANT'.padEnd(28)}${'NOW'.padStart(10)}`
    + `${(applying ? 'SET TO' : 'SHOULD BE').padStart(12)}`);
  for (const m of moves) {
    console.log(`  ${m.sku.padEnd(18)}${m.label.slice(0, 26).padEnd(28)}`
      + inr(m.from).padStart(10) + inr(m.to).padStart(12)
      + `   ${m.to > m.from ? '+' : ''}${((m.to - m.from) / 100).toFixed(0)}`);
  }
}

console.log(`\n  ${priced} variant(s) costed`
  + (skipped ? `, ${skipped} with no supplier cost on file` : ''));
if (!write) {
  console.log(`  ${moves.length} price(s) differ from the model — nothing written.`);
  console.log('  --write stores the breakdown; --apply also sets the prices\n');
} else if (applying) {
  console.log(`  breakdown stored in data/sourcing.json, ${repriced} price(s) updated\n`);
} else {
  console.log(`  breakdown stored in data/sourcing.json, prices left alone`);
  console.log(`  ${kept} price(s) recorded as set by hand\n`);
}
