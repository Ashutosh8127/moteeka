import type { Request, Response, NextFunction } from 'express';

/**
 * A per-IP request budget.
 *
 * The storefront API is public and has to be — a shop nobody can read is not a
 * shop. But every uncached call costs a Firestore read, so an open endpoint is
 * somebody else's ability to spend your quota, and on a paid plan your money.
 * A loop over /api/products from one laptop is enough.
 *
 * This is a floor, not a wall. It counts in the memory of one process, and a
 * serverless host runs several, so a determined caller gets roughly this
 * budget per instance. The defence that actually holds is the Cache-Control
 * on the catalogue routes: a repeated request is answered by the CDN and never
 * reaches this code or the database. What follows catches the case the cache
 * cannot — writes, and requests that vary enough to miss the edge every time.
 *
 * Keyed on x-forwarded-for's first hop, which on Vercel is the client. It is
 * spoofable; someone rotating it is past what a counter in memory can do, and
 * that is what the platform's own firewall is for.
 */
export interface Budget {
  /** Requests allowed in the window. */
  limit: number;
  windowMs: number;
}

interface Hits { count: number; resetAt: number }

const buckets = new Map<string, Map<string, Hits>>();

/** Cheap sweep so a long-lived instance does not hold every IP it ever saw. */
function sweep(m: Map<string, Hits>, now: number): void {
  if (m.size < 5000) return;
  for (const [k, v] of m) if (v.resetAt <= now) m.delete(k);
}

function who(req: Request): string {
  const fwd = req.get('x-forwarded-for');
  const first = fwd?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

/**
 * `name` separates the budgets: browsing the catalogue and placing orders are
 * not the same activity and should not share a counter.
 */
export function limit(name: string, budget: Budget) {
  let m = buckets.get(name);
  if (!m) { m = new Map(); buckets.set(name, m); }
  const bucket = m;

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = who(req);
    const hit = bucket.get(key);

    if (!hit || hit.resetAt <= now) {
      bucket.set(key, { count: 1, resetAt: now + budget.windowMs });
      sweep(bucket, now);
      next();
      return;
    }

    hit.count += 1;
    if (hit.count > budget.limit) {
      const secs = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(secs));
      // Never cached: a 429 answered from an edge would lock someone out for
      // the length of the cache rather than the length of the window.
      res.setHeader('Cache-Control', 'no-store');
      res.status(429).json({ error: 'too many requests, slow down' });
      return;
    }
    next();
  };
}

/**
 * Catalogue reads. Generous, because the CDN answers most of them and a real
 * person clicking around a shop can legitimately make a lot of requests.
 */
export const browsing = () => limit('browse', { limit: 300, windowMs: 60_000 });

/**
 * Analytics events. Each one is a Firestore write, and it is the only endpoint
 * a stranger can make the shop write to without ordering anything.
 */
export const events = () => limit('events', { limit: 60, windowMs: 60_000 });

/**
 * Orders and reviews. Nobody legitimately places ten orders a minute, and both
 * of these write and then fan out — an order fires a webhook.
 */
export const writing = () => limit('write', { limit: 10, windowMs: 60_000 });
