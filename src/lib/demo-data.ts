import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.ts';

/**
 * Is fabricated data sitting in this shop right now?
 *
 * `npm run demo -- --seed` writes ratings and traffic that are not real, so the
 * storefront can be looked at before anybody has bought anything. That is a
 * development convenience, and the entire difference between it and a lie is
 * that it is loudly visible and cannot reach production:
 *
 *   - the storefront shows a banner while it is present
 *   - the server refuses to start with NODE_ENV=production
 *
 * Checked once at boot rather than per request. Seeding happens from a script,
 * which means restarting the server anyway.
 */
function look(): { reviews: number; days: number } {
  let count = 0;
  try {
    const file = join(ROOT, 'data', 'reviews.json');
    if (existsSync(file)) {
      const list = JSON.parse(readFileSync(file, 'utf8')) as Array<{ demo?: boolean }>;
      count = list.filter((r) => r.demo).length;
    }
  } catch { /* an unreadable file is not evidence of demo data */ }

  let days = 0;
  try {
    const dir = join(ROOT, 'data', 'analytics');
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const day = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { _demo?: boolean };
        if (day._demo) days++;
      }
    }
  } catch { /* same */ }

  return { reviews: count, days };
}

const found = look();

export const demoData = {
  present: found.reviews > 0 || found.days > 0,
  reviews: found.reviews,
  days: found.days,
};

/**
 * Called at startup. Refusing to boot is deliberate: a warning in a log is
 * something you scroll past, and the failure this prevents is a customer
 * reading fabricated reviews on a live shop.
 *
 * ALLOW_DEMO_DATA is the way through, and it is a whole environment variable
 * rather than a flag on the seeder on purpose. Seeding is something you do on
 * a laptop; this has to be set on the deployment itself, by someone looking at
 * the deployment's settings, which is not a thing anyone does by accident. The
 * banner stays on every page regardless — the escape hatch is for a shop that
 * has no customers yet, not for hiding that the numbers are invented.
 */
export function refuseDemoDataInProduction(): void {
  if (!demoData.present) return;
  if (process.env.NODE_ENV !== 'production') return;

  if (process.env.ALLOW_DEMO_DATA === '1') {
    console.warn(`\n  FABRICATED DATA IS LIVE — ${demoData.reviews} review(s), ${demoData.days} day(s) of traffic.`);
    console.warn(`  Running anyway because ALLOW_DEMO_DATA=1. Every page carries the banner.`);
    console.warn(`  Before a real customer can order: npm run demo -- --clear, and unset this.\n`);
    return;
  }

  console.error(`\n  REFUSING TO START.\n`);
  console.error(`  This is a production run and the shop contains fabricated data:`);
  console.error(`    ${demoData.reviews} demo review(s), ${demoData.days} demo day(s) of traffic\n`);
  console.error(`  Publishing invented ratings is an unfair trade practice under the`);
  console.error(`  Consumer Protection Act 2019. Remove it and start again:\n`);
  console.error(`    npm run demo -- --clear\n`);
  console.error(`  Or, on a deployment with no customers, set ALLOW_DEMO_DATA=1.\n`);
  process.exit(1);
}
