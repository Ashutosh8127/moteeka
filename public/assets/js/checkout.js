import { api, inr } from './api.js';
import * as cart from './cart.js';
import { track, count, countPage, rupees } from './analytics.js';

const $ = (s) => document.querySelector(s);
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function summary() {
  const lines = cart.lines();
  if (lines.length === 0) {
    $('#summary').innerHTML = '<div class="empty">Your cart is empty. <a href="/">Browse pieces</a></div>';
    $('#form').hidden = true;
    return null;
  }
  const q = await api.quote(lines);
  if (q.dropped?.length) {
    // Same reason as the drawer: say what is wrong and give them the way out.
    $('#summary').innerHTML = q.dropped.map((d) =>
      `<div><span>${escapeHtml(d.title ?? d.sku)}</span><span>${
        d.reason === 'sold-out' ? 'Sold out' : 'No longer available'}</span></div>`).join('')
      + `<p style="color:var(--warn);margin-top:12px">Remove these from your basket to continue.</p>`
      + `<p style="margin-top:10px"><a class="btn ghost" href="/" style="text-decoration:none;display:inline-block">Back to the shop</a></p>`;
    $('#form').hidden = true;
    return null;
  }
  $('#summary').innerHTML =
    q.lines.map((l) => `<div><span>${escapeHtml(l.title)} · ${escapeHtml(l.variantLabel)} × ${l.quantity}</span><span>${inr(l.unitPrice * l.quantity)}</span></div>`).join('') +
    `<div><span>Shipping</span><span>${q.shipping === 0 ? 'Free' : inr(q.shipping)}</span></div>` +
    `<div><span>GST (${Math.round(q.taxRate * 100)}%)</span><span>${inr(q.tax)}</span></div>` +
    `<div class="grand"><span>Total</span><span>${inr(q.total)}</span></div>`;

  for (const l of q.lines) if (l.slug) count('checkout', { slug: l.slug });
  track('InitiateCheckout', {
    content_type: 'product',
    content_ids: q.lines.map((l) => l.sku),
    num_items: q.lines.reduce((a, l) => a + l.quantity, 0),
    value: rupees(q.total),
    currency: 'INR',
  });
  return q;
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  $('#error').textContent = '';
  const f = new FormData(e.target);
  try {
    const order = await api.placeOrder({
      lines: cart.lines(),
      customer: { name: f.get('name'), email: f.get('email'), phone: f.get('phone') },
      address: {
        line1: f.get('line1'), line2: f.get('line2') || undefined,
        city: f.get('city'), state: f.get('state'), pincode: f.get('pincode'),
      },
    });
    /**
     * Not `Purchase`: no money has changed hands. The order is a request that
     * you confirm by phone, so this is a lead, and calling it a sale would put
     * revenue in Meta's reporting that nobody has been paid. Change it to
     * `Purchase` on the day a payment gateway actually captures.
     */
    track('Lead', { content_ids: order.lines.map((l) => l.sku), value: rupees(order.total), currency: 'INR' });
    track('OrderPlaced', {
      reference: order.reference,
      content_ids: order.lines.map((l) => l.sku),
      value: rupees(order.total), currency: 'INR',
    });

    cart.clear();
    $('#form').hidden = true;
    $('#summary').hidden = true;
    const done = $('#done');
    done.hidden = false;
    done.innerHTML = `
      <h2 style="font-family:var(--display);font-weight:400;font-size:26px;margin:0 0 8px">Order placed</h2>
      <p style="color:var(--ink-2)">Reference <b style="font-family:var(--mono)">${escapeHtml(order.reference)}</b> — ${inr(order.total)}.
      Nothing has been charged. Our team will contact <b>${escapeHtml(order.customer.phone)}</b> to confirm
      the order and your address, and will then send payment details. We dispatch once payment is received,
      and you can cancel at no cost before you pay.</p>
      <!--
        There are no accounts here, so this link is the customer's only way back
        to the order. Said plainly and put first: a reference on a screen someone
        closes is a reference that is gone.
      -->
      <p style="margin-top:16px;color:var(--ink-2)"><b>Save this link</b> — it is how you check on
      your order, and we do not have accounts to log in to.</p>
      <p style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn" href="/order.html?ref=${encodeURIComponent(order.reference)}"
          style="text-decoration:none;display:inline-block">Track this order</a>
        <a class="btn ghost" href="/" style="text-decoration:none;display:inline-block">Continue shopping</a>
      </p>`;
  } catch (err) {
    $('#error').textContent = err.message;
    btn.disabled = false;
  }
});

/*
 * The delivery window is quoted in four places and comes from one: whatever
 * data/business.json says. A checkout that promises sooner than the product
 * page is where a dispute starts.
 */
const win = $('#delivery-window');
if (win && window.__SHOP?.deliveryMinDays) {
  win.textContent = `${window.__SHOP.deliveryMinDays}\u2013${window.__SHOP.deliveryMaxDays} days`;
}

countPage();
summary();
cart.render();
