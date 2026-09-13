import { api, inr, imgTag, lowestPrice } from './api.js';
import { countPage } from './analytics.js';

/**
 * A dead end with a way out. Shows what is new rather than nothing — whoever
 * arrived here followed a link that used to work, and a blank apology sends
 * them back to wherever they came from.
 */
countPage();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const page = await api.products({ perPage: 4, sort: 'newest' }).catch(() => null);
const box = document.querySelector('#related');
if (page?.items?.length && box) {
  box.innerHTML = `<h2>Newest pieces</h2><div class="grid">${page.items.map((p) => `
    <a class="card" href="/product.html?slug=${encodeURIComponent(p.slug)}">
      <div class="shot">${imgTag(p.images[0], {
        sizes: '(max-width: 700px) 46vw, 260px', alt: p.images[0]?.alt ?? p.title,
        extra: 'loading="lazy" decoding="async"',
      })}</div>
      <div class="title">${esc(p.title)}</div>
      <div class="price"><span>${inr(lowestPrice(p))}</span></div>
    </a>`).join('')}</div>`;
  box.hidden = false;
}
