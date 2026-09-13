import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../src/config.ts';
import { categories as categoryStore } from '../src/lib/catalogue.ts';
import { products as productStore } from '../src/lib/catalogue.ts';
import type { Category, Product, Variant } from '../src/types.ts';
import { setSourcing, type VariantSourcing } from '../src/lib/sourcing.ts';
import { priceFor, pricingRecord } from '../src/lib/landed-cost.ts';

/**
 * Turns what a supplier sends you into a catalogue entry.
 *
 *   npm run product:add -- ./intake/jhumka.json
 *
 * Fill in supplier-intake.template.json, point this at it, and the product,
 * its variants, its SKUs and its images all land in one step. New products
 * default to `draft` — they are not on the storefront until you have checked
 * the price and the photographs and flipped them to `active`.
 */
const file = process.argv[2];
if (!file) {
  console.error('\n  usage: npm run product:add -- <intake.json>');
  console.error('  start from supplier-intake.template.json\n');
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`\n  no such file: ${file}\n`);
  process.exit(1);
}

interface Intake {
  _orderQty?: number;
  title: string;
  category: string;
  tagline?: string;
  description?: string;
  material?: string;
  finish?: string;
  details?: Record<string, string>;
  variants?: Array<{ label: string; priceRupees: number; compareAtRupees?: number; stock?: number;
    weightGrams?: number; sku?: string;
    _supplierSku?: string | null; _supplierSkuId?: string | null; _supplierCostRupees?: number | null }>;
  tags?: string[];
  featured?: boolean;
  status?: Product['status'];
  sourceUrl?: string;
  supplier?: string;
  images?: string[];
}

const intake = JSON.parse(readFileSync(file, 'utf8')) as Intake;
const fail: (msg: string) => never = (msg) => { console.error(`\n  ${msg}\n`); process.exit(1); };

if (!intake.title?.trim()) fail('title is required');
if (!intake.category?.trim()) fail('category is required');
if (!intake.variants?.length) fail('at least one variant is required — a product needs a price');

const categories = categoryStore.read();
if (!categories.some((c) => c.slug === intake.category)) {
  fail(`unknown category "${intake.category}". Known: ${categories.map((c) => c.slug).join(', ')}`);
}

/** Supplier titles are keyword soup, so cut at a word boundary, not mid-word. */
const slugify = (s: string) => {
  const full = s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (full.length <= 60) return full;
  const cut = full.slice(0, 60);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 24 ? cut.slice(0, lastDash) : cut).replace(/-$/, '');
};

const store = productStore;
const existing = store.all();

let slug = slugify(intake.title);
if (existing.some((p) => p.slug === slug)) {
  let n = 2;
  while (existing.some((p) => p.slug === `${slug}-${n}`)) n++;
  slug = `${slug}-${n}`;
  console.log(`  slug already taken — using "${slug}"`);
}

/**
 * The words every variant label shares carry no information — nine labels
 * reading "Design N One Piece - Gold Color" differ only in N, and taking the
 * first four characters of each gives you nine SKUs all ending "STAN".
 */
const labelTokens = (label: string) => label.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
const allLabels = (intake.variants ?? []).map((v) => v.label ?? '');
const shared = allLabels.length > 1
  ? labelTokens(allLabels[0]!).filter((t) => allLabels.every((l) => labelTokens(l).includes(t)))
  : [];

/** SKU: three letters of the category, three of the title, then the variant. */
function makeSku(label: string, index: number): string {
  const cat = intake.category.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase();
  const nm = intake.title.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase();
  const distinct = labelTokens(label).filter((t) => !shared.includes(t));
  const basis = (distinct.length ? distinct : labelTokens(label)).join('');
  const vr = basis.slice(0, 6).toUpperCase() || String(index + 1);
  return `${cat}-${nm}-${vr}`;
}

const seen = new Set(existing.flatMap((p) => p.variants.map((v) => v.sku)));
const variants: Variant[] = intake.variants.map((v, i) => {
  if (!Number.isFinite(v.priceRupees)) fail(`variant "${v.label}" has no priceRupees`);
  let sku = v.sku ?? makeSku(v.label ?? '', i);
  let n = 2;
  while (seen.has(sku)) sku = `${v.sku ?? makeSku(v.label ?? '', i)}-${n++}`;
  seen.add(sku);
  return {
    sku,
    label: v.label ?? `Option ${i + 1}`,
    price: Math.round(v.priceRupees * 100),
    compareAt: v.compareAtRupees ? Math.round(v.compareAtRupees * 100) : undefined,
    stock: Math.max(0, Math.trunc(v.stock ?? 0)),
    weightGrams: v.weightGrams,
  };
});

