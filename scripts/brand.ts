import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from '../src/config.ts';
import { products as store } from '../src/lib/catalogue.ts';
import { business } from '../src/lib/business.ts';

/**
 * The brand assets that have to be raster files.
 *
 *   npm run brand
 *
 * The logo, the mark and the favicon are SVG and stay that way — they are
 * sharp at any size and a browser renders them natively. Three things cannot
 * be SVG, and this builds those:
 *
 *   - **favicon.png** for browsers that ignore an SVG icon
 *   - **apple-touch-icon.png** for a homescreen shortcut on iOS
 *   - **share-home.jpg**, the card WhatsApp and Facebook show when somebody
 *     forwards the shop's front page. `src/lib/share.ts` has pointed at this
 *     file since share cards were added; until now it did not exist, so every
 *     forwarded home-page link showed a broken image.
 *
 * Rasterised with `qlmanage`, which ships with macOS. No ImageMagick on this
 * machine, and a brand asset is not worth a dependency — on a Linux box use
 * `rsvg-convert` or `magick` in its place.
 */
const BRAND = join(ROOT, 'public', 'brand');
const IMAGES = join(ROOT, 'public', 'images');
const tmp = join(tmpdir(), `moteeka-brand-${process.pid}`);
mkdirSync(tmp, { recursive: true });

function rasterise(svg: string, size: number, out: string): void {
  const src = join(tmp, 'in.svg');
  writeFileSync(src, svg);
  execFileSync('qlmanage', ['-t', '-s', String(size), '-o', tmp, src], { stdio: 'ignore' });
  const made = join(tmp, 'in.svg.png');
  if (!existsSync(made)) throw new Error(`qlmanage produced nothing for ${out}`);
  renameSync(made, out);
}

/** A product photograph as a data URI, so the card has no external reference. */
function embed(relative: string): string | null {
  const src = join(IMAGES, relative);
  if (!existsSync(src)) return null;
  const png = join(tmp, 'p.png');
  try {
    execFileSync('sips', ['-s', 'format', 'png', src, '--out', png], { stdio: 'ignore' });
  } catch { return null; }
  return `data:image/png;base64,${readFileSync(png).toString('base64')}`;
}

/* ------------------------------------------------------------- icons -- */

const favicon = readFileSync(join(BRAND, 'favicon.svg'), 'utf8');
rasterise(favicon, 512, join(BRAND, 'favicon.png'));
rasterise(favicon, 180, join(BRAND, 'apple-touch-icon.png'));
console.log('\n  favicon.png (512) and apple-touch-icon.png (180)');

/* -------------------------------------------------------- share card -- */

/*
 * Three photographs on the left, the name on the right. A wordmark on a flat
 * ground is the safe version of this and says nothing; a card that shows the
 * actual jewellery is the one somebody stops scrolling for.
 */
const wanted = process.argv.includes('--slugs')
  ? (process.argv[process.argv.indexOf('--slugs') + 1] ?? '').split(',').map((s) => s.trim())
  : [];
const live = store.all().filter((p) => p.status === 'active' && p.images.length > 0);
const picks = (wanted.length
  ? wanted.map((s) => live.find((p) => p.slug === s)).filter(Boolean)
  : live.slice(0, 3)) as typeof live;

const shots = picks.slice(0, 2)
  .map((p) => embed(p.images[0]!.path.replace(/\.(\w+)$/, '-800.$1')) ?? embed(p.images[0]!.path))
  .filter((x): x is string => Boolean(x));

const name = business().tradingName || 'Moteeka';

/*
 * Authored on a 1200×1200 canvas with the card in a band down the middle, then
 * cropped back to 1200×630.
 *
 * This is not decoration. `qlmanage` fits a drawing to whichever side is
 * longer, so a 1200×630 SVG came back scaled by 1200/630 — everything 1.9×
 * too big and the wordmark running off the right edge. A square canvas is the
 * one shape its fit cannot distort.
 *
 * Nothing uses a nested transform either: qlmanage does not apply a `scale()`
 * inside a translated group the way a browser does.
 */
const H = 630;
const TOP = (1200 - H) / 2;
const TILE = 250;
const band = shots.length * TILE;
const tx = band + 82;

const tiles = shots.map((href, i) =>
  `<image x="${i * TILE}" y="${TOP}" width="${TILE}" height="${H}" preserveAspectRatio="xMidYMid slice" xlink:href="${href}"/>`
).join('\n    ');

const card = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  viewBox="0 0 1200 1200" width="1200" height="1200">
  <rect width="1200" height="1200" fill="#f2eee7"/>
  <g>
    ${tiles}
  </g>
  <path d="M${tx + 5} ${TOP + 210} Q${tx + 40} ${TOP + 201} ${tx + 70} ${TOP + 182}"
    fill="none" stroke="#221f1b" stroke-width="2.6" stroke-linecap="round" opacity=".34"/>
  <circle cx="${tx + 6}" cy="${TOP + 210}" r="7.5" fill="#221f1b"/>
  <circle cx="${tx + 32}" cy="${TOP + 204}" r="11.5" fill="#221f1b"/>
  <circle cx="${tx + 66}" cy="${TOP + 184}" r="17" fill="#221f1b"/>
  <text x="${tx}" y="${TOP + 336}" font-family="Georgia, 'Times New Roman', serif"
    font-size="86" letter-spacing="2" fill="#221f1b">${name}</text>
  <text x="${tx + 3}" y="${TOP + 388}" font-family="Helvetica, Arial, sans-serif"
    font-size="25" fill="#5d564d">Jhumka · chandbali · bridal sets · anklets</text>
  <text x="${tx + 3}" y="${TOP + 434}" font-family="Courier New, monospace"
    font-size="18" letter-spacing="3" fill="#8b8378">SHIPPED ACROSS INDIA</text>
</svg>`;

const wide = join(IMAGES, 'share-home.png');
rasterise(card, 1200, wide);
// Back down to the band the card was drawn in. An og:image far off 1.91:1 is
// letterboxed again by WhatsApp, that time over the top of the words.
execFileSync('sips', ['-c', String(H), '1200', wide, '--out', wide], { stdio: 'ignore' });
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82',
  wide, '--out', join(IMAGES, 'share-home.jpg')], { stdio: 'ignore' });
rmSync(wide, { force: true });
console.log(`  share-home.jpg (1200×${H}) from ${picks.map((p) => p.slug).join(', ')}`);

rmSync(tmp, { recursive: true, force: true });
console.log(`\n  re-run after a rename or a new hero:  npm run brand\n`);
