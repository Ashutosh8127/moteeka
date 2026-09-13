import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Pulls product images and details out of a supplier page you have saved.
 *
 * the supplier site blocks automated fetching of the *page*, but its image CDN is open —
 * so saving the listing from your own browser and reading the URLs out of it
 * works, and those URLs then download without any special handling.
 *
 *   node scripts/extract-supplier.ts ./html/listing.html
 *   node scripts/extract-supplier.ts ./html/listing.html --json out.json
 *   node scripts/extract-supplier.ts ./html/listing.html --all      (show what was filtered out)
 *
 * Supplier photographs belong to the supplier. Confirm in writing that you may
 * use them on your own storefront before you do.
 */
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('\n  usage: node scripts/extract-supplier.ts <saved-page.html> [--json out.json] [--all]\n');
  process.exit(1);
}

const html = readFileSync(file, 'utf8');
const showAll = args.includes('--all');

const title =
  /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html)?.[1] ??
  /<title>([^<]+)</i.exec(html)?.[1]?.replace(/\s*-\s*Buy.*$/i, '').replace(/\s*[-|]\s*the supplier site.*$/i, '') ??
  '(title not found)';

/**
 * the supplier site puts every product photograph under a `/kf/<hash>.<ext>` path, and
 * everything else — icons, banners, badges, the AI-assistant buttons — under
 * `/imgextra/` with a `tps-<w>-<h>` size marker. That single distinction is
 * what separates the ten images you want from the thirty you do not.
 */
const KF = /\/kf\/([A-Za-z0-9]+)\.(jpg|jpeg|png|webp)/i;
/** the supplier site appends a size suffix for thumbnails; strip it for the original. */
const SIZE_SUFFIX = /_\d+x\d+[a-z0-9.!_]*$/i;

interface Found { url: string; key: string; ext: string }
const products = new Map<string, Found>();
const ignored: string[] = [];

for (const m of html.matchAll(/https?:\/\/[^"'\s\\)<>]+/gi)) {
  let url = m[0]
    .replace(/&amp;/g, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/');

  // A page link that merely mentions an image in its query string is not an
  // image — the AI-assistant and image-search buttons are all of this shape.
  if (url.includes('?')) { ignored.push(url); continue; }
  if (!/alicdn\.com|aliimg\.com/i.test(url)) { ignored.push(url); continue; }

  url = url.replace(SIZE_SUFFIX, '');
  const kf = KF.exec(url);
  if (!kf) { ignored.push(url); continue; }

  // sc01/sc02/sc04/s.alicdn/@sc04 all serve the same file — key on the hash so
  // the same photograph is not imported four times.
  const key = kf[1]!.toLowerCase();
  if (!products.has(key)) {
    products.set(key, { url: `https://sc04.alicdn.com/kf/${kf[1]}.${kf[2]}`, key, ext: kf[2]!.toLowerCase() });
  }
}

const all = [...products.values()];
// The gallery is photographs; the long PNGs are usually description panels.
const gallery = all.filter((f) => f.ext !== 'png');
const panels = all.filter((f) => f.ext === 'png');

console.log(`\n  ${title.trim()}`);
console.log(`  ${gallery.length} product image(s), ${panels.length} description panel(s), ${ignored.length} page assets ignored\n`);

console.log('  PRODUCT IMAGES');
for (const f of gallery) console.log('   ', f.url);
if (panels.length) {
  console.log('\n  DESCRIPTION PANELS (long infographics — usually not for your gallery)');
  for (const f of panels) console.log('   ', f.url);
}
if (showAll) {
  console.log('\n  IGNORED');
  for (const u of [...new Set(ignored)]) console.log('   ', u);
}

const jsonAt = args.indexOf('--json');
if (jsonAt !== -1 && args[jsonAt + 1]) {
  writeFileSync(args[jsonAt + 1]!, JSON.stringify({
    title: title.trim(), images: gallery.map((f) => f.url), panels: panels.map((f) => f.url),
  }, null, 2) + '\n');
  console.log(`\n  written to ${args[jsonAt + 1]}`);
}

if (gallery.length === 0) {
  console.log('\n  No product images found. The saved file is probably the supplier site\'s bot-check page');
  console.log('  rather than the listing — save it again from a tab where the product is visible.\n');
  process.exit(0);
}

console.log('\n  Import them with:\n');
console.log(`    npm run images:import -- --slug <product-slug> \\`);
console.log(gallery.map((f) => `      --url ${f.url}`).join(' \\\n'));
console.log('\n  Run `npm run slugs` to see the product slugs you can use.\n');