// A slug can be renamed later while the id stays put, which frees the original
// slug for a new product — and would hand it the same id. Ids are what orders
// reference, so they have to be unique on their own.
let id = `p-${slug}`;
if (existing.some((p) => p.id === id)) {
  let n = 2;
  while (existing.some((p) => p.id === `${id}-${n}`)) n++;
  id = `${id}-${n}`;
  console.log(`  id already in use by another product — using "${id}"`);
}

const now = new Date().toISOString();
const product: Product = {
  id,
  slug,
  title: intake.title.trim(),
  category: intake.category,
  tagline: intake.tagline?.trim() ?? '',
  description: intake.description?.trim() ?? '',
  material: intake.material?.trim() ?? '',
  finish: intake.finish?.trim() ?? '',
  details: intake.details ?? {},
  images: [],
  variants,
  tags: intake.tags ?? [],
  featured: intake.featured ?? false,
  // Draft by default: nothing reaches the storefront before you have looked at it.
  status: intake.status ?? 'draft',
  createdAt: now,
  updatedAt: now,
};

store.put(product);

// Where it came from is recorded privately, not on the product.
//
// The per-variant table is the important half: your SKU is what an order
// carries, and the supplier's part number is what you put on a reorder. The
// catalogue deliberately shows neither their code nor their name, so without
// this map a paid order is unfulfillable.
const variantSourcing: Record<string, VariantSourcing> = {};
intake.variants!.forEach((v, i) => {
  const supplierSku = v._supplierSku ?? v.label;
  if (!supplierSku) return;
  const costPaise = v._supplierCostRupees != null ? Math.round(v._supplierCostRupees * 100) : undefined;
  const sku = variants[i]!.sku;
  variantSourcing[sku] = {
    supplierSku,
    ...(v._supplierSkuId ? { supplierSkuId: v._supplierSkuId } : {}),
    ...(costPaise != null ? { costPaise } : {}),
  };

  // Store the whole cost stack at import, so `npm run price` has nothing to
  // catch up on and the number on the page can always be traced to a cost.
  if (costPaise == null) return;
  const orderQty = Number(intake._orderQty ?? 50);
  const input = { supplierPaise: costPaise, orderQty, weightGrams: variants[i]!.weightGrams };
  try {
    const record = pricingRecord(priceFor(input), input);
    if (variants[i]!.price !== record['final']) record['manualOverride'] = true;
    variantSourcing[sku]!.pricing = record as never;
  } catch { /* an unreachable margin is reported by `npm run price`, not here */ }
});

if (intake.sourceUrl || intake.supplier || Object.keys(variantSourcing).length) {
  await setSourcing(product.id, {
    sourceUrl: intake.sourceUrl,
    supplier: intake.supplier,
    ...(Object.keys(variantSourcing).length ? { variants: variantSourcing } : {}),
  });
}

console.log(`\n  added ${product.title}`);
console.log(`  slug      ${product.slug}`);
console.log(`  status    ${product.status}${product.status === 'draft' ? '  (not on the storefront yet)' : ''}`);
for (const v of variants) {
  console.log(`  variant   ${v.sku.padEnd(18)} ${v.label.padEnd(20)} ₹${(v.price / 100).toFixed(0)}  stock ${v.stock}`);
}

const photos = (intake.images ?? []).map((p) => resolve(p)).filter((p) => {
  if (existsSync(p)) return true;
  console.warn(`  image missing, skipped: ${p}`);
  return false;
});

if (photos.length) {
  console.log(`\n  importing ${photos.length} image(s)…`);
  execFileSync('node', [join(ROOT, 'scripts', 'import-images.ts'), '--slug', slug, ...photos], { stdio: 'inherit' });
} else {
  // Nothing is drawn in their place: a product with no photograph stays off
  // the storefront until there is something real to show.
  console.log(`\n  no images yet — this piece stays a draft until there are.`);
  console.log(`    npm run images:import -- --slug ${slug} --dir ./intake/photos/${slug}`);
}

console.log(`  when the price and photos are confirmed:  npm run edit -- ${slug} --status active\n`);
