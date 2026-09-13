import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from '../src/config.ts';
import { products as store } from '../src/lib/catalogue.ts';
import { business } from '../src/lib/business.ts';
import {
  DROP, DROP_HOLE, DROP_OUTER, METAL, METAL_INK, drop, dropGradient, dropWidth,
  wordmark, wordmarkWidth, type Stops,
} from './mark.ts';

/**
 * Every brand asset, built from one traced drop.
 *
 *   npm run brand
 *
 * The artwork arrived as a single 1600px raster. That is the right format for
 * Instagram and wrong for a browser tab, so everything here is regenerated
 * from the vector in mark.ts instead of being resized from the JPEG.
 *
 * Two palettes, because the drop is a silver gradient and the shop is cream:
 * silver reads on black and disappears on bone. METAL is the original;
 * METAL_INK is the same shape in the site's own ink and brass.
 *
 * Rasterised with `qlmanage`, which ships with macOS. On Linux use
 * `rsvg-convert` or `magick` in its place.
 */
const BRAND = join(ROOT, 'public', 'brand');
const IMAGES = join(ROOT, 'public', 'images');
const SOCIAL = join(BRAND, 'social');
const INK = '#221f1b';
const BONE = '#f2eee7';
const BLACK = '#0b0a09';
const CREAM = '#f4f1ea';

mkdirSync(SOCIAL, { recursive: true });
const tmp = join(tmpdir(), `moteeka-brand-${process.pid}`);
mkdirSync(tmp, { recursive: true });

/**
 * qlmanage fits a drawing to its LONGER side, so a 1200x630 canvas comes back
 * scaled by 1200/630 with everything clipped. Anything not square is drawn on
 * a square canvas, in a band down the middle, and cropped afterwards.
 */
function rasterise(svg: string, size: number, out: string): void {
  const src = join(tmp, 'in.svg');
  writeFileSync(src, svg);
  execFileSync('qlmanage', ['-t', '-s', String(size), '-o', tmp, src], { stdio: 'ignore' });
  const made = join(tmp, 'in.svg.png');
  if (!existsSync(made)) throw new Error(`qlmanage produced nothing for ${out}`);
  renameSync(made, out);
}

function band(svg: string, width: number, height: number, out: string, jpeg = false): void {
  const square = Math.max(width, height);
  rasterise(svg, square, out);
  execFileSync('sips', ['-c', String(height), String(width), out, '--out', out], { stdio: 'ignore' });
  if (jpeg) {
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '86',
      out, '--out', out.replace(/\.png$/, '.jpg')], { stdio: 'ignore' });
    rmSync(out, { force: true });
  }
}

/** A product photograph as a data URI, so nothing is fetched at render time. */
function embed(relative: string): string | null {
  const src = join(IMAGES, relative);
  if (!existsSync(src)) return null;
  const png = join(tmp, `p${Math.random().toString(36).slice(2)}.png`);
  try {
    execFileSync('sips', ['-s', 'format', 'png', src, '--out', png], { stdio: 'ignore' });
  } catch { return null; }
  return `data:image/png;base64,${readFileSync(png).toString('base64')}`;
}

const name = business().tradingName || 'Moteeka';

/* ------------------------------------------------------------- vectors -- */

/*
 * The lockup keeps the artwork's own proportion: the drop stands 3.56x the
 * cap height of the wordmark. That ratio is the whole character of the mark
 * and it is preserved everywhere the lockup appears at a decent size.
 */
const CAP = 46;
const LOCKUP_DROP = CAP * 3.56;
const lockup = (stops: Stops, fill: string, id: string) => {
  const dw = dropWidth(LOCKUP_DROP);
  const gap = CAP * 0.42;
  const textX = dw + gap;
  const width = textX + wordmarkWidth(CAP) + CAP * 0.17;
  const baseline = LOCKUP_DROP / 2 + CAP * 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(LOCKUP_DROP)}" role="img" aria-label="${name}">
  <defs>${dropGradient(id, stops)}</defs>
  ${drop(id, 0, 0, LOCKUP_DROP)}
  ${wordmark(textX, baseline, CAP, fill, { width: wordmarkWidth(CAP) })}
