import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Repo } from '../repo/index.ts';
import { badRequest, conflict, int, notFound, str, wrap } from '../lib/http.ts';
import { rate, reviews, type Review } from '../lib/reviews.ts';

/**
 * Reviews you can stand behind.
 *
 * Posting one requires an **order reference that actually contains the piece**.
 * That single check is what separates a rating system from a liability: without
 * it the form is an open invitation to write your own five stars, and a shop
 * publishing those is committing an unfair trade practice under the Consumer
 * Protection Act 2019 rather than marketing.
 *
 * Nothing is published by posting it. Every review lands as `pending` and
 * appears on the storefront only when somebody approves it in the admin page.
 */
export function reviewRoutes(repo: Repo): Router {
  const r = Router();

  /** Published reviews for one piece, newest first. */
  r.get('/products/:slug/reviews', wrap(async (req, res) => {
    // Same visibility rule as the piece itself: a product that is not live has
    // no public page, so it has no public reviews either.
    const product = await repo.getProduct(String(req.params.slug));
    if (!product || product.status !== 'active') throw notFound('product');
    const all = await reviews().forProduct(String(req.params.slug));
    const live = all.filter((x) => x.status === 'published');
    res.json({
      rating: rate(all),
      // Names and text only — an order reference is not the public's business.
      reviews: live.slice(0, Math.min(Math.max(int(req.query.limit) ?? 20, 1), 100))
        .map(({ id, rating, title, body, name, createdAt }) =>
          ({ id, rating, title, body, name, createdAt })),
    });
  }));

  r.post('/products/:slug/reviews', wrap(async (req, res) => {
    const slug = String(req.params.slug);
    const product = await repo.getProduct(slug);
    if (!product) throw notFound('product');

    const body = (req.body ?? {}) as Record<string, unknown>;
    // `int()` is for query strings and returns undefined for a JSON number,
    // which made every rating look out of range including the valid ones.
    const rating = Math.trunc(Number(body.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw badRequest('rating must be 1 to 5');

    const reference = str(body.reference)?.toUpperCase();
    if (!reference) throw badRequest('an order reference is required');

    /*
     * The check the whole thing rests on: a real order, containing this piece.
     * Deliberately the same message whichever half failed — a different answer
     * for "no such order" and "that order has a different piece in it" turns
     * this into a way to test whether a reference exists.
     */
    const order = await repo.getOrder(reference);
    const bought = order?.lines.some((l) => l.productId === product.id);
    if (!order || !bought) {
      throw badRequest('that order reference does not match an order for this piece');
    }
    if (order.status === 'cancelled') throw conflict('that order was cancelled');

    const already = (await reviews().forProduct(slug))
      .some((x) => x.reference === reference && x.status !== 'rejected');
    if (already) throw conflict('this order already has a review for this piece');

    const clean = (v: unknown, max: number) => {
      const t = str(v);
      return t && t.length <= max ? t : undefined;
    };

    const review: Review = {
      id: randomUUID(),
      slug,
      reference,
      rating,
      title: clean(body.title, 80),
      body: clean(body.body, 1200),
      // The name on the order unless they give another. Never the email.
      name: clean(body.name, 40) ?? order.customer.name.split(' ')[0] ?? 'A customer',
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    await reviews().add(review);

    // 202, not 201: it exists, and it is not live yet. Saying so here is what
    // stops somebody refreshing the page looking for their own words.
    res.status(202).json({ ok: true, status: 'pending' });
  }));

  return r;
}
