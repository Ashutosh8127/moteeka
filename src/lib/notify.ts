import { join } from 'node:path';
import { ROOT, config } from '../config.ts';
import { JsonStore } from './json-store.ts';
import type { Order } from '../types.ts';

/**
 * Telling somebody an order arrived.
 *
 * Before this, an order was written to disk and that was the end of it — you
 * found out by opening the admin page and looking. On a shop that takes payment
 * by phone after a fifteen-to-twenty-five day wait, the order you do not notice
 * is the order you lose.
 *
 * **A webhook rather than a mail server**, because every channel worth having
 * in India — WhatsApp through an approved provider, SMS through MSG91, email
 * through any transactional API — is an HTTPS POST. One outbound request with
 * the order on it reaches all of them through Zapier, Make, n8n, or thirty
 * lines on your own box, and none of it needs a dependency here or a password
 * in this repo. Set `ORDER_WEBHOOK_URL` and it starts working.
 *
 * **Nothing is lost when it fails.** Every attempt is recorded, and an order
 * that was never announced shows up in the admin page as such, so a webhook
 * that quietly stopped working is visible rather than silent.
 */
export interface Delivery {
  reference: string;
  at: string;
  ok: boolean;
  /** HTTP status, or the transport error. */
  detail: string;
}

const log = new JsonStore<Delivery[]>(join(ROOT, 'data', 'notifications.json'), () => []);

export const deliveries = (): Delivery[] => log.read();

export const notified = (reference: string): Delivery | undefined =>
  log.read().find((d) => d.reference === reference && d.ok);

/** What the webhook receives. Deliberately flat, so a no-code tool can map it. */
export function payload(o: Order, base: string) {
  const rupees = (p: number) => (p / 100).toFixed(2);
  return {
    event: 'order.placed',
    reference: o.reference,
    placedAt: o.createdAt,
    total: rupees(o.total),
    currency: 'INR',
    itemCount: o.lines.reduce((n, l) => n + l.quantity, 0),
    items: o.lines.map((l) => `${l.title} — ${l.variantLabel} × ${l.quantity}`),
    customerName: o.customer.name,
    customerPhone: o.customer.phone,
    customerEmail: o.customer.email,
    address: [o.address.line1, o.address.line2, o.address.city, o.address.state, o.address.pincode]
      .filter(Boolean).join(', '),
    /** Send this to the customer — it is the page they can come back to. */
    trackUrl: `${base}/order.html?ref=${encodeURIComponent(o.reference)}`,
    adminUrl: `${base}/admin.html`,
    /* A ready-made line, so the simplest possible Zap is "post this to me". */
    message: `New order ${o.reference} — ₹${Math.round(o.total / 100).toLocaleString('en-IN')} `
      + `from ${o.customer.name} (${o.customer.phone}). `
      + o.lines.map((l) => `${l.quantity}× ${l.title}`).join(', '),
  };
}

function record(d: Delivery) {
  try {
    // Kept short. This is an operational trail, not an archive.
    log.update((all) => [d, ...all].slice(0, 500));
  } catch (e) {
    /*
     * A serverless host mounts its code read-only, so there is nowhere to keep
     * this. Losing the trail is a nuisance; throwing here is not — record() is
     * reached from announceOrder(), which is deliberately never awaited into
     * the response, so an exception becomes an unhandled rejection and can take
     * the process down after the customer has already been told the order was
     * placed. The webhook itself has already been sent by this point.
     */
    const why = e instanceof Error ? e.message : String(e);
    console.warn(`  order ${d.reference}: webhook ${d.ok ? 'sent' : 'failed'}, not logged — ${why}`);
  }
}

/**
 * Fire and forget, with a timeout. **Never awaited into the response** — a
 * customer must not see an order fail because a webhook was slow, and the
 * order is already safely written by the time this runs.
 */
export async function announceOrder(o: Order, base: string): Promise<void> {
  const url = config.orderWebhookUrl;
  if (!url) {
    record({ reference: o.reference, at: new Date().toISOString(), ok: false, detail: 'no ORDER_WEBHOOK_URL set' });
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.orderWebhookSecret ? { 'X-Webhook-Secret': config.orderWebhookSecret } : {}),
      },
      body: JSON.stringify(payload(o, base)),
      signal: controller.signal,
    });
    record({
      reference: o.reference, at: new Date().toISOString(),
      ok: res.ok, detail: `HTTP ${res.status}`,
    });
    if (!res.ok) console.error(`order ${o.reference}: webhook answered ${res.status}`);
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'failed';
    record({ reference: o.reference, at: new Date().toISOString(), ok: false, detail });
    console.error(`order ${o.reference}: webhook failed — ${detail}`);
  } finally {
    clearTimeout(timer);
  }
}
