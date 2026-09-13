/**
 * Reads the supplier site's own product payload.
 *
 * Every listing embeds `window.detailData` — a single JSON object holding the
 * title, price, MOQ, attributes, SKU matrix, images and supplier. Parsing that
 * is both far more reliable than scraping rendered HTML and far less likely to
 * break when the supplier site changes its markup.
 */

export interface LadderTier { minQty: number; maxQty: number | null; usd: number; inr: number }
export interface ScrapedVariant {
  label: string; usd: number | null; inr: number | null; skuId?: number;
  /** Photograph of this colourway, where the listing has one. */
  swatchUrl?: string;
}

export interface ScrapedProduct {
  productId: string;
  title: string;
  url?: string;
  unit: string;
  moq: number;
  boxMoq?: number;
  customsMoq?: number;
  /** Quantity-tier pricing, when the listing uses it. */
  ladder: LadderTier[];
  /** Price span across variants, when the listing prices per SKU instead. */
  range: { lowUsd: number; highUsd: number; lowInr: number; highInr: number } | null;
  usdToInr: number | null;
  attributes: Record<string, string>;
  variants: ScrapedVariant[];
  skuAxes: Array<{ name: string; values: string[] }>;
  /** Colourway name -> swatch image, for axes the listing illustrates. */
  swatches: Record<string, string>;
  images: string[];
  descriptionImages: string[];
  supplier: { name: string; country: string; years: string | null };
}

