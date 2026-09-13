import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../src/config.ts';
import { categories, products } from '../src/lib/catalogue.ts';

/**
 * Imports every listing you have captured, in one go.
 *
 *   npm run onboard:batch -- --dry-run
 *   npm run onboard:batch
 *   npm run onboard:batch -- --queue data/import-queue.txt --qty 50
 *
 * The queue is a plain list of "<productId> <category>" lines, because the one
 * step that cannot be automated is the capture: the supplier site shows a
 * slider to anything that looks automated, and navigating twenty-five listings
 * quickly is exactly what looks automated. So you capture, and this does the
 * rest.
 *
 * Listings already imported are skipped rather than duplicated, so a partial
 * capture can be topped up and re-run.
 */
const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf('--' + k);
  return i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const dryRun = argv.includes('--dry-run');
const queueFile = flag('queue') ?? join(ROOT, 'data', 'import-queue.txt');
const qty = flag('qty') ?? '50';
const brand = flag('brand') ?? 'Moteeka';

if (!existsSync(queueFile)) { console.error(`\n  no queue at ${queueFile}\n`); process.exit(1); }

interface Job { id: string; category: string }
const jobs: Job[] = readFileSync(queueFile, 'utf8').split('\n')
  .map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean)
  .map((l) => { const [id, category] = l.split(/\s+/); return { id: id!, category: category ?? '' }; });

const known = new Set(categories.read().map((c) => c.slug));
const bad = jobs.filter((j) => !known.has(j.category));
if (bad.length) {
  console.error(`\n  unknown categor${bad.length > 1 ? 'ies' : 'y'}: `
    + `${[...new Set(bad.map((b) => b.category))].join(', ')}`);
  console.error(`  known: ${[...known].join(', ')}\n`);
  process.exit(1);
}

// A listing already in data/sourcing.json is one you have imported before.
const sourcingFile = join(ROOT, 'data', 'sourcing.json');
const sourcing = existsSync(sourcingFile) ? readFileSync(sourcingFile, 'utf8') : '';

const ready: Job[] = [];
const missing: Job[] = [];
const already: Job[] = [];
for (const j of jobs) {
  if (sourcing.includes(j.id)) { already.push(j); continue; }
  (existsSync(join(ROOT, 'captured', `${j.id}.json`)) ? ready : missing).push(j);
}

console.log(`\n  ${jobs.length} listing(s) queued`);
console.log(`  ${ready.length} captured and ready`
  + (already.length ? `, ${already.length} already imported` : '')
  + (missing.length ? `, ${missing.length} not captured yet` : ''));

if (missing.length) {
  console.log(`\n  still to capture — open each, clear the slider, run the snippet,`);
  console.log(`  and move the download into captured/:\n`);
  for (const m of missing) console.log(`    ${m.id}  (${m.category})`);
}

if (ready.length === 0 || dryRun) {
  console.log(dryRun ? '\n  --dry-run, nothing imported\n' : '\n  nothing to import yet\n');
  process.exit(0);
}

const before = products.all().length;
let done = 0;
const failed: Array<{ id: string; why: string }> = [];

for (const j of ready) {
  console.log(`\n  ${'─'.repeat(60)}\n  ${j.id} → ${j.category}`);
  try {
    execFileSync(process.execPath, [
      join(ROOT, 'scripts', 'onboard.ts'), join(ROOT, 'captured', `${j.id}.json`),
      '--category', j.category, '--qty', qty, '--brand', brand, '--activate',
    ], { stdio: 'inherit', cwd: ROOT });
    done++;
  } catch (e) {
    // One bad listing must not stop the other twenty-four.
    failed.push({ id: j.id, why: e instanceof Error ? e.message.split('\n')[0]! : 'failed' });
    console.warn(`  ${j.id} failed — carrying on`);
  }
}

console.log(`\n  ${'═'.repeat(60)}`);
console.log(`  ${done} imported, ${products.all().length - before} product(s) added`);
if (failed.length) {
  console.log(`  ${failed.length} failed:`);
  for (const f of failed) console.log(`    ${f.id}  ${f.why}`);
}
console.log(`\n  next:  npm run slugs        what landed, and what each page weighs`);
console.log(`         npm run cost -- --audit  is anything priced below cost`);
console.log(`         npm run edit -- <slug> --rename "Pattern 1=..."   name the variants\n`);
