import { api, inr, imgTag } from './api.js';

/**
 * The cart lives in localStorage as SKUs and quantities only — never prices.
 * Every total shown is quoted by the server, so a cart edited in devtools
 * cannot change what anything costs.
 */
const KEY = 'oxj.cart.v1';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); }
  catch { return []; }
}
function write(lines) {
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* private window */ }
  render();
}

export function add(sku, quantity = 1) {
  const lines = read();
  const found = lines.find((l) => l.sku === sku);
  if (found) found.quantity += quantity;
  else lines.push({ sku, quantity });
  write(lines);
  open();
}
export function remove(sku) { write(read().filter((l) => l.sku !== sku)); }
export function setQty(sku, quantity) {
  if (quantity <= 0) return remove(sku);
  write(read().map((l) => (l.sku === sku ? { ...l, quantity } : l)));
}
export function lines() { return read(); }
export function count() { return read().reduce((a, l) => a + l.quantity, 0); }
export function clear() { write([]); }

/** A bin, drawn rather than written: "Remove" was reading as body text. */
const BIN = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
  <path d="M2.5 4h11M6.5 4V2.6h3V4M4 4l.7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4M6.6 6.6v5M9.4 6.6v5"
    fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const $ = (s) => document.querySelector(s);
export function open() { $('#cart')?.setAttribute('data-open', 'true'); $('#scrim')?.setAttribute('data-open', 'true'); }
export function close() { $('#cart')?.setAttribute('data-open', 'false'); $('#scrim')?.setAttribute('data-open', 'false'); }

let quoting = false;
export async function render() {
  const badge = $('#cart-count');
  if (badge) badge.textContent = String(count());

  const box = $('#cart-lines');
  const totals = $('#cart-totals');
  if (!box || !totals) return;

  const current = read();
  if (current.length === 0) {
    box.innerHTML = '<p class="empty">Your cart is empty.</p>';
    totals.innerHTML = '';
    $('#checkout')?.setAttribute('disabled', 'true');
    return;
  }

  if (quoting) return;
  quoting = true;
  try {
    const q = await api.quote(current);
    box.innerHTML = '';
    for (const l of q.lines) {
      const el = document.createElement('div');
      el.className = 'line';
      el.innerHTML = `
        ${imgTag({ path: l.image, widths: l.imageWidths }, {
          sizes: '56px', extra: `loading="lazy" onerror="this.style.visibility='hidden'"`,
        })}
        <div class="line-main">
          <div class="nm">${escapeHtml(l.title)}</div>
          <div class="vl">${escapeHtml(l.variantLabel)} · ${inr(l.unitPrice)} each</div>
          <div class="stepper">
            <button class="qty-down" data-sku="${l.sku}" aria-label="One fewer"
              ${l.quantity <= 1 ? 'disabled' : ''}>&minus;</button>
            <span class="qty" aria-live="polite">${l.quantity}</span>
            <button class="qty-up" data-sku="${l.sku}" aria-label="One more"
              ${l.stock !== undefined && l.quantity >= l.stock ? 'disabled' : ''}>+</button>
          </div>
          ${l.stock !== undefined && l.quantity >= l.stock
            ? `<div class="vl low">only ${l.stock} left</div>` : ''}
        </div>
        <div class="line-side">
          <div class="amt">${inr(l.unitPrice * l.quantity)}</div>
          <button class="rm" data-sku="${l.sku}" aria-label="Remove ${escapeHtml(l.title)}" title="Remove">${BIN}</button>
        </div>`;
      box.appendChild(el);
    }
    /*
     * A cart lives in the browser and the catalogue moves underneath it. A line
     * that can no longer be sold is shown as such, with the one button that
     * matters — before this the whole drawer failed to render and there was no
     * way to remove it.
     */
    for (const d of q.dropped ?? []) {
      const el = document.createElement('div');
      el.className = 'line gone';
      el.innerHTML = `
        <div class="shot-gone" aria-hidden="true"></div>
        <div class="line-main">
          <div class="nm">${escapeHtml(d.title ?? 'This piece')}</div>
          <div class="vl low">${d.reason === 'sold-out' ? 'Sold out' : 'No longer available'}</div>
        </div>
        <div class="line-side">
          <div class="amt">&mdash;</div>
          <button class="rm" data-sku="${escapeHtml(d.sku)}" aria-label="Remove" title="Remove">${BIN}</button>
        </div>`;
      box.appendChild(el);
    }

    totals.innerHTML = `
      <div><span>Subtotal</span><span>${inr(q.subtotal)}</span></div>
      <div><span>Shipping</span><span>${q.shipping === 0 ? 'Free' : inr(q.shipping)}</span></div>
      <div><span>GST (${Math.round(q.taxRate * 100)}%)</span><span>${inr(q.tax)}</span></div>
      <div class="grand"><span>Total</span><span>${inr(q.total)}</span></div>`;

    const blocked = (q.dropped ?? []).length > 0 || q.lines.length === 0;
    const checkout = $('#checkout');
    if (checkout) {
      if (blocked) checkout.setAttribute('disabled', 'true');
      else checkout.removeAttribute('disabled');
    }
  } catch (e) {
    // The quote itself failing is a server problem, not a cart problem — so
    // keep a way out rather than leaving the customer stuck.
    box.innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>`
      + `<button class="rm" id="cart-clear">Empty the cart</button>`;
    totals.innerHTML = '';
  } finally {
    quoting = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#cart-clear')) { clear(); render(); return; }

  // The stepper reads the quantity from the cart rather than from the rendered
  // number, so a double click cannot race the re-render.
  const down = e.target.closest('.qty-down');
  if (down) {
    const line = read().find((l) => l.sku === down.dataset.sku);
    if (line) setQty(down.dataset.sku, line.quantity - 1);
    return;
  }
  const up = e.target.closest('.qty-up');
  if (up) {
    const line = read().find((l) => l.sku === up.dataset.sku);
    if (line) setQty(up.dataset.sku, line.quantity + 1);
    return;
  }

  const rm = e.target.closest('.rm');
  if (rm) { remove(rm.dataset.sku); return; }
  if (e.target.closest('#keep-shopping')) { close(); return; }
  if (e.target.closest('#cart-open')) open();
  if (e.target.closest('#cart-close') || e.target.id === 'scrim') close();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
