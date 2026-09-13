import { api } from './api.js';
import { countPage } from './analytics.js';

/**
 * Fills the seller's own details into the legal pages.
 *
 * A privacy policy that names nobody, or a contact page with no address, is
 * worse than none: it looks like compliance and gives a customer nothing to
 * act on. So an unfilled field renders as a visible warning rather than an
 * empty space nobody notices.
 */
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const missing = (what) =>
  `<mark class="unfilled">not published yet — set ${escapeHtml(what)} in data/business.json</mark>`;

const value = (v, what) =>
  (typeof v === 'string' && v.trim() && !v.includes('FILL_ME')) ? escapeHtml(v) : missing(what);

export async function fillBusiness() {
  let b;
  try { b = await api.business(); } catch { return; }
  const g = b.grievanceOfficer ?? {};

  const put = (sel, html) => { const el = document.querySelector(sel); if (el) el.innerHTML = html; };

  put('[data-b="legalName"]', value(b.legalName, 'legalName'));
  put('[data-b="tradingName"]', escapeHtml(b.tradingName || 'this shop'));
  put('[data-b="address"]', value(b.address, 'address').replace(/,\s*/g, ',<br>'));
  put('[data-b="email"]', b.email && !b.email.includes('FILL_ME')
    ? `<a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>` : missing('email'));
  put('[data-b="phone"]', value(b.phone, 'phone'));
  put('[data-b="hours"]', escapeHtml(b.hours ?? ''));
  put('[data-b="updated"]', value(b.policyUpdated, 'policyUpdated'));
  put('[data-b="officer"]', value(g.name, 'grievanceOfficer.name'));
  put('[data-b="officerEmail"]', g.email && !g.email.includes('FILL_ME')
    ? `<a href="mailto:${escapeHtml(g.email)}">${escapeHtml(g.email)}</a>` : missing('grievanceOfficer.email'));

  for (const el of document.querySelectorAll('[data-b-optional="gstin"]')) {
    if (b.gstin) el.innerHTML = `GSTIN ${escapeHtml(b.gstin)}`; else el.remove();
  }

  countPage();

  // The delivery window comes from data/business.json like everything else on
  // these pages, so it cannot say one thing here and another on a product.
  const shop = globalThis.__SHOP ?? {};
  if (shop.deliveryMinDays && shop.deliveryMaxDays) {
    for (const el of document.querySelectorAll('[data-b="delivery"]')) {
      el.textContent = `${shop.deliveryMinDays}–${shop.deliveryMaxDays} days`;
    }
  }

  /*
   * A policy that describes collection which is switched off is as wrong as one
   * that omits collection which is on. Both sections are driven by the same
   * config the server actually runs on, so the page cannot drift from the code.
   */
  const pixelOn = Boolean(globalThis.__SHOP?.pixelId);
  for (const el of document.querySelectorAll('[data-when="pixel"]')) el.hidden = !pixelOn;
  for (const el of document.querySelectorAll('[data-when="no-pixel"]')) el.hidden = pixelOn;
  const statsOn = globalThis.__SHOP?.analytics !== false;
  for (const el of document.querySelectorAll('[data-when="stats"]')) el.hidden = !statsOn;
}

fillBusiness();
