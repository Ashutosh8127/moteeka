import { Router } from 'express';
import { config } from '../config.ts';
import { adminGate } from '../lib/admin-auth.ts';
import type { Repo } from '../repo/index.ts';
import { badRequest, int, wrap } from '../lib/http.ts';
import { analytics, dayKey, fold, totals, type Incoming } from '../lib/analytics.ts';

/**
 * Collection is open; reading is not.
 *
 * `POST /api/events` has to accept anything a browser sends, so it assumes
 * every field is hostile: a fixed allow-list of event names, a length cap on
 * every string, slugs checked against the catalogue, and a per-address rate
 * limit. What survives is added to a counter — there is nowhere for an
 * injected value to end up except as a number.
 */

/**
 * A token bucket per address, in memory. Thirty events a minute is far more
 * than a person browsing generates and far less than a script needs to pad a
 * day's numbers. It is per process, so it is a speed bump behind a load
 * balancer rather than a wall — the point is keeping the file honest, not
 * stopping a determined attacker from inflating a view count.
 */
const BUCKET_SIZE = 30;
const REFILL_MS = 60_000;
const buckets = new Map<string, { tokens: number; at: number }>();

function allow(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: BUCKET_SIZE, at: now };
  b.tokens = Math.min(BUCKET_SIZE, b.tokens + ((now - b.at) / REFILL_MS) * BUCKET_SIZE);
  b.at = now;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1;
  buckets.set(key, b);
  // The map is the only place an address appears, it holds two numbers, and it
  // is swept rather than persisted.
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.at > REFILL_MS * 5) buckets.delete(k);
  return true;
}

/** Obvious crawlers. Not a security control — a way to keep the counts real. */
const BOT = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|preview|monitor|curl|wget|python|axios/i;

const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  // Control characters are stripped and anything oversized is dropped rather
  // than truncated: a value that needed truncating did not come from the
  // storefront, and half of it is not worth counting.
  const s = v.replace(CONTROL, '').trim();
  return s && s.length <= max ? s : undefined;
};

export function analyticsRoutes(repo: Repo): Router {
  const r = Router();

  /*
   * Slugs are checked against the catalogue so a probe cannot create keys in
   * the day file. Cached for a minute: this runs on every product view, and
   * the catalogue changes when you run a script, not between page loads.
   */
  let slugs = new Set<string>();
  let slugsAt = 0;
  const knownSlug = (s: string) => slugs.has(s);
  async function refreshSlugs() {
    if (slugsAt && Date.now() - slugsAt < 60_000) return;
    const page = await repo.listProducts({ perPage: 100, includeDrafts: true });
    slugs = new Set(page.items.map((p) => p.slug));
    slugsAt = Date.now();
  }

  r.post('/events', wrap(async (req, res) => {
    if (!config.analytics) { res.status(204).end(); return; }
    if (BOT.test(String(req.get('user-agent') ?? ''))) { res.status(204).end(); return; }
    // Only as a bucket key, and only in memory. Never written anywhere.
    if (!allow(req.ip ?? 'unknown')) { res.status(429).json({ error: 'too many events' }); return; }

    const body = req.body as { events?: unknown };
    if (!Array.isArray(body?.events)) throw badRequest('events must be an array');
    // A page sends one or two events at a time; twenty is already generous.
    if (body.events.length > 20) throw badRequest('too many events in one batch');

    await refreshSlugs();
    const clean: Incoming[] = [];
    for (const raw of body.events as Array<Record<string, unknown>>) {
      const t = text(raw?.t, 12) as Incoming['t'] | undefined;
      if (!t) continue;
      clean.push({
        t,
        path: text(raw.path, 120),
        slug: text(raw.slug, 80),
        ref: text(raw.ref, 60),
        utm: text(raw.utm, 80),
        device: text(raw.device, 12),
        q: text(raw.q, 40),
        first: raw.first === true,
        empty: raw.empty === true,
      });
    }

    if (clean.length) await analytics().update(dayKey(), (day) => fold(day, clean, knownSlug));
    // Nothing to say, and nothing a page should wait for.
    res.status(204).end();
  }));

  // The read side is closed unless ADMIN_TOKEN is set — see src/lib/admin-auth.ts.
  const guard = adminGate;

  r.get('/stats', guard, wrap(async (req, res) => {
    const days = Math.min(Math.max(int(req.query.days) ?? 30, 1), 400);
    const window = await analytics().recent(days);
    res.json({ days, from: window.at(-1)?.date, to: window[0]?.date, ...totals(window) });
  }));

  /** A day at a time, for a chart. */
  r.get('/stats/daily', guard, wrap(async (req, res) => {
    const days = Math.min(Math.max(int(req.query.days) ?? 30, 1), 400);
    res.json({ days: (await analytics().recent(days)).reverse() });
  }));

  return r;
}