</svg>`;
};

const markOnly = (stops: Stops, id: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DROP.width} ${DROP.height}" role="img" aria-label="${name}">
  <defs>${dropGradient(id, stops)}</defs>
  <path fill="url(#${id})" fill-rule="evenodd" d="${DROP_OUTER} ${DROP_HOLE}"/>
</svg>`;

writeFileSync(join(BRAND, 'mark.svg'), markOnly(METAL_INK, 'ink'));
writeFileSync(join(BRAND, 'mark-reversed.svg'), markOnly(METAL, 'silver'));
writeFileSync(join(BRAND, 'logo.svg'), lockup(METAL_INK, INK, 'ink'));
writeFileSync(join(BRAND, 'logo-reversed.svg'), lockup(METAL, BONE, 'silver'));
console.log('\n  mark.svg / logo.svg (ink, for the shop)');
console.log('  mark-reversed.svg / logo-reversed.svg (silver, for dark grounds)');

/* ------------------------------------------------------------- favicon -- */

/*
 * The drop is very tall and very narrow — 100 x 279 — so a square icon is
 * mostly empty either side of it. It is set on the artwork's own black
 * rather than floated on the tab's background, which also keeps the silver
 * gradient legible; on cream it would be a grey smudge at 16px.
 */
const faviconSvg = (() => {
  const h = 38;
  const w = dropWidth(h);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="11" fill="${BLACK}"/>
  <defs>${dropGradient('f', METAL)}</defs>
  ${drop('f', (48 - w) / 2, (48 - h) / 2, h)}
</svg>`;
})();
writeFileSync(join(BRAND, 'favicon.svg'), faviconSvg);
rasterise(faviconSvg, 512, join(BRAND, 'favicon.png'));
rasterise(faviconSvg, 180, join(BRAND, 'apple-touch-icon.png'));
console.log('  favicon.svg + favicon.png (512) + apple-touch-icon.png (180)');

/* ---------------------------------------------------------- share card -- */

/*
 * Which photographs front the brand.
 *
 * Not simply the first live products. One supplier photograph carried a
 * branded display card held in someone's hand, and it was going out as the
 * og:image — the picture WhatsApp shows for every forwarded link. These are
 * single-product shots on a dark ground, which is also what the mark wants
 * behind it. Override with --slugs a,b.
 */
const DEFAULT_SHOTS = ['jhumka', 'temple-jhumka-ghungroo', 'long-zirconia-drops'];

const live = store.all().filter((p) => p.status === 'active' && p.images.length > 0);
const wanted = process.argv.includes('--slugs')
  ? (process.argv[process.argv.indexOf('--slugs') + 1] ?? '').split(',').map((s) => s.trim())
  : [];
const picks = (wanted.length
  ? wanted.map((s) => live.find((p) => p.slug === s)).filter(Boolean)
  : DEFAULT_SHOTS.map((sl) => live.find((p) => p.slug === sl)).filter(Boolean)) as typeof live;
const shot = (p: typeof live[number]) =>
  embed(p.images[0]!.path.replace(/\.(\w+)$/, '-800.$1')) ?? embed(p.images[0]!.path);

/** og:image. 1200x630, drawn on a 1200 square and cropped back to the band. */
{
  const H = 630, TOP = (1200 - H) / 2, TILE = 250;
  const shots = picks.slice(0, 2).map(shot).filter((x): x is string => Boolean(x));
  const tiles = shots.map((href, i) =>
    `<image x="${i * TILE}" y="${TOP}" width="${TILE}" height="${H}" preserveAspectRatio="xMidYMid slice" xlink:href="${href}"/>`).join('');
  const left = shots.length * TILE + 76;
  const dh = 250;
  const card = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1200 1200" width="1200" height="1200">
  <rect width="1200" height="1200" fill="${BLACK}"/>
  ${tiles}
  <defs>${dropGradient('s', METAL)}</defs>
  ${drop('s', left, TOP + (H - dh) / 2 - 40, dh)}
  ${wordmark(left + dropWidth(dh) + 34, TOP + H / 2 + 6, 78, '#f4f1ea', { width: 1200 - (left + dropWidth(dh) + 34) - 64 })}
  <text x="${left + dropWidth(dh) + 38}" y="${TOP + H / 2 + 58}" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#9a938a">Jhumka · chandbali · bridal sets · anklets</text>
  <text x="${left + dropWidth(dh) + 40}" y="${TOP + H / 2 + 104}" font-family="Courier New, monospace" font-size="17" letter-spacing="3" fill="#6f6a62">SHIPPED ACROSS INDIA</text>
</svg>`;
  band(card, 1200, H, join(IMAGES, 'share-home.png'), true);
  console.log(`  images/share-home.jpg (1200x${H}) from ${picks.slice(0, 2).map((p) => p.slug).join(', ')}`);
}

/* -------------------------------------------------------------- social -- */

/** Instagram / Facebook / WhatsApp profile picture. Cropped to a circle. */
{
  const S = 1080;
  const dh = 470;
  const avatar = (bg: string, stops: Stops, fill: string, id: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <rect width="${S}" height="${S}" fill="${bg}"/>
  <defs>${dropGradient(id, stops)}</defs>
  ${drop(id, (S - dropWidth(dh)) / 2, 250, dh)}
  ${wordmark(S / 2, 850, 92, fill, { anchor: 'middle', width: 620 })}
</svg>`;
  rasterise(avatar(BLACK, METAL, '#f4f1ea', 'a'), S, join(SOCIAL, 'avatar-black.png'));
  rasterise(avatar(CREAM, METAL_INK, INK, 'b'), S, join(SOCIAL, 'avatar-cream.png'));
  console.log('  social/avatar-black.png + avatar-cream.png (1080)');
}

/** Facebook page cover. Mobile crops hard to the centre, so nothing lives at the edges. */
{
  const W = 1640, H = 624, TOP = (W - H) / 2, dh = 300;
  const shots = picks.slice(0, 2).map(shot).filter((x): x is string => Boolean(x));
  const tiles = shots.map((href, i) =>
    `<image x="${i === 0 ? 0 : W - 300}" y="${TOP}" width="300" height="${H}" preserveAspectRatio="xMidYMid slice" xlink:href="${href}"/>`).join('');
  const cx = W / 2;
  const cover = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}">
  <rect width="${W}" height="${W}" fill="${BLACK}"/>
  ${tiles}
  <defs>${dropGradient('c', METAL)}</defs>
  ${drop('c', cx - dropWidth(dh) / 2, TOP + 90, dh)}
  ${wordmark(cx, TOP + 500, 84, '#f4f1ea', { anchor: 'middle', width: 560 })}
  <text x="${cx}" y="${TOP + 556}" text-anchor="middle" font-family="Courier New, monospace" font-size="19" letter-spacing="4" fill="#8b8378">SHIPPED ACROSS INDIA</text>
</svg>`;
  band(cover, W, H, join(SOCIAL, 'facebook-cover.png'));
  console.log('  social/facebook-cover.png (1640x624)');
}

/** A square post and a story, both a photograph over a signed-off footer. */
{
  const S = 1080;
  const hero = picks[0] ? shot(picks[0]) : null;
  const post = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <rect width="${S}" height="${S}" fill="${BLACK}"/>
  ${hero ? `<image x="0" y="0" width="${S}" height="760" preserveAspectRatio="xMidYMid slice" xlink:href="${hero}"/>` : ''}
  <defs>${dropGradient('p', METAL)}</defs>
  ${drop('p', 74, 812, 190)}
  ${wordmark(74 + dropWidth(190) + 28, 930, 66, '#f4f1ea', { width: S - (74 + dropWidth(190) + 28) - 74 })}
</svg>`;
  rasterise(post, S, join(SOCIAL, 'instagram-post.png'));

  const SW = 1080, SH = 1920, LEFT = (SH - SW) / 2;
  const story = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${SH} ${SH}" width="${SH}" height="${SH}">
  <rect width="${SH}" height="${SH}" fill="${BLACK}"/>
  ${hero ? `<image x="${LEFT}" y="0" width="${SW}" height="1280" preserveAspectRatio="xMidYMid slice" xlink:href="${hero}"/>` : ''}
  <defs>${dropGradient('t', METAL)}</defs>
  ${drop('t', LEFT + (SW - dropWidth(330)) / 2, 1410, 330)}
  ${wordmark(LEFT + SW / 2, 1830, 82, '#f4f1ea', { anchor: 'middle', width: 560 })}
</svg>`;
  band(story, SW, SH, join(SOCIAL, 'instagram-story.png'));
  console.log('  social/instagram-post.png (1080) + instagram-story.png (1080x1920)');
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\n  re-run after a rename or a new hero:  npm run brand\n`);
