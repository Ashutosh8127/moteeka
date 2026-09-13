import { Router } from 'express';
import type { Repo } from '../repo/index.ts';
import type { ListQuery } from '../types.ts';
import { badRequest, int, notFound, rupeesToPaise, str, wrap } from '../lib/http.ts';
import { displayDetails } from '../lib/describe.ts';
import { withDiscount } from '../lib/discount.ts';
import { recentViews } from '../lib/analytics.ts';
import { rate, ratingsBySlug, reviews } from '../lib/reviews.ts';
import { here, liveCount, LIVE_FLOOR } from '../lib/live.ts';

/** Under this many real views in the window, the page says nothing. */
const VIEW_FLOOR = 15;
const VIEW_WINDOW_DAYS = 7;

export function catalogueRoutes(repo: Repo): Router {
  const r = Router();

  // GET /api/products?category=jhumka&search=silver&sort=price-asc&page=1
  r.get('/products', wrap(async (req, res) => {
    const q: ListQuery = {
      category: str(req.query.category),
      tag: str(req.query.tag),
      search: str(req.query.search),
      minPrice: rupeesToPaise(req.query.minPrice),
      maxPrice: rupeesToPaise(req.query.maxPrice),
      sort: str(req.query.sort) as ListQuery['sort'],
      page: int(req.query.page),
      perPage: int(req.query.perPage),
    };
    const page = await repo.listProducts(q);

    /*
     * Ratings and presence for the grid. Both read once for the whole page
     * rather than per card — fifty-four cards is fifty-four passes over the
     * same review file otherwise.
     */
    const ratings = ratingsBySlug(await reviews().all().catch(() => []));

    // The card price and the product-page price are the same number because
    // they come out of the same function, not because both were remembered.
    res.json({
      ...page,
      items: page.items.map((p) => {
        const live = liveCount(p.slug);
        return {
          ...withDiscount(p),
          ...(ratings.has(p.slug) ? { rating: ratings.get(p.slug) } : {}),
          ...(live >= LIVE_FLOOR ? { watching: live } : {}),
        };
      }),
    });
  }));

  /*
   * GET /api/products/:idOrSlug
   *
   * The spec table is renamed here rather than stored renamed: the catalogue
   * keeps the listing's own attribute keys, because that is what the naming and
   * copy derivation read. This is also the last gate before a supplier key
   * reaches a customer, so an old record still carrying one cannot serve it.
   */
  r.get('/products/:key', wrap(async (req, res) => {
    const product = await repo.getProduct(String(req.params.key));
    /*
     * Only live pieces. It used to refuse `archived` and serve `draft`, so
     * taking something down from the admin page removed it from the grid and
     * left its page working for anyone holding the link — which is every
     * customer who has ever been sent one, and every search engine that
     * indexed it.
     */
    if (!product || product.status !== 'active') throw notFound('product');
    /*
     * Real interest, or silence.
     *
     * A count of actual page views over the last week — not a number invented
     * to look busy. Below the floor it is not sent at all, because "viewed 3
     * times this week" is worse than saying nothing, and because a made-up
     * figure to cover the gap is exactly the false urgency the CCPA's 2023
     * dark patterns guidelines prohibit.
     */
    const views = (await recentViews(VIEW_WINDOW_DAYS).catch(() => null))?.get(product.slug) ?? 0;
    // null until somebody has actually bought this and left a rating that was
    // approved. The page renders no stars at all rather than an empty five.
    const rating = rate(await reviews().forProduct(product.slug).catch(() => []));

    res.json({
      ...withDiscount(product),
      details: displayDetails(product.details, { material: product.material, finish: product.finish }),
      ...(views >= VIEW_FLOOR ? { recentViews: views, recentViewDays: VIEW_WINDOW_DAYS } : {}),
      ...(rating ? { rating } : {}),
      // First paint only; the page then heartbeats to /live and refreshes it.
      ...(liveCount(product.slug) >= LIVE_FLOOR ? { watching: liveCount(product.slug) } : {}),
    });
  }));

  /**
   * "I am still here" — and how many others are.
   *
   * Posted by an open product page every forty-five seconds while its tab is
   * visible. The token is the browser's own per-tab id; it is held in memory
   * for ninety seconds and written nowhere.
   */
  r.post('/products/:slug/live', wrap(async (req, res) => {
    const slug = String(req.params.slug);
    const token = str((req.body as { token?: unknown })?.token);
    if (!token || token.length > 60) throw badRequest('a token is required');
    const count = here(slug, token);
    res.json({ watching: (liveCount(slug) || count) >= LIVE_FLOOR ? liveCount(slug) || count : 0 });
  }));

  r.get('/categories', wrap(async (_req, res) => {
    res.json(await repo.listCategories());
  }));

  // Everything the filter bar needs, in one call.
  r.get('/facets', wrap(async (_req, res) => {
    const [categories, bounds, all] = await Promise.all([
      repo.listCategories(),
      repo.priceBounds(),
      repo.listProducts({ perPage: 100 }),
    ]);
    const tags = new Map<string, number>();
    for (const p of all.items) for (const t of p.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    res.json({
      categories,
      priceBounds: bounds,
      tags: [...tags.entries()].map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count),
      total: all.total,
    });
  }));

  return r;
}
