import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT ?? 4000),
  /** 'json' on disk, 'firestore' for a deployment where the filesystem is not real. */
  driver: (process.env.REPO_DRIVER ?? 'json') as 'json' | 'firestore' | 'postgres',
  /** Imitation and fashion jewellery is 18% GST; 3% applies to precious metal. */
  taxRate: Number(process.env.TAX_RATE ?? 0.18),
  /** Free over this order value, in paise. */
  freeShippingOver: Number(process.env.FREE_SHIPPING_OVER ?? 99900),
  shippingFlat: Number(process.env.SHIPPING_FLAT ?? 7900),
  currency: 'INR',
  /**
   * Meta Pixel id. Unset means no third-party script loads at all — the
   * storefront makes no external requests and sets no advertising cookies
   * until you deliberately turn this on.
   */
  metaPixelId: process.env.META_PIXEL_ID ?? '',
  /**
   * First-party analytics — page and product counters, kept on your own disk.
   * On by default: it sets no cookies, loads nothing third-party and stores
   * nothing about a person. ANALYTICS=off stops collection entirely.
   */
  analytics: (process.env.ANALYTICS ?? 'on') !== 'off',
  /**
   * Gate for the read side. **Unset means /api/stats does not exist** rather
   * than being open — trading numbers are not something to leak by default.
   */
  adminToken: process.env.ADMIN_TOKEN ?? '',
  /** Days of counters to keep. Older files are removed by `npm run stats --prune`. */
  analyticsRetentionDays: Number(process.env.ANALYTICS_RETENTION_DAYS ?? 400),
  /** The shop's day boundary. A sale at 11pm IST belongs to that day, not UTC's. */
  timezone: process.env.TZ_SHOP ?? 'Asia/Kolkata',
  /**
   * Where a placed order is announced. One HTTPS POST, which is what WhatsApp
   * providers, SMS gateways, transactional email APIs and every no-code tool
   * all speak — so this one setting covers all of them without a dependency.
   * Unset means orders are recorded as un-announced and the admin page says so.
   */
  orderWebhookUrl: process.env.ORDER_WEBHOOK_URL ?? '',
  /** Sent as X-Webhook-Secret, so the receiving end can tell it is you. */
  orderWebhookSecret: process.env.ORDER_WEBHOOK_SECRET ?? '',
};
