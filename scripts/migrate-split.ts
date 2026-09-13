import { readFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
import { products } from '../src/lib/catalogue.ts';
import type { Product } from '../src/types.ts';

/**
 * Splits a single data/products.json into data/products/<slug>.json, one file
 * per piece. Safe to run twice — the old file is renamed, not deleted.
 */
const legacy = join(ROOT, 'data', 'products.json');
if (!existsSync(legacy)) {
  console.log(`\n  nothing to migrate — data/products.json is already gone\n`);
  process.exit(0);
}

const all = JSON.parse(readFileSync(legacy, 'utf8')) as Product[];
for (const p of all) products.put(p);
renameSync(legacy, legacy + '.bak');

console.log(`\n  split ${all.length} product(s) into data/products/`);
for (const p of all) console.log(`    ${p.slug}.json`);
console.log(`\n  the old file is kept as data/products.json.bak — delete it once you are happy\n`);
