import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.ts';

/**
 * The one gate in front of everything a customer must never see: what each
 * piece costs, what it earns, and who ordered what.
 *
 * A single shared token, sent as a bearer header. That is the right weight for
 * a shop with one person running it — there are no roles to model and no
 * second person to lock out, and a password table is a thing to leak. It is
 * also the wrong shape the day someone else joins, and the note at the bottom
 * of this file says what to do then.
 *
 * **An unset token disables the admin API rather than opening it.** Every
 * guarded route answers 404, as though it were never mounted. A misconfigured
 * deploy that forgets ADMIN_TOKEN therefore exposes nothing; the failure is
 * visible (you cannot log in) instead of silent (anyone can).
 */

/** Constant-time, so the comparison cannot be used to guess the token. */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // Compare a fixed-length digest of each rather than bailing on length: an
  // early return on a length mismatch leaks the length of the real token.
  if (x.length !== y.length) {
    // Still burn a comparison so the timing does not distinguish the cases.
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

/**
 * Wrong guesses are throttled per address. Not the main defence — the token is
 * long enough that guessing it is hopeless — but it keeps a script from
 * hammering the box, and it makes a real attempt visible in the logs.
 */
const failures = new Map<string, { count: number; until: number }>();
const LOCK_AFTER = 8;
const LOCK_MS = 5 * 60_000;

export function adminGate(req: Request, res: Response, next: NextFunction): void {
  if (!config.adminToken) {
    res.status(404).json({ error: 'no such endpoint' });
    return;
  }

  const who = req.ip ?? 'unknown';
  const strike = failures.get(who);
  if (strike && strike.count >= LOCK_AFTER && Date.now() < strike.until) {
    res.status(429).json({ error: 'too many attempts, try again in a few minutes' });
    return;
  }

  const sent = req.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!sent || !sameSecret(sent, config.adminToken)) {
    const next_ = { count: (strike?.count ?? 0) + 1, until: Date.now() + LOCK_MS };
    failures.set(who, next_);
    if (next_.count === LOCK_AFTER) console.warn(`admin: ${LOCK_AFTER} failed sign-ins from ${who}`);
    if (failures.size > 2000) for (const [k, v] of failures) if (Date.now() > v.until) failures.delete(k);
    res.status(401).json({ error: 'unauthorised' });
    return;
  }

  failures.delete(who);
  next();
}

/**
 * When a second person needs access, this is the seam to replace: swap the
 * shared token for sessions against a user table, and every guarded route
 * keeps working unchanged. Until then, rotating the token is done by changing
 * ADMIN_TOKEN and restarting — which also signs out every device, and is the
 * only thing to do if a phone with the token saved on it goes missing.
 */
export const adminEnabled = () => Boolean(config.adminToken);
