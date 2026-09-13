// Every call the storefront makes. One place to change when the API moves
// behind a different host or gains auth.
const BASE = '/api';

async function get(path, params) {
  const url = new URL(BASE + path, location.origin);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

export const api = {
  products: (q) => get('/products', q),
  product: (key) => get('/products/' + encodeURIComponent(key)),
  categories: () => get('/categories'),
  business: () => get('/business'),
  order: (reference) => get('/orders/' + encodeURIComponent(reference)),
  facets: () => get('/facets'),
  quote: (lines) => post('/cart/quote', { lines }),
  placeOrder: (payload) => post('/orders', payload),
};

/** Paise are the unit everywhere; rupees only exist for display. */
export const inr = (paise) =>
  '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const lowestPrice = (p) => Math.min(...p.variants.map((v) => v.price));
export const compareAt = (p) => {
  const withCompare = p.variants.filter((v) => v.compareAt && v.compareAt > v.price);
  return withCompare.length ? Math.min(...withCompare.map((v) => v.compareAt)) : null;
};
export const totalStock = (p) => p.variants.reduce((a, v) => a + v.stock, 0);

/**
 * Responsive image attributes for an ImageRef.
 *
 * `widths` lists the sizes that exist beside the original as "01-400.webp".
 * Without it — an older import, or a machine with no resizer — this falls back
 * to the single full-size file, so the page always renders.
 *
 * `sizes` describes how wide the image will be *laid out*, which is what the
 * browser uses to choose. Get it wrong and it downloads the wrong one however
 * good the srcset is.
 */
export function imgAttrs(image, sizes) {
  if (!image?.path) return { src: '', srcset: '', sizes: '' };
  const src = '/images/' + image.path;
  const widths = image.widths ?? [];
  if (widths.length === 0) return { src, srcset: '', sizes: '' };
  const at = (w) => '/images/' + image.path.replace(/\.(\w+)$/, `-${w}.$1`);
  return {
    // The smallest generated width is the default, so a browser that ignores
    // srcset entirely still gets the light file rather than the 1200px one.
    src: at(widths[0]),
    srcset: widths.map((w) => `${at(w)} ${w}w`).join(', '),
    sizes: sizes ?? '100vw',
  };
}

/** The same, rendered straight into an <img> tag. */
export function imgTag(image, { sizes, alt = '', extra = '' } = {}) {
  const a = imgAttrs(image, sizes);
  const escape = (v) => String(v).replace(/"/g, '&quot;');
  return `<img src="${escape(a.src)}"`
    + (a.srcset ? ` srcset="${escape(a.srcset)}" sizes="${escape(a.sizes)}"` : '')
    + ` alt="${escape(alt)}"${extra ? ' ' + extra : ''}>`;
}
