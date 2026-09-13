import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
import { openRepo } from '../src/repo/index.ts';
import { JsonRepo } from '../src/repo/json-repo.ts';

/**
 * Pushes the catalogue from data/ into Firestore.
 *
 * The catalogue is authored by the scripts in this folder against files — that
 * is deliberate, because editing a product should be a diff you can read. This
 * is how it reaches the database the storefront then reads from.
 *
 *   npm run firestore:sync -- --dry-run
 *   npm run firestore:sync
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npm run firestore:sync
 *
 * Orders are never synced. They are written by customers into Firestore and
 * the copy in data/orders.json is whatever the JSON driver recorded before you
 * moved — pushing one over the other would lose real orders.
 *
 * `--sourcing` also pushes the private record: supplier, listing URL, their
 * part number per SKU, and the whole cost stack. It is the half you cannot
 * rebuild from the catalogue, and the half that would be lost on a host with
 * no real filesystem. firestore.rules denies every client read of it.
 *
 * `data/costs.json` and `data/business.json` are configuration, not data —
 * you edit and commit them, and the image ships them. Nothing to sync.
 */
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const withSourcing = argv.includes('--sourcing');

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIRESTORE_PROJECT_ID;
if (!emulator && !project) {
  console.error('\n  set GOOGLE_CLOUD_PROJECT, or FIRESTORE_EMULATOR_HOST to use the emulator\n');
  process.exit(1);
}

const source = new JsonRepo(ROOT);
const products = (await source.listProducts({ perPage: 100, includeDrafts: true })).items;
const categories = await source.listCategories();

// Read the private record through the JSON driver explicitly: the default
// driver may already be firestore, and this script's whole job is to move it
// from one to the other.
const sourcing = withSourcing
  ? JSON.parse(readFileSync(join(ROOT, 'data', 'sourcing.json'), 'utf8')) as Record<string, unknown>
  : {};

console.log(`\n  from data/   ${products.length} product(s), ${categories.length} categor(ies)`);
console.log(`  to           ${emulator ? `emulator at ${emulator}` : `project ${project}`}`);

if (withSourcing) {
  const rows = Object.keys(sourcing).length;
  const costed = Object.values(sourcing).filter((e) =>
    Object.values((e as { variants?: Record<string, { pricing?: unknown }> }).variants ?? {})
      .some((v) => v.pricing)).length;
  console.log(`  sourcing     ${rows} product record(s), ${costed} carrying a cost stack`);
} else {
  console.log('  sourcing     not included — add --sourcing to move the private record too');
}

if (dryRun) {
  for (const p of products) {
    console.log(`    ${p.slug.padEnd(40)}${p.status.padEnd(9)}${p.variants.length} variant(s)`);
  }
  console.log('\n  --dry-run, nothing written\n');
  process.exit(0);
}

const target = await openRepo('firestore', ROOT);

// Categories have no create method on Repo — they are reference data, written
// once — so they go in directly, through one client rather than one per row.
const { Firestore } = await import('@google-cloud/firestore');
const db = new Firestore({ projectId: project, ignoreUndefinedProperties: true });
const batch = db.batch();
for (const c of categories) batch.set(db.collection('categories').doc(c.slug), c);
await batch.commit();
console.log(`    ${categories.length} categor(ies)`);
for (const p of products) {
  const existing = await target.getProduct(p.id);
  // updateProduct keeps the SKU index in step and prunes SKUs you renamed.
  if (existing) await target.updateProduct(p.id, p);
  else await target.createProduct(p);
  console.log(`    ${existing ? 'updated' : 'created'}  ${p.slug}`);
}

if (withSourcing) {
  const batch2 = db.batch();
  for (const [id, entry] of Object.entries(sourcing)) {
    batch2.set(db.collection('sourcing').doc(id), entry as never, { merge: true });
  }
  await batch2.commit();
  console.log(`    ${Object.keys(sourcing).length} sourcing record(s)`);
}

console.log(`\n  ${products.length} product(s) in Firestore`);
console.log(`  run the storefront against it:  REPO_DRIVER=firestore npm start`);
console.log(`  the scripts follow the same variable, so sourcing goes with it.\n`);
