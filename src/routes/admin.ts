import { Router } from 'express';
import { config } from '../config.ts';
import type { Repo } from '../repo/index.ts';
import type { Order, Product } from '../types.ts';
import { badRequest, int, notFound, str, wrap } from '../lib/http.ts';
import { adminGate } from '../lib/admin-auth.ts';
import { analytics, totals } from '../lib/analytics.ts';
import { allSourcing } from '../lib/sourcing.ts';
import { costs, marginAt } from '../lib/landed-cost.ts';
import { isLive, priceAfter, type Discount } from '../lib/discount.ts';
import { forgetRatings, reviews, type Review } from '../lib/reviews.ts';
import { deliveries, notified } from '../lib/notify.ts';

/**
 * The shopkeeper's API. Everything behind `adminGate`, and nothing here has a
 * public counterpart — this is the only place cost, margin and customer
 * details are ever served.
 *
 * The join is the reason it exists. "This piece was opened ninety times and
 * added to a cart twelve" is interesting; "…and it earns ₹380 a piece, and you
 * have four left" is a decision. Analytics live in data/analytics/, prices in
 * the catalogue and costs in data/sourcing.json, and no dashboard that reads
 * only one of the three can tell you what to reorder.
 */
export function adminRoutes(repo: Repo): Router {
  const r = Router();
  r.use(adminGate);

  /** Cheap call a page can make to find out whether its saved token still works. */
  r.get('/me', (_req, res) => {
    res.json({ ok: true, driver: config.driver, analytics: config.analytics, currency: config.currency });
  });

  /* --------------------------------------------------------------- pieces -- */

  /**
   * Every live piece, with its funnel, its margin and its stock in one row.
   *
   * Margin comes from `npm run price`'s stored breakdown. Where a piece has no
   * recorded cost the row says so rather than showing a zero, because a zero
   * here reads as "sells at no profit" and the truth is "nobody has told the
   * costing model what this cost".
   */
  r.get('/pieces', wrap(async (req, res) => {
    const days = Math.min(Math.max(int(req.query.days) ?? 30, 1), 400);
    const [window, catalogue, sourcing] = await Promise.all([
      analytics().recent(days),
      repo.listProducts({ perPage: 100, includeDrafts: true }),
      allSourcing(),
    ]);
    const funnel = new Map(totals(window).products.map((p) => [p.slug, p]));

    const rows = catalogue.items.map((p: Product) => {
      const seen = funnel.get(p.slug);
      const priced = p.variants.map((v) => v.price);
      const record = sourcing[p.id];
      const costs = p.variants
        .map((v) => record?.variants?.[v.sku]?.pricing)
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      // The worst margin across the colourways, not the average: a set priced
      // as one thing is only as good as the variant people actually pick.
      const margins = costs.map((c) => c.marginPct);

      /*
       * The reorder half of the row: your SKU beside the supplier's, and the
       * listing it came from.
       *
       * This is the only place any of it is ever served. `data/sourcing.json`
       * is gitignored, no public route reads it, and the storefront has no
       * word for where a piece came from — that separation is the whole
       * reason sourcing does not live on the product. It appears here because
       * this page is behind ADMIN_TOKEN and because reordering without it
       * means opening two files and matching SKUs by hand.
       */
      const variantRows = p.variants.map((v) => {
        const from = record?.variants?.[v.sku];
        /*
         * What the discount does to this colourway. The list price is what is
         * stored; `salePrice` is what a customer pays while the sale runs, and
         * `saleMarginPct` is what is left after it — the number the discount
         * control on the page is really asking you to accept.
         */
        const live = isLive(p.discount);
        const salePrice = p.discount ? priceAfter(v.price, p.discount) : v.price;
        const costToServe = from?.pricing?.costToServe ?? null;
        const saleMarginPct = costToServe === null
          ? null
          : Math.round(marginAt(salePrice, costToServe).marginPct * 10) / 10;

        return {
          sku: v.sku,
          label: v.label,
          price: v.price,
          salePrice,
          saleMarginPct,
          discountLive: live,
          stock: v.stock,
          supplierSku: from?.supplierSku ?? null,
          supplierSkuId: from?.supplierSkuId ?? null,
          cost: from?.pricing?.purchase ?? from?.costPaise ?? null,
          marginPct: from?.pricing?.marginPct ?? null,
          /*
           * The whole stack, in the order the money moves: supplier, freight,
           * customs, delivery, returns, then what is left. Stored by
           * `npm run price`, and null until that has been run against a piece.
           */
          pricing: from?.pricing ?? null,
        };
      });

      return {
        slug: p.slug,
        title: p.title,
        category: p.category,
        status: p.status,
        image: p.images[0]?.path,
        priceFrom: priced.length ? Math.min(...priced) : 0,
        stock: p.variants.reduce((a, v) => a + v.stock, 0),
        variantCount: p.variants.length,
        outOfStock: p.variants.filter((v) => v.stock === 0).length,
        /** null, not 0 — "not costed" is a different fact from "no margin". */
        marginPct: margins.length ? Math.min(...margins) : null,
        costed: costs.length,
        views: seen?.views ?? 0,
        colourClicks: seen?.variants ?? 0,
        adds: seen?.adds ?? 0,
        carts: seen?.checkouts ?? 0,
        orders: seen?.orders ?? 0,
        units: seen?.units ?? 0,
        revenue: seen?.revenue ?? 0,
        addRate: seen?.addRate ?? 0,
        buyRate: seen?.buyRate ?? 0,
        discount: p.discount ?? null,
        discountLive: isLive(p.discount),
        sourceUrl: record?.sourceUrl ?? null,
        supplier: record?.supplier ?? null,
        moq: record?.moq ?? null,
        variants: variantRows,
      };
    });

    /*
     * The rate assumptions the numbers were computed under. Sent so the panel
     * can label a line "Basic customs duty 20%" rather than leaving you to
     * remember what was in data/costs.json the day `npm run price` last ran.
     */
    const c = costs();
    res.json({
      days,
      pieces: rows,
      rates: {
        basicCustomsDutyPct: c.import.basicCustomsDutyPct,
        socialWelfareSurchargePct: c.import.socialWelfareSurchargePct,
        igstPct: c.import.igstPct,
        igstCreditable: c.import.igstCreditable,
        insurancePctOfFob: c.import.insurancePctOfFob,
        freightPerKg: c.import.freightPerKg,
        clearanceFeePerShipment: c.import.clearanceFeePerShipment,
        returnRatePct: c.returns.ratePct,
        paymentGatewayPct: c.fulfilment.paymentGatewayPct,
        outputGstPct: c.pricing.outputGstPct,
        targetMarginPct: c.pricing.targetMarginPct,
        floorMarginPct: c.pricing.floorMarginPct,
      },
    });
  }));

  /**
   * Set or clear a piece's discount.
   *
   * **The reference price cannot be sent.** A discount is a percentage or an
   * amount off the list price already in the catalogue; there is no field here
   * for "what it used to cost", because a struck-through figure that was never
   * charged is a misleading price representation under the Consumer Protection
   * Act 2019. The struck-through number on the page is derived from the stored
   * price and nothing else.
   */
  r.patch('/pieces/:slug/discount', wrap(async (req, res) => {
    const product = await repo.getProduct(String(req.params.slug));
    if (!product) throw notFound('product');

    const body = (req.body ?? {}) as Record<string, unknown>;

    // Clearing a sale is deleting the field, so nothing has to be put back.
    if (body.clear === true) {
      const updated = await repo.updateProduct(product.id, { discount: undefined });
      res.json({ slug: product.slug, discount: null, live: false, updated: Boolean(updated) });
      return;
    }

    const pct = body.pct === undefined || body.pct === null ? undefined : Number(body.pct);
    const amount = body.amountPaise === undefined || body.amountPaise === null
      ? undefined : Number(body.amountPaise);

    if (pct !== undefined && amount !== undefined) throw badRequest('send pct or amountPaise, not both');
    if (pct === undefined && amount === undefined) throw badRequest('send pct, amountPaise, or clear: true');
    if (pct !== undefined && (!Number.isFinite(pct) || pct <= 0 || pct > 90)) {
      // Above 90% is a typo far more often than it is a decision.
      throw badRequest('pct must be between 1 and 90');
    }
    if (amount !== undefined && (!Number.isInteger(amount) || amount <= 0)) {
      throw badRequest('amountPaise must be a whole number of paise above zero');
    }

    const when = (v: unknown, field: string) => {
      const t = str(v);
      if (!t) return undefined;
      if (Number.isNaN(Date.parse(t))) throw badRequest(`${field} is not a date`);
      return t;
    };
    const startsAt = when(body.startsAt, 'startsAt');
    const endsAt = when(body.endsAt, 'endsAt');
    if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
      throw badRequest('endsAt is before startsAt');
    }

    const discount: Discount = {
      ...(pct !== undefined ? { pct } : {}),
      ...(amount !== undefined ? { amountPaise: amount } : {}),
      ...(str(body.label) ? { label: str(body.label)!.slice(0, 40) } : {}),
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
    };

    await repo.updateProduct(product.id, { discount });

    /*
     * Answer with what it does, not just that it saved. The margin after the
     * discount is the number that decides whether this was a good idea, and it
     * should not take a second request to see it.
     */
    const record = (await allSourcing())[product.id];
    const c = costs();
    const effect = product.variants.map((v) => {
      const costToServe = record?.variants?.[v.sku]?.pricing?.costToServe ?? null;
      const salePrice = priceAfter(v.price, discount);
      return {
        sku: v.sku,
        was: v.price,
        now: salePrice,
        marginPct: costToServe === null
          ? null : Math.round(marginAt(salePrice, costToServe).marginPct * 10) / 10,
      };
    });
    const worst = effect.map((e) => e.marginPct).filter((m): m is number => m !== null);

    res.json({
      slug: product.slug,
      discount,
      live: isLive(discount),
      effect,
      floorMarginPct: c.pricing.floorMarginPct,
      belowFloor: worst.length > 0 && Math.min(...worst) < c.pricing.floorMarginPct,
    });
  }));

  /**
   * Stock and price, per colourway.
   *
   * The reason this exists: everything else about a piece is set once at import
   * and edited rarely, but stock changes every time something sells and price
   * changes when the supplier's does. Without a write path here the admin page
   * can tell you a piece is nearly gone and give you no way to act on it — you
   * need a laptop with the repository on it, which is not where you are when a
   * courier tells you a parcel came back.
   */
  r.patch('/pieces/:slug/variants/:sku', wrap(async (req, res) => {
    const product = await repo.getProduct(String(req.params.slug));
    if (!product) throw notFound('product');
    const sku = String(req.params.sku);
    if (!product.variants.some((v) => v.sku === sku)) throw notFound('variant');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const stock = body.stock === undefined ? undefined : Math.trunc(Number(body.stock));
    const price = body.price === undefined ? undefined : Math.trunc(Number(body.price));

    if (stock === undefined && price === undefined) throw badRequest('send stock, price, or both');
    if (stock !== undefined && (!Number.isFinite(stock) || stock < 0)) {
      throw badRequest('stock must be zero or more');
    }
    /*
     * Price arrives in paise, like everywhere else. The ceiling is a typo
     * guard: ₹10,00,000 for a plated anklet is a missing decimal point, and a
     * price nobody notices is worse than a rejected edit.
     */
    if (price !== undefined && (!Number.isFinite(price) || price < 100 || price > 100_000_000)) {
      throw badRequest('price must be between ₹1 and ₹10,00,000, in paise');
    }

    const updated = await repo.updateProduct(product.id, {
      variants: product.variants.map((v) => (v.sku === sku
        ? { ...v, ...(stock !== undefined ? { stock } : {}), ...(price !== undefined ? { price } : {}) }
        : v)),
    });
    const after = updated?.variants.find((v) => v.sku === sku);
    res.json({ sku, stock: after?.stock, price: after?.price });
  }));

  /**
   * The fields worth changing from a phone: whether it is on the storefront,
   * and the words on it. Not the SKUs, the images or the category — those move
   * files around and belong in `npm run edit`, where a mistake is visible and
   * reversible in a terminal.
   */
  r.patch('/pieces/:slug', wrap(async (req, res) => {
    const product = await repo.getProduct(String(req.params.slug));
    if (!product) throw notFound('product');
    const body = (req.body ?? {}) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    const status = str(body.status);
    if (status) {
      if (!['draft', 'active', 'archived'].includes(status)) {
        throw badRequest('status must be draft, active or archived');
      }
      patch.status = status;
    }
    for (const [field, max] of [['title', 120], ['tagline', 140], ['description', 2000]] as const) {
      const v = body[field];
      if (v === undefined) continue;
      const t = String(v).trim();
      if (t.length > max) throw badRequest(`${field} is longer than ${max} characters`);
      if (field === 'title' && !t) throw badRequest('a piece needs a title');
      patch[field] = t;
    }
    if (typeof body.featured === 'boolean') patch.featured = body.featured;

    if (Object.keys(patch).length === 0) throw badRequest('nothing to change');
    const updated = await repo.updateProduct(product.id, patch);
    res.json({ slug: product.slug, changed: Object.keys(patch), status: updated?.status });
  }));

  /* -------------------------------------------------------------- reviews -- */

  /**
   * Every review, pending first — the ones waiting on you are the point of
   * this screen. The order reference is shown here and nowhere public: it is
   * how you check the review against the order it claims to come from.
   */
  r.get('/reviews', wrap(async (_req, res) => {
    const all = await reviews().all();
    const rank = { pending: 0, published: 1, rejected: 2 };
    res.json({
      counts: all.reduce<Record<string, number>>((a, x) => ({ ...a, [x.status]: (a[x.status] ?? 0) + 1 }), {}),
      reviews: [...all].sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt.localeCompare(a.createdAt)),
    });
  }));

  const REVIEW_STATUS: Review['status'][] = ['pending', 'published', 'rejected'];

  r.patch('/reviews/:id', wrap(async (req, res) => {
    const status = str((req.body as { status?: unknown })?.status) as Review['status'] | undefined;
    if (!status || !REVIEW_STATUS.includes(status)) {
      throw badRequest(`status must be one of ${REVIEW_STATUS.join(', ')}`);
    }
    const updated = await reviews().setStatus(String(req.params.id), status);
    // Publishing or hiding a review must show on the shop now, not in a minute.
    forgetRatings();
    if (!updated) throw notFound('review');
    res.json(updated);
  }));

  /* --------------------------------------------------------------- orders -- */

  r.get('/orders', wrap(async (req, res) => {
    const status = str(req.query.status);
    const all = await repo.listOrders();
    const orders = status ? all.filter((o) => o.status === status) : all;
    res.json({
      total: all.length,
      counts: all.reduce<Record<string, number>>((a, o) => ({ ...a, [o.status]: (a[o.status] ?? 0) + 1 }), {}),
      orders: orders.slice(0, Math.min(Math.max(int(req.query.limit) ?? 100, 1), 500))
        // Whether anyone was told. A webhook that quietly stopped working is
        // otherwise invisible until a customer rings up asking where their
        // parcel is.
        .map((o) => ({ ...o, announced: Boolean(notified(o.reference)) })),
    });
  }));

  /**
   * Orders as a spreadsheet — for GST filing, and for the bulk-upload form
   * every Indian courier has. Typing fifty addresses into one of those by hand
   * is the job this replaces.
   */
  r.get('/orders.csv', wrap(async (_req, res) => {
    const all = await repo.listOrders();
    // Quote everything and double any quote inside: an address with a comma in
    // it is the normal case, not the edge case.
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Reference', 'Placed', 'Status', 'Name', 'Phone', 'Email',
      'Address', 'City', 'State', 'PIN', 'Items', 'Quantity', 'Subtotal', 'Shipping', 'GST', 'Total'];
    const rows = all.map((o) => [
      o.reference, o.createdAt.slice(0, 10), o.status,
      o.customer.name, o.customer.phone, o.customer.email,
      [o.address.line1, o.address.line2].filter(Boolean).join(', '),
      o.address.city, o.address.state, o.address.pincode,
      o.lines.map((l) => `${l.quantity}x ${l.title} (${l.variantLabel}) [${l.sku}]`).join(' | '),
      o.lines.reduce((n, l) => n + l.quantity, 0),
      (o.subtotal / 100).toFixed(2), (o.shipping / 100).toFixed(2),
      (o.tax / 100).toFixed(2), (o.total / 100).toFixed(2),
    ]);
    res.type('text/csv').set(
      'Content-Disposition',
      `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    // A BOM, so Excel on Windows opens rupee signs and Indian names correctly.
    res.send('\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');
  }));

  const STATUSES: Order['status'][] = ['pending', 'paid', 'shipped', 'cancelled'];

  r.patch('/orders/:reference', wrap(async (req, res) => {
    const status = str((req.body as { status?: unknown })?.status) as Order['status'] | undefined;
    if (!status || !STATUSES.includes(status)) {
      throw badRequest(`status must be one of ${STATUSES.join(', ')}`);
    }
    const updated = await repo.setOrderStatus(String(req.params.reference), status);
    if (!updated) throw notFound('order');
    res.json(updated);
  }));

  /* -------------------------------------------------------------- summary -- */

  /**
   * One call, because the dashboard needs all of it before it can draw
   * anything and four round trips on a phone is a visibly slower page.
   */
  r.get('/summary', wrap(async (req, res) => {
    const days = Math.min(Math.max(int(req.query.days) ?? 30, 1), 400);
    const [window, catalogue, orders] = await Promise.all([
      analytics().recent(days),
      repo.listProducts({ perPage: 100, includeDrafts: true }),
      repo.listOrders(),
    ]);
    const t = totals(window);
    const since = Date.now() - days * 86_400_000;
    const recent = orders.filter((o) => Date.parse(o.createdAt) >= since);

    /*
     * Two revenue numbers that should agree and sometimes will not. The
     * counters can miss a sale the day a browser refuses to run scripts;
     * the order file cannot. Shown side by side rather than reconciled
     * silently, so a gap is something you can see.
     */
    const booked = recent.reduce((a, o) => a + (o.status === 'cancelled' ? 0 : o.total), 0);

    const live = catalogue.items.filter((p) => p.status === 'active');
    const soldOut = live.filter((p) => p.variants.every((v) => v.stock === 0));
    const low = live.filter((p) => {
      const n = p.variants.reduce((a, v) => a + v.stock, 0);
      return n > 0 && n <= 5;
    });

    res.json({
      days,
      from: window.at(-1)?.date,
      to: window[0]?.date,
      visits: t.sessions,
      devices: t.devices,
      pages: t.pages.slice(0, 12),
      referrers: t.referrers.slice(0, 10),
      campaigns: t.campaigns.slice(0, 10),
      searches: t.searches.slice(0, 12),
      /** Terms that have never found anything: what people came for, and you do not stock. */
      emptySearches: t.searches.filter((s) => s.count === s.empty).slice(0, 12),
      counted: { revenue: t.revenue },
      reviewsPending: (await reviews().all().catch(() => [])).filter((x) => x.status === 'pending').length,
      /** Orders nobody was told about — see src/lib/notify.ts. */
      unannounced: orders.filter((o) => !notified(o.reference)).length,
      lastNotification: deliveries()[0] ?? null,
      orders: {
        count: recent.length,
        booked,
        pending: orders.filter((o) => o.status === 'pending').length,
        average: recent.length ? Math.round(booked / recent.length) : 0,
      },
      catalogue: {
        live: live.length,
        drafts: catalogue.items.length - live.length,
        soldOut: soldOut.map((p) => p.slug),
        low: low.map((p) => ({ slug: p.slug, stock: p.variants.reduce((a, v) => a + v.stock, 0) })),
        /** Live pieces with no signal at all in the window — not selling badly, not being seen. */
        unseen: live.filter((p) => !t.products.some((x) => x.slug === p.slug && x.touched > 0)).map((p) => p.slug),
      },
      daily: window.slice().reverse().map((d) => ({
        date: d.date,
        visits: d.sessions,
        views: Object.values(d.pages).reduce((a, p) => a + p.views, 0),
        adds: Object.values(d.products).reduce((a, p) => a + p.adds, 0),
        orders: Object.values(d.products).reduce((a, p) => a + p.orders, 0),
        revenue: Object.values(d.products).reduce((a, p) => a + p.revenue, 0),
      })),
    });
  }));

  return r;
}
