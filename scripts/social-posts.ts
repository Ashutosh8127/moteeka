import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from '../src/config.ts';
import { products as store } from '../src/lib/catalogue.ts';
import { business } from '../src/lib/business.ts';
import { METAL, drop, dropGradient, dropWidth, wordmark } from './mark.ts';

/**
 * A set of Instagram posts — the pictures and the words that go with them.
 *
 *   npm run posts
 *
 * The captions are written here rather than generated, but every fact in them
 * is read from the catalogue at build time: the price, the number of designs,
 * the measurement, the delivery window. A caption that says ₹839 when the
 * shop says ₹899 is the kind of thing a customer screenshots.
 *
 * Nothing here invents urgency — no "only today", no countdown, no "selling
 * fast". The CCPA's dark-pattern guidelines name false urgency specifically,
 * and a shop with six real reviews cannot afford to be interesting to them.
 */
const OUT = join(ROOT, 'public', 'brand', 'social', 'posts');
const IMAGES = join(ROOT, 'public', 'images');
const BLACK = '#0b0a09';
mkdirSync(OUT, { recursive: true });
const tmp = join(tmpdir(), `moteeka-posts-${process.pid}`);
mkdirSync(tmp, { recursive: true });

const b = business();
const DELIVERY = `${b.deliveryMinDays}–${b.deliveryMaxDays} days`;
const SITE = 'moteeka.vercel.app';

function embed(relative: string): string | null {
  const src = join(IMAGES, relative);
  if (!existsSync(src)) return null;
  const png = join(tmp, `p${Math.random().toString(36).slice(2)}.png`);
  try {
    execFileSync('sips', ['-s', 'format', 'png', src, '--out', png], { stdio: 'ignore' });
  } catch { return null; }
  return `data:image/png;base64,${readFileSync(png).toString('base64')}`;
}

function rasterise(svg: string, size: number, out: string): void {
  const src = join(tmp, 'in.svg');
  writeFileSync(src, svg);
  execFileSync('qlmanage', ['-t', '-s', String(size), '-o', tmp, src], { stdio: 'ignore' });
  const made = join(tmp, 'in.svg.png');
  if (!existsSync(made)) throw new Error(`qlmanage produced nothing for ${out}`);
  renameSync(made, out);
}

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));

/**
 * Six pieces, chosen to span what the shop sells rather than to flatter it:
 * the cheapest jhumka and the bridal set, an anklet and a ring, oxidised
 * silver and gold plate. `body` is the caption; `tags` follow it.
 */
interface Post { slug: string; hook: string; body: (p: Piece) => string; tags: string[] }
type Piece = { title: string; price: string; designs: number; size?: string };

const POSTS: Post[] = [
  {
    slug: 'jhumka',
    hook: 'A crescent of filigree under a paisley stud, fringed in pearls.',
    body: (p) => `Antique-oxidised zinc alloy. ${p.designs} designs in this one listing — peacock, `
      + `chandbali, triple-tier bell — all at ${p.price}.\n\n`
      + `Fashion jewellery in plated alloy, not precious metal, and priced like it.`,
    tags: ['jhumka', 'chandbali', 'oxidisedjewellery', 'indianjewellery', 'ethnicjewellery',
      'jhumkalove', 'silverlookjewellery', 'affordablejewellery', 'moteeka'],
  },
  {
    slug: 'temple-jhumka-ghungroo',
    hook: 'One bell. Six tops — parrot, paisley, lotus, peacock.',
    body: (p) => `Temple jhumka with a ghungroo fringe, antique silver oxidised finish. `
      + `Pick the top, the bell stays the same. ${p.price}.\n\n`
      // No weight is recorded for this piece, so the caption does not claim one.
      + `Parrot, carved disc, paisley, lotus, sunburst, peacock — same bell under all six.`,
    tags: ['templejewellery', 'jhumka', 'ghungroo', 'oxidisedjewellery', 'southindianjewellery',
      'ethnicwear', 'indianjewellery', 'templejhumka', 'moteeka'],
  },
  {
    slug: 'zirconia-tennis-anklet',
    hook: 'A double row of round-cut zirconia, channel-set.',
    body: (p) => `${p.size ? `${p.size}. ` : ''}The extender is the point — an anklet you `
      + `cannot try on before it arrives needs somewhere to go.\n\n${p.price}.`,
    tags: ['anklet', 'payal', 'zirconia', 'anklets', 'indianjewellery', 'fashionjewellery',
      'ankletsofinstagram', 'moteeka'],
  },
  {
    slug: 'long-zirconia-drops',
    hook: 'Pear-cut cubic zirconia, micro-set, rhodium plated.',
    body: (p) => `Long drops that read as a line rather than a cluster — the shape that `
      + `works when your hair is up.\n\n${p.price}. Cubic zirconia on copper alloy, `
      + `stated plainly because you are buying it unseen.`,
    tags: ['zirconia', 'dropearrings', 'bridaljewellery', 'weddingjewellery', 'cubiczirconia',
      'indianwedding', 'fashionjewellery', 'moteeka'],
  },
  {
    slug: 'white-water-drop-set',
    hook: 'Necklace and earrings. Pear-cut zirconia, claw-set.',
    body: (p) => `A bridal set for the reception rather than the ceremony — rhodium and `
      + `silver plate, nothing that competes with what you are already wearing.\n\n${p.price} `
      + `for the set.`,
    tags: ['bridaljewellery', 'jewelleryset', 'weddingjewellery', 'necklaceset', 'zirconia',
      'indianbride', 'receptionlook', 'moteeka'],
  },
  {
    slug: 'gold-plated-bridal-ring',
    hook: 'Round-cut cubic zirconia, claw-set, white gold plated.',
    body: (p) => `${p.designs} sizes. Brass under the plate — this is a ring you wear to `
      + `the party, not one you wear for forty years, and it costs ${p.price} for that reason.`,
    tags: ['ring', 'cocktailring', 'zirconia', 'fashionjewellery', 'indianjewellery',
      'statementring', 'moteeka'],
  },
];

