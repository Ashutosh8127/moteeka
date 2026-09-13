import { products } from '../src/lib/catalogue.ts';
import { getSourcing } from '../src/lib/sourcing.ts';
import { costs, landedCost, priceFor, type Costs } from '../src/lib/landed-cost.ts';
import type { Product } from '../src/types.ts';

/**
 * What a piece costs to land and sell, and what it has to be priced at.
 *
 *   npm run cost -- --sku JHU-SILVER
 *   npm run cost -- --slug jhumka
 *   npm run cost -- --supplier 101 --qty 50 --weight 25
 *   npm run cost -- --audit            every priced variant, against its cost
 *
 * Supplier cost comes from data/sourcing.json, which the import recorded. The
 * rest comes from data/costs.json, which is yours to correct.
 */
const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf('--' + k);
  return i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const has = (k: string) => argv.includes('--' + k);
const num = (k: string) => (flag(k) === undefined ? undefined : Number(flag(k)));

const inr = (p: number) => '₹' + (p / 100).toFixed(2);
const pad = (s: string, n = 30) => s.padEnd(n);
const row = (label: string, value: number, note = '') =>
  console.log(`    ${pad(label)}${inr(value).padStart(11)}${note ? '   ' + note : ''}`);

const c: Costs = costs();
const qty = num('qty') ?? 50;

function breakdown(supplierPaise: number, weightGrams: number | undefined, title: string) {
  const b = priceFor({ supplierPaise, orderQty: qty, weightGrams }, c);
  const l = b.landed;
  const grams = weightGrams ?? c.import.defaultWeightGrams;

  console.log(`\n  ${title}`);
  console.log(`  ${grams} g, ordering ${qty} at a time\n`);

  console.log('  GETTING IT HERE');
  row('supplier price', l.fob);
  row('freight from China', l.freight, `${c.import.freightPerKg / 100}/kg`);
  row('insurance', l.insurance, `${c.import.insurancePctOfFob}% of supplier price`);
  row('= assessed value (CIF)', l.cif);
  row('basic customs duty', l.basicDuty, `${c.import.basicCustomsDutyPct}%`);
  row('social welfare surcharge', l.surcharge, `${c.import.socialWelfareSurchargePct}% of duty`);
  row('clearance, per piece', l.clearance, `${inr(c.import.clearanceFeePerShipment)} ÷ ${qty}`);
  row('LANDED COST', l.landed);
  if (l.igstIsCreditable) {
    console.log(`    ${pad('(IGST at the border)')}${inr(l.igstOnImport).padStart(11)}   paid now, credited back — not a cost`);
    row('cash you must fund', l.cashOutlay);
  } else {
    row('IGST at the border', l.igstOnImport, 'NOT creditable — you are not registered');
  }

  console.log('\n  GETTING IT TO THE CUSTOMER');
  row('courier + packaging', b.sale.fulfilment);
  row('returns provision', b.sale.returnsProvision,
    `${c.returns.ratePct}% come back`);
  row('COST TO SERVE', b.costToServe);

  console.log('\n  THE PRICE');
  console.log(`    ${pad('list price, GST included')}${inr(b.price).padStart(11)}`
    + `   ${b.multipleOfSupplier.toFixed(1)}× the supplier price`);
  row('less GST you remit', -b.outputGst, `${c.pricing.outputGstPct}%`);
  row('less payment gateway', -b.gatewayFee, `${c.fulfilment.paymentGatewayPct}%`);
  if (b.commission) row('less marketplace commission', -b.commission, `${c.fulfilment.marketplaceCommissionPct}%`);
  row('less cost to serve', -b.costToServe);
  row('PROFIT PER PIECE', b.profit, `${b.marginPct.toFixed(0)}% of net revenue`);
  console.log(`\n    ${pad('GST payable after import credit')}${inr(b.netGstPayable).padStart(11)}`);
  return b;
}

