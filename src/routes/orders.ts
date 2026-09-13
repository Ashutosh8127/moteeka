import { Router } from 'express';
import { recordOrder } from '../lib/analytics.ts';
import { withDiscount } from '../lib/discount.ts';
import { announceOrder } from '../lib/notify.ts';
import { randomUUID } from 'node:crypto';
import { InsufficientStock, type Repo } from '../repo/index.ts';
import type { Order, OrderLine } from '../types.ts';
import { config } from '../config.ts';
import { badRequest, conflict, notFound, wrap } from '../lib/http.ts';

interface CartLineIn { sku: string; quantity: number }

/**
 * Prices are re-read from the catalogue when the order is placed and never
 * taken from the request. A cart posted from a browser is a statement of what
 * someone wants to buy, not of what it costs.
 */
export function orderRoutes(repo: Repo): Router {
  const r = Router();

  r.post('/cart/quote', wrap(async (req, res) => {
    // `slugs` is for the order route's analytics call, not for the cart.
    const { slugs: _slugs, ...quote } = await price(repo, req.body?.lines);
    res.json(quote);
  }));

  r.post('/orders', wrap(async (req, res) => {
    const body = req.body ?? {};
    const { customer, address } = body;
    for (const [field, value] of [['name', customer?.name], ['email', customer?.email], ['phone', customer?.phone]]) {
      if (!value) throw badRequest(`customer.${field} is required`);
    }
    for (const field of ['line1', 'city', 'state', 'pincode'] as const) {
      if (!address?.[field]) throw badRequest(`address.${field} is required`);
    }
    if (!/^\d{6}$/.test(String(address.pincode))) throw badRequest('pincode must be six digits');

    const quote = await price(repo, body.lines);
    // The quote tolerates a dead line so the drawer stays usable; an order
    // must not.
    if (quote.dropped.length) {
      throw conflict(`${quote.dropped.map((d) => d.title ?? d.sku).join(', ')} `
        + `${quote.dropped.length > 1 ? 'are' : 'is'} no longer available — remove `
        + `${quote.dropped.length > 1 ? 'them' : 'it'} and try again`);
    }
    if (quote.lines.length === 0) throw badRequest('the cart is empty');

    const { dropped: _dropped, slugs, ...priced } = quote;
    const order: Order = {
      id: randomUUID(),
      reference: reference(),
      ...priced,
      // What was left at the moment of ordering is not part of the order, and
      // neither is what the piece happened to be called.
      lines: priced.lines.map(({ stock: _stock, slug: _slug, ...line }) => line),
      customer: { name: customer.name, email: customer.email, phone: customer.phone },
      address,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    try {
      await repo.createOrder(order);
    } catch (e) {
      // Someone took the last one between quoting and ordering. 409 rather
      // than 400: the request was fine, the world changed under it.
      if (e instanceof InsufficientStock) throw conflict(e.message);
      throw e;
    }
    /*
     * The one place a sale reaches the analytics counters. A browser can claim
     * a view and an add-to-cart; it cannot claim revenue, because nothing it
     * sends is ever added to these three numbers.
     *
     * Deliberately after the order is safely written, and deliberately not
     * awaited into the response: a counter file failing to update must never
     * turn a placed order into an error for the customer.
     */
    void recordOrder(order.lines, (id) => slugs[id])
      .catch((e) => console.error('analytics: order not counted', e));

    /*
     * And tell somebody. Same rule as the counters: after the order is safely
     * written, and never awaited into the response — a slow webhook must not
     * turn a placed order into an error for the customer.
     */
    const base = `${req.get('x-forwarded-proto') ?? req.protocol}://${req.get('x-forwarded-host') ?? req.get('host')}`;
    void announceOrder(order, base);

    res.status(201).json(order);
  }));

  r.get('/orders/:reference', wrap(async (req, res) => {
    const order = await repo.getOrder(String(req.params.reference));
    if (!order) throw notFound('order');
    res.json(order);
  }));

  return r;
}

/** A cart line that cannot be sold, and why — so the page can say so. */
export interface DroppedLine { sku: string; reason: 'gone' | 'sold-out'; title?: string }

/**
 * Prices what can be sold and reports what cannot, rather than failing.
 *
 * A cart lives in the customer's browser and the catalogue moves underneath
 * it: a SKU is renamed, a product goes to draft, the last one sells. Throwing
 * on the first bad line took the whole cart down — the quote failed, so the
 * drawer could not render, so there was no way even to remove the offending
 * item. One stale SKU and the customer's only move is to clear their browser
 * data.
 *
 * So unknown and sold-out lines come back as `dropped`. The quote still
 * prices the rest; placing an order with any dropped line is refused
 * separately, because you cannot sell what is not there.
 */
async function price(repo: Repo, input: unknown) {
  const wanted: CartLineIn[] = Array.isArray(input) ? input : [];
  const lines: OrderLine[] = [];
  const dropped: DroppedLine[] = [];
  /*
   * Product id to slug, for the analytics counters, which are keyed by slug
   * because that is what a person recognises in a report. Not part of the
   * quote a customer receives — the route strips it, the way it strips
   * `dropped` out of the order.
   */
  const slugs: Record<string, string> = {};

  for (const want of wanted) {
    const quantity = Math.max(1, Math.trunc(Number(want?.quantity) || 1));
    if (!want?.sku) continue;
    // One lookup per line. This used to page the catalogue and search it in
    // memory, which was a full listing per cart line and — because perPage is
    // capped at 100 — stopped finding anything past the hundredth product.
    const hit = await repo.getVariantBySku(String(want.sku));
    if (!hit || hit.product.status !== 'active') {
      dropped.push({ sku: String(want.sku), reason: 'gone' });
      continue;
    }
    /*
     * Priced through the same function the storefront renders with. A discount
     * applied in the catalogue route and forgotten here is the bug where the
     * page says ₹899 and the card is charged ₹1,199 — and the customer is
     * right and you are not.
     */
    const product = withDiscount(hit.product);
    const variant = product.variants.find((v) => v.sku === hit.variant.sku) ?? hit.variant;
    slugs[product.id] = product.slug;
    if (variant.stock <= 0) {
      dropped.push({ sku: variant.sku, reason: 'sold-out', title: `${product.title} — ${variant.label}` });
      continue;
    }
    lines.push({
      sku: variant.sku,
      productId: product.id,
      title: product.title,
      variantLabel: variant.label,
      unitPrice: variant.price,
      // Someone asking for more than is left gets what is left, not an error.
      quantity: Math.min(quantity, variant.stock),
      image: product.images[0]?.path,
      imageWidths: product.images[0]?.widths,
      stock: variant.stock,
      slug: product.slug,
    });
  }

  const subtotal = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  const shipping = subtotal === 0 || subtotal >= config.freeShippingOver ? 0 : config.shippingFlat;
  const tax = Math.round(subtotal * config.taxRate);
  return { lines, dropped, slugs, subtotal, shipping, taxRate: config.taxRate, tax, total: subtotal + shipping + tax };
}

/** Human-quotable reference: OXJ-<date>-<4 chars>. */
function reference(): string {
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `OXJ-${d}-${randomUUID().slice(0, 4).toUpperCase()}`;
}
