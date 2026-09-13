import { api, inr } from './api.js';
import { countPage } from './analytics.js';

/**
 * Where a customer checks on an order.
 *
 * There are no accounts on this site, so the reference is the key — anybody
 * holding it can see the order, and nobody else can guess it. That is why the
 * page is noindex and why it shows no more than the person who placed it
 * already knows.
 *
 * It matters more here than on most shops: delivery takes fifteen to
 * twenty-five days, and without this the only way to ask "where is it" is to
 * telephone during business hours.
 */
countPage();

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const shop = globalThis.__SHOP ?? {};
const DELIVERY = shop.deliveryMinDays && shop.deliveryMaxDays
  ? `${shop.deliveryMinDays}–${shop.deliveryMaxDays} days` : '15–25 days';

/*
 * What each status means to the person waiting, in their terms rather than
 * ours. "Pending" tells a customer nothing; "we will call you" tells them what
 * happens next and roughly when.
 */
const STEPS = [
  ['pending', 'Placed', 'We will call you to confirm the order and arrange payment. Nothing has been charged.'],
  ['paid', 'Paid', `Payment received. Your parcel is being prepared — allow ${DELIVERY} from here.`],
  ['shipped', 'On its way', 'Dispatched. If you need the courier details, get in touch and quote your reference.'],
];

function render(order) {
  const cancelled = order.status === 'cancelled';
  const reached = STEPS.findIndex(([s]) => s === order.status);

  $('#result').innerHTML = `
    <div class="ord">
      <div class="ord-head">
        <div>
          <span class="k">Reference</span>
          <b class="mono">${esc(order.reference)}</b>
        </div>
        <div>
          <span class="k">Placed</span>
          <b>${new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</b>
        </div>
        <div>
          <span class="k">Total</span>
          <b>${inr(order.total)}</b>
        </div>
      </div>

      ${cancelled
        ? `<p class="cancelled">This order was cancelled. Nothing was charged.
           <a href="/contact.html">Get in touch</a> if that is unexpected.</p>`
        : `<ol class="steps">${STEPS.map(([s, label, what], i) => `
            <li class="${i < reached ? 'done' : i === reached ? 'now' : ''}">
              <b>${label}</b>
              ${i === reached ? `<span>${esc(what)}</span>` : ''}
            </li>`).join('')}</ol>`}

      <h2>What you ordered</h2>
      <div class="ord-lines">
        ${order.lines.map((l) => `<div>
          <span>${esc(l.title)} — ${esc(l.variantLabel)} × ${l.quantity}</span>
          <span>${inr(l.unitPrice * l.quantity)}</span></div>`).join('')}
        <div><span>Shipping</span><span>${order.shipping === 0 ? 'Free' : inr(order.shipping)}</span></div>
        <div><span>GST (${Math.round(order.taxRate * 100)}%)</span><span>${inr(order.tax)}</span></div>
        <div class="grand"><span>Total</span><span>${inr(order.total)}</span></div>
      </div>

      <h2>Going to</h2>
      <p class="addr">${[order.address.line1, order.address.line2, order.address.city,
        order.address.state, order.address.pincode].filter(Boolean).map(esc).join('<br>')}</p>

      <p class="muted-note">Something wrong with this order?
      <a href="/contact.html">Tell us</a> and quote the reference above.</p>
    </div>`;
  $('#result').hidden = false;
}

async function look(ref) {
  $('#error').hidden = true;
  $('#result').hidden = true;
  try {
    render(await api.order(ref));
    // So a reload, a bookmark or a forwarded link all land on the same order.
    history.replaceState({}, '', `/order.html?ref=${encodeURIComponent(ref)}`);
  } catch {
    // Deliberately the same answer for "no such order" and anything else: a
    // different message per case turns this into a way to test references.
    $('#error').textContent = 'No order found with that reference. Check it against your '
      + 'confirmation — it is case-sensitive and looks like OXJ-260913-A4F2.';
    $('#error').hidden = false;
  }
}

$('#find').addEventListener('submit', (e) => {
  e.preventDefault();
  const ref = new FormData(e.target).get('ref').trim().toUpperCase();
  if (ref) void look(ref);
});

const fromUrl = new URLSearchParams(location.search).get('ref');
if (fromUrl) {
  $('#find').querySelector('[name=ref]').value = fromUrl.toUpperCase();
  void look(fromUrl.trim().toUpperCase());
}
