import { products as store } from '../src/lib/catalogue.ts';
import { describe, visibleDetails } from '../src/lib/describe.ts';

/**
 * Writes the copy a product page opens with, for pieces that came in without
 * any. Reads only what the listing declared — see src/lib/describe.ts.
 *
 *   npm run describe                      # what it would write, changes nothing
 *   npm run describe -- --write           # fill the empty ones
 *   npm run describe -- --write --force   # overwrite copy that already exists
 *   npm run describe -- --slug <slug> --write
 *   npm run describe -- --write --specs   # also tidy the spec tables
 */
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const value = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const write = flag('write');
const force = flag('force');
const specs = flag('specs');
const only = value('slug');

const targets = store.all().filter((p) => !only || p.slug === only);
if (only && targets.length === 0) {
  console.error(`\n  no product with slug "${only}" — npm run slugs\n`);
  process.exit(1);
}

let wrote = 0, skipped = 0, rows = 0;

for (const p of targets) {
  const copy = describe(p);
  const tidied = visibleDetails(p.details);
  const dropped = Object.keys(p.details ?? {}).length - Object.keys(tidied).length;

  // Copy someone wrote by hand outranks copy a script composed, always.
  const hasCopy = Boolean(p.description?.trim());
  const changeCopy = force || !hasCopy;
  const changeSpecs = specs && dropped > 0;

  if (!changeCopy && !changeSpecs) { skipped++; continue; }

  console.log(`\n  ${p.slug}`);
  if (changeCopy) {
    if (hasCopy) console.log(`    was      ${p.description}`);
    console.log(`    tagline  ${copy.tagline || '(none — nothing the title does not say)'}`);
    console.log(`    about    ${copy.description}`);
    console.log(`    tags     ${copy.tags.join(', ')}`);
  }
  if (changeSpecs) console.log(`    specs    ${Object.keys(p.details).length} → ${Object.keys(tidied).length} rows`);

  if (write) {
    store.put({
      ...p,
      tagline: changeCopy && copy.tagline ? copy.tagline : p.tagline,
      description: changeCopy ? copy.description : p.description,
      tags: changeCopy && p.tags.length === 0 ? copy.tags : p.tags,
      details: changeSpecs ? tidied : p.details,
      updatedAt: new Date().toISOString(),
    });
  }
  wrote++;
  rows += dropped;
}

console.log(`\n  ${wrote} product(s) ${write ? 'updated' : 'would change'}, ${skipped} left alone`);
if (specs && rows) console.log(`  ${rows} spec row(s) ${write ? 'removed' : 'would be removed'}`);
if (!write) console.log(`  nothing written — add --write`);
console.log(`  a generated line is a default, not a finished sentence:`);
console.log(`  npm run edit -- <slug> --description "…" --tagline "…"\n`);
