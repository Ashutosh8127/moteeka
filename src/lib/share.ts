import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.ts';
import { business } from './business.ts';
import type { Product } from '../types.ts';
import type { Rating } from './reviews.ts';

/**
 * Share cards and structured data, injected on the server.
 *
 * The storefront renders from JavaScript, and the things that need this do not
 * run any: WhatsApp, Instagram, Facebook and Google all fetch the HTML and read
 * it as it arrives. Without this, every forwarded product link is a blank grey
 * box and every search result is a bare title — on a shop whose plan is to buy
 * traffic and be shared.
 *
 * So `/product.html` is served through here rather than off the static
 * directory: same file, with a head that knows which piece was asked for.
 */
const esc = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Absolute, because a share card cannot follow a relative path. */
function origin(req: { protocol: string; get: (h: string) => string | undefined }): string {
  const host = req.get('x-forwarded-host') ?? req.get('host') ?? 'localhost';
  const proto = req.get('x-forwarded-proto') ?? req.protocol ?? 'http';
  return `${proto}://${host}`;
}

export interface ShareInput {
  title: string;
  description: string;
  url: string;
  image?: string;
  /** Rendered into the page as JSON-LD when present. */
  jsonLd?: Record<string, unknown>;
}

function tags(s: ShareInput, siteName: string): string {
  const lines = [
    `<link rel="canonical" href="${esc(s.url)}">`,
    `<meta name="description" content="${esc(s.description)}">`,
    `<meta property="og:type" content="${s.jsonLd ? 'product' : 'website'}">`,
    `<meta property="og:site_name" content="${esc(siteName)}">`,
    `<meta property="og:title" content="${esc(s.title)}">`,
    `<meta property="og:description" content="${esc(s.description)}">`,
    `<meta property="og:url" content="${esc(s.url)}">`,
    `<meta name="twitter:card" content="${s.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(s.title)}">`,
    `<meta name="twitter:description" content="${esc(s.description)}">`,
  ];
  if (s.image) {
    lines.push(`<meta property="og:image" content="${esc(s.image)}">`);
    lines.push(`<meta property="og:image:alt" content="${esc(s.title)}">`);
    lines.push(`<meta name="twitter:image" content="${esc(s.image)}">`);
  }
  if (s.jsonLd) {
    // Escaped so a title containing "</script>" cannot end the block early.
    lines.push(`<script type="application/ld+json">${
      JSON.stringify(s.jsonLd).replace(/</g, '\\u003c')}</script>`);
  }
  return lines.map((l) => `  ${l}`).join('\n');
}

/*
 * The two pages whose <head> is built per request live here rather than in
 * public/, and that placement is load-bearing on a CDN-fronted host. Vercel
 * serves public/** straight off its edge, ahead of the function — so a
 * public/index.html would be handed to WhatsApp's crawler with the generic
 * <head> still in it, and the share card would be silently wrong. A file the
 * CDN cannot see is a file only this function can answer for.
 */
const VIEWS = 'views';

/** Reads the page off disk each time; it is a few kilobytes and edits show up. */
export function renderPage(file: string, share: ShareInput): string {
  const html = readFileSync(join(ROOT, VIEWS, file), 'utf8');
  const head = tags(share, business().tradingName || 'Moteeka');
  return html
    .replace(/<title>.*?<\/title>/, `<title>${esc(share.title)}</title>`)
    .replace('</head>', `${head}\n</head>`);
}

export function productShare(
  p: Product,
  req: { protocol: string; get: (h: string) => string | undefined },
  rating: Rating | null,
): ShareInput {
  const base = origin(req);
  const url = `${base}/product.html?slug=${encodeURIComponent(p.slug)}`;
  const image = p.images[0] ? `${base}/images/${p.images[0].path}` : undefined;
  const prices = p.variants.map((v) => v.price);
  const from = prices.length ? Math.min(...prices) : 0;
  const inStock = p.variants.some((v) => v.stock > 0);

  /*
   * A share card is read at a glance, so it leads with the price. The
   * description is the page's own copy where there is one — never a generated
   * summary of a generated summary.
   */
  const money = `₹${(from / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const description = [
    p.description || p.tagline,
    `${money}${prices.length > 1 ? ' onwards' : ''}.`,
  ].filter(Boolean).join(' ').slice(0, 300);

  return {
    title: `${p.title} — ${business().tradingName || 'Moteeka'}`,
    description,
    url,
    image,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.title,
      description: p.description || p.tagline || undefined,
      image: p.images.slice(0, 4).map((i) => `${base}/images/${i.path}`),
      sku: p.variants[0]?.sku,
      brand: { '@type': 'Brand', name: business().tradingName || 'Moteeka' },
      material: p.material || undefined,
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'INR',
        lowPrice: (from / 100).toFixed(2),
        highPrice: (Math.max(...prices) / 100).toFixed(2),
        offerCount: p.variants.length,
        availability: inStock
          ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url,
      },
      /*
       * Only from real published reviews. Google delists rich results built on
       * invented ratings, and an aggregateRating with no reviews behind it is
       * the most common reason a shop gets a manual action.
       */
      ...(rating ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: rating.average,
          reviewCount: rating.count,
          bestRating: 5,
          worstRating: 1,
        },
      } : {}),
    },
  };
}

export function homeShare(req: { protocol: string; get: (h: string) => string | undefined }): ShareInput {
  const base = origin(req);
  const b = business();
  return {
    title: `${b.tradingName || 'Moteeka'} — Indian jewellery`,
    description: 'Jhumka and chandbali, bridal necklace sets, bangles, anklets and nose '
      + 'jewellery — oxidised silver, gold plate and cut stone. Shipped across India.',
    url: `${base}/`,
    image: `${base}/images/share-home.jpg`,
    jsonLd: undefined,
  };
}

export { origin };