// ---- a bare cost, no catalogue involved -----------------------------------
const supplierRupees = num('supplier');
if (supplierRupees !== undefined) {
  breakdown(Math.round(supplierRupees * 100), num('weight'), `₹${supplierRupees} from the supplier`);
  console.log('');
  process.exit(0);
}

// ---- one SKU ---------------------------------------------------------------
async function variantsOf(p: Product) {
  const src = await getSourcing(p.id);
  return p.variants.map((v) => ({ v, cost: src?.variants?.[v.sku]?.costPaise }));
}

const sku = flag('sku');
if (sku) {
  for (const p of products.all()) {
    const hit = (await variantsOf(p)).find((x) => x.v.sku === sku);
    if (!hit) continue;
    if (hit.cost === undefined) {
      console.error(`\n  no supplier cost recorded for ${sku} — npm run sourcing -- --slug ${p.slug}\n`);
      process.exit(1);
    }
    const b = breakdown(hit.cost, hit.v.weightGrams, `${p.title} — ${hit.v.label}  (${sku})`);
    console.log(`\n    you currently sell it at ${inr(hit.v.price)}`
      + (hit.v.price < b.price ? `  — ${inr(b.price - hit.v.price)} under` : ''));
    console.log('');
    process.exit(0);
  }
  console.error(`\n  no variant with SKU "${sku}"\n`);
  process.exit(1);
}

// ---- a whole product, or the whole catalogue --------------------------------
async function audit(list: Product[]) {
  console.log(`\n  ${pad('SKU', 18)}${pad('VARIANT', 26)}${'COST'.padStart(9)}${'YOU CHARGE'.padStart(12)}${'SHOULD BE'.padStart(11)}${'MARGIN'.padStart(9)}`);
  let under = 0, missing = 0, loss = 0;
  for (const p of list) {
    for (const { v, cost } of await variantsOf(p)) {
      if (cost === undefined) { missing++; continue; }
      const b = priceFor({ supplierPaise: cost, orderQty: qty, weightGrams: v.weightGrams }, c);
      // What this variant actually earns at the price on the page today.
      const net = Math.round(v.price / (1 + c.pricing.outputGstPct / 100));
      const fees = Math.round((v.price * (c.fulfilment.paymentGatewayPct + c.fulfilment.marketplaceCommissionPct)) / 100);
      const actual = net - b.costToServe - fees;
      const margin = net === 0 ? 0 : (actual / net) * 100;
      if (actual < 0) loss++;
      if (v.price < b.price) under++;
      const mark = actual < 0 ? ' LOSS' : v.price < b.price ? '  low' : '';
      console.log(`  ${pad(v.sku, 18)}${pad(v.label.slice(0, 24), 26)}`
        + inr(cost).padStart(9) + inr(v.price).padStart(12) + inr(b.price).padStart(11)
        + `${margin.toFixed(0)}%`.padStart(8) + mark);
    }
  }
  console.log(`\n  ${under} variant(s) priced below the model, ${loss} sold at a loss`
    + (missing ? `, ${missing} with no recorded cost` : ''));
  console.log('  npm run cost -- --sku <SKU>   shows one in full\n');
}

const slug = flag('slug');
if (slug) {
  const p = products.get((x) => x.slug === slug || x.id === slug);
  if (!p) { console.error(`\n  no product "${slug}"\n`); process.exit(1); }
  await audit([p]);
  process.exit(0);
}

if (has('audit')) { await audit(products.all()); process.exit(0); }

console.error(`
  usage: npm run cost -- [--sku <SKU> | --slug <slug> | --audit | --supplier <rupees>]

    --qty <n>         units per shipment, for the clearance fee (default 50)
    --weight <grams>  shipped weight of one piece
    --supplier <₹>    price a cost with no catalogue entry

  Assumptions live in data/costs.json. Every rate there is yours to check.
`);
process.exit(1);
