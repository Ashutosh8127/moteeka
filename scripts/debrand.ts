import { products, findProduct, saveProduct } from '../src/lib/catalogue.ts';
import { setSourcing, getSourcing } from '../src/lib/sourcing.ts';

/**
 * Takes the supplier's identity off the catalogue and puts your own on it.
 *
 *   npm run debrand -- --brand "Moteeka"
 *   npm run debrand -- --brand "Moteeka" --slug jhumka
 *   npm run debrand -- --dry-run
 *
 * A listing arrives carrying the manufacturer's brand, their model number and
 * their sourcing detail. None of that belongs on your storefront — you are
 * selling under your own label. This moves every such field into the private
 * sourcing record and leaves the genuine product specification behind.
 *
 * Country of origin is moved, not deleted. It is a mandatory declaration on
 * Indian marketplace listings and on the package under the Legal Metrology
 * (Packaged Commodities) Rules, so it is kept in data/sourcing.json where you
 * can read it when filling those in — it just stops being marketing copy.
 */

/** Fields that identify the supplier or their listing, never your product. */
const SUPPLIER_FIELDS = [
  'brand name', 'brand', 'model number', 'model', 'oem/odm', 'oem', 'odm',
  'keyword', 'key word', 'keywords', 'certificate type', 'supplier moq',
  'place of origin', 'country of origin', 'origin', 'supplier', 'supplier listing',
  'data status', 'production capacity', 'port', 'payment terms', 'lead time',
];

/** These name where a thing was made — kept privately for compliance. */
const ORIGIN_FIELDS = ['place of origin', 'country of origin', 'origin'];

/**
 * A listing fills every field its category offers, so half of them come back
 * saying "Other" — a spec row that tells a buyer nothing except that the form
 * had a box. "None" is different: it answers the question.
 */
const EMPTY_VALUES = /^(other|others|n\/a|na|-|\.)$/i;

/** Wholesale plumbing that has no place on a consumer product page. */
const TRADE_FIELDS = /mould making|sample making|customi[sz]ation|\bmoq\b|\boem\b|\bodm\b|production capacity|delivery time|packing|port of/i;

const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf('--' + k);
  return i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const dryRun = argv.includes('--dry-run');
const brand = flag('brand');
const only = flag('slug');

const targets = only ? [findProduct(only)].filter(Boolean) : products.all();
if (targets.length === 0) {
  console.error(`\n  no product "${only}"\n`);
  process.exit(1);
}

let changed = 0;
for (const p of targets) {
  if (!p) continue;
  const kept: Record<string, string> = {};
  const moved: Record<string, string> = {};
  const dropped: Record<string, string> = {};
  let origin: string | undefined;

  for (const [key, value] of Object.entries(p.details)) {
    const k = key.trim().toLowerCase();
    // A Brand already equal to yours is your own stamp from a previous run,
    // not the manufacturer's — leave it where it is.
    if (SUPPLIER_FIELDS.includes(k) && !(k === 'brand' && brand && value === brand)) {
      moved[key] = value;
      if (ORIGIN_FIELDS.includes(k)) origin = value;
    } else if (
      // The product already has material and finish as fields of its own, and
      // the page prints those above the spec table — a row repeating either is
      // the same answer given twice.
      (/material|plating|finish/i.test(key)
        && [p.material, p.finish].some((f) => f && f.trim().toLowerCase() === value.trim().toLowerCase()))
      || EMPTY_VALUES.test(value.trim()) || TRADE_FIELDS.test(key)) {
      dropped[key] = value;
    } else {
      kept[key] = value;
    }
  }

  // Your own label replaces theirs.
  if (brand) kept['Brand'] = brand;

  // A supplier's model number is not your SKU; yours already exist on variants.
  const before = Object.keys(p.details).length;
  const after = Object.keys(kept).length;
  if (Object.keys(moved).length === 0 && Object.keys(dropped).length === 0 && !brand) continue;

  console.log(`\n  ${p.title}`);
  console.log(`    specs ${before} → ${after}`);
  for (const [k, v] of Object.entries(moved)) {
    console.log(`    moved to sourcing:  ${k} = ${v.slice(0, 46)}`);
  }
  if (brand) console.log(`    Brand = ${brand}`);
  const emptied = Object.keys(dropped);
  if (emptied.length) console.log(`    dropped as noise:   ${emptied.join(', ')}`);

  if (!dryRun) {
    saveProduct({ ...p, details: kept });
    const existing = (await getSourcing(p.id)) ?? {};
    await setSourcing(p.id, {
      ...existing,
      ...(origin ? { countryOfOrigin: origin } as never : {}),
      supplierAttributes: moved,
    } as never);
  }
  changed++;
}

console.log(`\n  ${changed} product(s)${dryRun ? ' would be' : ''} de-branded`);
if (!dryRun && changed) {
  console.log('  supplier fields now live in data/sourcing.json (private, gitignored)');
  console.log('  country of origin is kept there — it is still required on the pack and');
  console.log('  on marketplace listings, it just no longer appears in your product copy.\n');
}