/** Pulls the `window.detailData = { … }` object literal out of a saved page. */
export function extractDetailData(html: string): unknown | null {
  const at = html.indexOf('window.detailData');
  if (at === -1) return null;
  const eq = html.indexOf('=', at);
  if (eq === -1) return null;

  // Brace matching rather than a regex: the payload is 200 kB of nested JSON
  // and contains every character a lazy pattern would stop at.
  let depth = 0, start = -1;
  for (let i = eq; i < html.length; i++) {
    const c = html[i];
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

type Any = Record<string, any>;

export function parseDetailData(data: Any, url?: string): ScrapedProduct | null {
  const g = data?.globalData;
  // The capture snippet records the page it came from, so --url is optional.
  url = url ?? (typeof g?.sourceUrl === 'string' ? g.sourceUrl : undefined);
  const p = g?.product;
  if (!p?.productId) return null;
  const s = g.seller ?? {};
  const price = p.price ?? {};

  // Attributes repeat across the basic/industry/other groups; last write wins
  // and the object naturally dedupes them.
  const attributes: Record<string, string> = {};
  for (const group of ['productBasicProperties', 'productKeyIndustryProperties', 'productOtherProperties']) {
    for (const a of (p[group] ?? []) as Any[]) {
      if (a?.attrName && a?.attrValue) attributes[String(a.attrName).replace(/\\/g, ' / ')] = String(a.attrValue);
    }
  }

  const ladder: LadderTier[] = (price.productLadderPrices ?? []).map((l: Any) => ({
    minQty: Number(l.min), maxQty: Number(l.max) > 0 ? Number(l.max) : null,
    usd: Number(l.dollarPrice), inr: Number(l.price),
  }));

  const r = price.productRangePrices;
  const range = r ? {
    lowUsd: Number(r.dollarPriceRangeLow), highUsd: Number(r.dollarPriceRangeHigh),
    lowInr: Number(r.priceRangeLow), highInr: Number(r.priceRangeHigh),
  } : null;

  // SKU keys look like "191288010:216016296;" — axis id to value id. Resolve
  // both back to names so a variant reads "Silver" rather than a pair of ids.
  const sku = p.sku ?? {};
  const valueName: Record<string, string> = {};
  const skuAxes: ScrapedProduct['skuAxes'] = [];
  const swatches: Record<string, string> = {};
  for (const axis of (sku.skuAttrs ?? []) as Any[]) {
    const values: string[] = [];
    for (const v of axis.values ?? []) {
      const name = String(v.name);
      valueName[`${axis.id}:${v.id}`] = name;
      values.push(name);
      // Image-typed axes carry a photograph per value; the URL is a thumbnail,
      // so strip the size suffix for the original.
      const raw = v.largeImage ?? (v.fileName ? `https://sc04.alicdn.com/kf/${v.fileName}` : null);
      if (raw) swatches[name] = String(raw).replace(/_\d+x\d+[a-z0-9.!_]*$/i, '');
    }
    skuAxes.push({ name: String(axis.name), values });
  }

  // An axis with a single value distinguishes nothing, and dragging it into
  // every label gives you nine variants all called "Standard / Fashion / …".
  // Only the axes that actually vary go into the name.
  const varying = new Set(
    ((sku.skuAttrs ?? []) as Any[]).filter((a) => (a.values ?? []).length > 1).map((a) => String(a.id)));
  const variants: ScrapedVariant[] = Object.entries(sku.skuInfoMap ?? {}).map(([key, info]) => {
    const parts = key.split(';').filter(Boolean);
    const kept = parts.filter((part) => varying.has(part.split(':')[0] ?? ''));
    const label = (kept.length ? kept : parts).map((part) => valueName[part] ?? part).join(' / ');
    const i = info as Any;
    return {
      label: label || 'Default',
      usd: i?.dollarPrice ?? null,
      inr: i?.price ?? null,
      skuId: i?.id,
      swatchUrl: swatches[label],
    };
  });

  const media = (p.mediaItems ?? []) as Any[];
  const photo = (m: Any) => m?.imageUrl?.big ?? m?.imageUrl?.small ?? null;
  const images = media.filter((m) => m.group === 'photos').map(photo).filter(Boolean) as string[];
  const descriptionImages = media.filter((m) => m.group !== 'photos' && m.imageUrl).map(photo).filter(Boolean) as string[];

  return {
    productId: String(p.productId),
    title: String(p.subject ?? '').trim(),
    url,
    unit: String(price.unit ?? p.quantityUnit ?? 'piece'),
    moq: Number(p.moq ?? 1),
    boxMoq: p.boxMoq != null ? Number(p.boxMoq) : undefined,
    customsMoq: p.customsMoq != null ? Number(p.customsMoq) : undefined,
    ladder,
    range,
    usdToInr: price.currencyRule?.rate ? Number(price.currencyRule.rate) : null,
    attributes,
    variants,
    skuAxes,
    swatches,
    images: [...new Set(images)],
    descriptionImages: [...new Set(descriptionImages)],
    supplier: {
      name: String(s.companyName ?? ''),
      country: String(s.companyRegisterCountry ?? ''),
      years: s.companyJoinYears != null ? String(s.companyJoinYears) : null,
    },
  };
}

/** Cheapest unit cost the listing offers, in paise. */
export function bestCostPaise(p: ScrapedProduct): number | null {
  const candidates: number[] = [];
  for (const t of p.ladder) if (Number.isFinite(t.inr)) candidates.push(t.inr);
  for (const v of p.variants) if (v.inr != null) candidates.push(v.inr);
  if (p.range) candidates.push(p.range.lowInr);
  if (candidates.length === 0) return null;
  return Math.round(Math.min(...candidates) * 100);
}

/**
 * What the piece actually costs you at a given order quantity, in paise.
 *
 * `bestCostPaise` is the floor across the whole listing, which on a ladder is
 * the 500+ tier — a price you do not pay on a first order. Pricing a product
 * off it understates cost by a third. Pass the MOQ (or whatever you are really
 * ordering) and this returns the tier that covers it.
 */
export function costAtQtyPaise(p: ScrapedProduct, qty: number): number | null {
  const tier = p.ladder.find((t) => qty >= t.minQty && (t.maxQty === null || qty <= t.maxQty));
  if (tier && Number.isFinite(tier.inr)) return Math.round(tier.inr * 100);
  // Per-SKU pricing has no quantity axis: the dearest colourway is the honest
  // basis, since one price has to cover whichever the buyer picks.
  const perSku = p.variants.map((v) => v.inr).filter((n): n is number => n != null);
  if (perSku.length) return Math.round(Math.max(...perSku) * 100);
  if (p.range) return Math.round(p.range.highInr * 100);
  return bestCostPaise(p);
}

/** Retail suggestion: cost × markup, landed on a ₹__9 ending. */
export function suggestRetail(costPaise: number, markup: number): number {
  const rupees = (costPaise / 100) * markup;
  const rounded = Math.max(49, Math.ceil(rupees / 10) * 10 - 1);
  return Math.round(rounded * 100);
}
