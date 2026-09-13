import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
import type { Category } from '../src/types.ts';

/**
 * Sets up an empty shop: the category list and nothing else.
 *
 * This used to seed a sample catalogue of ten pieces with invented prices and
 * invented stock, each drawn as a stand-in image. That is gone. Every piece on
 * the storefront is now a real piece with a real photograph and a price that
 * came out of the costing model — and a seeder that can put fiction back into
 * data/products/ with one mistyped command is a liability, not a convenience.
 *
 * Products come from `npm run onboard` and `npm run onboard:batch`.
 */
const categories: Category[] = [
  { slug: 'jhumka', name: 'Jhumka & Jhumki', description: 'Bell-shaped drops, the shape the whole craft is known for.', sortOrder: 1 },
  { slug: 'earrings', name: 'Earrings', description: 'Studs, drops, chandbalis and hoops in oxidised silver.', sortOrder: 2 },
  { slug: 'necklaces', name: 'Necklaces & Haar', description: 'Chokers, long haar and temple-work pendants.', sortOrder: 3 },
  { slug: 'bangles', name: 'Bangles & Kada', description: 'Stacking bangles, cuffs and broad kada.', sortOrder: 4 },
  { slug: 'anklets', name: 'Anklets & Payal', description: 'Ghungroo payal and plain chain anklets.', sortOrder: 5 },
  { slug: 'rings', name: 'Rings & Nose Pins', description: 'Adjustable rings, thumb rings and nath.', sortOrder: 6 },
];

const force = process.argv.includes('--force');
const catFile = join(ROOT, 'data', 'categories.json');
const orderFile = join(ROOT, 'data', 'orders.json');

mkdirSync(join(ROOT, 'data', 'products'), { recursive: true });

// Categories are edited by hand once a shop is running, so never overwrite a
// list that already exists unless it is asked for outright.
if (existsSync(catFile) && !force) {
  console.log(`\n  data/categories.json already exists — left alone.`);
  console.log(`  npm run seed -- --force   to overwrite it with the ${categories.length} defaults\n`);
} else {
  writeFileSync(catFile, JSON.stringify(categories, null, 2) + '\n');
  console.log(`\n  wrote ${categories.length} categories to data/categories.json`);
}

// An order file is created empty, never emptied.
if (!existsSync(orderFile)) writeFileSync(orderFile, '[]\n');

console.log(`\n  next:  npm run onboard -- <listing url>   then   npm run dev\n`);