/* ------------------------------------------------------------- pictures -- */

const all = store.all();
const lines: string[] = [
  `# Instagram posts`,
  ``,
  `Generated by \`npm run posts\`. Pictures are in this folder; the caption for`,
  `each is below it. Every price and measurement is read from the catalogue at`,
  `build time — re-run this after a price change rather than editing by hand.`,
  ``,
  `Delivery is quoted as **${DELIVERY}**, which is what \`data/business.json\` says`,
  `and what the product pages say. If you change it in one place, change it in all.`,
  ``,
  `---`,
  ``,
];

let n = 0;
for (const post of POSTS) {
  const p = all.find((x) => x.slug === post.slug);
  if (!p) { console.log(`  skipped ${post.slug} — not in the catalogue`); continue; }
  const hero = p.images[0];
  if (!hero) { console.log(`  skipped ${post.slug} — no photograph`); continue; }
  const href = embed(hero.path.replace(/\.(\w+)$/, '-800.$1')) ?? embed(hero.path);
  if (!href) { console.log(`  skipped ${post.slug} — could not read the photograph`); continue; }

  n += 1;
  const price = rupees(Math.min(...p.variants.map((v) => v.price)));
  const piece: Piece = {
    title: p.title, price, designs: p.variants.length,
    size: p.details?.['Size'] ?? p.details?.['Length'],
  };

  const S = 1080, PHOTO = 876, dh = 116;
  const dx = 64, dy = PHOTO + 42;
  const tx = dx + dropWidth(dh) + 26;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <rect width="${S}" height="${S}" fill="${BLACK}"/>
  <image x="0" y="0" width="${S}" height="${PHOTO}" preserveAspectRatio="xMidYMid slice" xlink:href="${href}"/>
  <defs>${dropGradient('d', METAL)}</defs>
  ${drop('d', dx, dy, dh)}
  <text x="${tx}" y="${dy + 48}" font-family="Cormorant, Didot, Georgia, serif" font-size="43" fill="#f4f1ea">${esc(p.title)}</text>
  <text x="${tx + 2}" y="${dy + 92}" font-family="Courier New, monospace" font-size="25" letter-spacing="1" fill="#a09995">${price}</text>
  ${/* Centred on its own half-width in from the edge, or the name runs off it. */''}
  ${wordmark(S - 64 - 74, dy + 92, 26, '#6f6a62', { anchor: 'middle', width: 148 })}
</svg>`;

  const file = join(OUT, `${String(n).padStart(2, '0')}-${p.slug}.png`);
  rasterise(svg, S, file);

  lines.push(`## ${n}. ${p.title} — \`${String(n).padStart(2, '0')}-${p.slug}.png\``);
  lines.push('');
  lines.push('```');
  lines.push(post.hook);
  lines.push('');
  lines.push(post.body(piece));
  lines.push('');
  lines.push(`Shipped across India, ${DELIVERY}. ${SITE}`);
  lines.push('');
  lines.push(post.tags.map((t) => `#${t}`).join(' '));
  lines.push('```');
  lines.push('');
  console.log(`  ${String(n).padStart(2, '0')}  ${p.slug.padEnd(30)} ${price}`);
}

writeFileSync(join(OUT, 'captions.md'), lines.join('\n'));
rmSync(tmp, { recursive: true, force: true });
console.log(`\n  ${n} post(s) + captions.md in public/brand/social/posts/\n`);
