import { api, inr, imgTag, imgAttrs } from './api.js';
import * as cart from './cart.js';
import { track, count, countPage, rupees } from './analytics.js';

const $ = (s) => document.querySelector(s);
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const slug = new URLSearchParams(location.search).get('slug');

/*
 * Shipping thresholds come from the server so the product page, the cart and
 * the footer cannot disagree about them. They were hardcoded in three places.
 */
const shop = globalThis.__SHOP ?? {};
const FREE_OVER = shop.freeShippingOver ?? 0;
const SHIPPING_FLAT = shop.shippingFlat ?? 0;
/*
 * How long a customer waits, from data/business.json. Said up front and in
 * plain words: a fifteen-to-twenty-five day wait discovered after paying is
 * the single most common reason an order turns into a dispute.
 */
const DELIVERY = shop.deliveryMinDays && shop.deliveryMaxDays
  ? `${shop.deliveryMinDays}–${shop.deliveryMaxDays} days`
  : '';

/** Filled before render, for the breadcrumb. */
const catalogue = { categories: [] };

/** Beyond this many colourways the grid becomes wallpaper, so the rest fold away. */
const SWATCHES_SHOWN = 12;

/**
 * Five stars, filled to a rating. Drawn rather than written so it reads at a
 * glance, with the number beside it because a row of stars alone is the thing
 * people have learned to distrust.
 */
function stars(value, size = 14) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const row = (fill) => `<span style="color:${fill}">${'★'.repeat(5)}</span>`;
  return `<span class="stars" style="font-size:${size}px" role="img"
    aria-label="${value} out of 5">${row('var(--rule-strong)')}
    <span class="fill" style="width:${pct}%">${row('var(--brass)')}</span></span>`;
}

/** Chip sizes written beside every swatch — see src/lib/resize.ts. */
const SWATCH_CHIPS = [160, 320];

/**
 * Swap the hero without dropping back to the full-size file. Setting only
 * `src` leaves a stale `srcset` in place, and the browser keeps honouring it.
 */
function setHero(image, alt) {
  const hero = $('#hero');
  if (!hero) return;
  const a = imgAttrs(image, '(max-width: 900px) 100vw, 560px');
  hero.srcset = a.srcset;
  hero.sizes = a.sizes;
  hero.src = a.src;
  hero.alt = alt;
}
let product = null;
let selected = null;

function render() {
  document.title = `${product.title} — Moteeka`;
  const images = product.images.length ? product.images : [{ path: '', alt: product.title }];

  // Selecting a colourway swaps the hero to that colourway's photograph, and
  // one is selected on load. Rendering the gallery's first image and then
  // replacing it downloads two heroes to show one.
  const first = product.variants.find((v) => v.stock > 0) ?? product.variants[0];
  const hero = first?.swatch
    ? { path: first.swatch, alt: `${product.title} — ${first.label}` }
    : images[0];

  /*
   * Only the rows a buyer reads, as a definition list rather than a table: a
   * two-column table of five rows is a table because it was easy, not because
   * the data is tabular.
   */
  const specRows = Object.entries({
    Material: product.material, Finish: product.finish, ...product.details,
  }).filter(([, v]) => v).map(([k, v]) =>
    `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');

  const category = (catalogue.categories ?? []).find((c) => c.slug === product.category);

  $('#detail').innerHTML = `
    <div class="gallery">
      <button class="main" id="zoom" aria-label="View larger">${imgTag(hero, {
        // The hero is full width on a phone and about half of a 1100px page.
        sizes: '(max-width: 900px) 100vw, 560px',
        alt: hero.alt,
        extra: 'id="hero" fetchpriority="high" decoding="async"',
      })}<span class="zoom-hint" aria-hidden="true">⤢</span></button>
      ${images.length > 1 ? `<div class="thumbs" id="thumbs">${images.map((im, i) =>
        `<button data-i="${i}" aria-current="${i === 0}">${imgTag(im, {
          sizes: '64px', extra: 'loading="lazy" decoding="async"',
        })}</button>`).join('')}</div>` : ''}
    </div>

    <div class="buy">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/">All pieces</a>
        ${category ? `<span>/</span><a href="/?category=${encodeURIComponent(category.slug)}">${escapeHtml(category.name)}</a>` : ''}
      </nav>

      <h1>${escapeHtml(product.title)}</h1>
      ${product.rating ? `<a class="rating-line" href="#reviews">
        ${stars(product.rating.average)}
        <b>${product.rating.average}</b>
        <span>${product.rating.count} ${product.rating.count === 1 ? 'review' : 'reviews'}</span>
      </a>` : ''}
      ${product.tagline ? `<p class="tagline">${escapeHtml(product.tagline)}</p>` : ''}

      <div class="buy-price" id="price"></div>
      <p class="price-note">Inclusive of all taxes${
        FREE_OVER ? ` · Free delivery over ${inr(FREE_OVER)}` : ''}</p>

      <div class="colourways" id="colourways" hidden>
        <div class="cw-head">
          <span class="label">Colourway</span>
          <span class="chosen" id="variant-name"></span>
        </div>
        <div class="variants" id="variants"></div>
        <button class="more" id="more-swatches" hidden></button>
      </div>

      <p id="stockline" class="stock-low"></p>
      <p class="watching" id="watching" hidden><span class="dot" aria-hidden="true"></span>
        <b id="watching-n"></b> looking at this right now</p>
      ${product.recentViews ? `<p class="interest">Opened
        <b>${product.recentViews} times</b> in the last ${product.recentViewDays} days</p>` : ''}

      <div class="buy-row">
        <div class="qty">
          <button type="button" id="minus" aria-label="Decrease quantity">−</button>
          <input id="qty" value="1" inputmode="numeric" aria-label="Quantity">
          <button type="button" id="plus" aria-label="Increase quantity">+</button>
        </div>
        <button class="btn" id="add">Add to cart</button>
        <button class="btn ghost" id="buy-now">Buy now</button>
      </div>

      <!--
        Three things that are true of this shop. Not a badge wall: every claim
        here is one the footer and the contact page already make, and there is
        nothing about secure payment because no payment is taken on the site.
      -->
      <ul class="assurances">
        <li><b>Free delivery over ${inr(FREE_OVER)}</b><span>Flat ${inr(SHIPPING_FLAT)} below that</span></li>
        <li><b>Delivery in ${DELIVERY || '15–25 days'}</b><span>Shipped across India</span></li>
        <li><b>Nothing is charged online</b><span>We call to confirm before dispatch</span></li>
      </ul>

      <div class="folds">
        ${product.description ? `
        <details open>
          <summary>About this piece</summary>
          <div><p class="about">${escapeHtml(product.description)}</p></div>
        </details>` : ''}
        ${specRows ? `
        <details>
          <summary>Specifications</summary>
          <div><dl class="specs2">${specRows}</dl></div>
        </details>` : ''}
        <details>
          <summary>Care</summary>
          <div><p class="about">Keep it away from water, perfume and sprays, and put it on after
          those rather than before. Wipe with a dry cloth after wearing and keep it in a pouch
          rather than loose in a box. On an oxidised piece the darkening is the finish, not
          tarnish — polishing it off takes the depth out of the work.</p></div>
        </details>
        <details>
          <summary>Delivery and returns</summary>
          <div><p class="about"><b>Please allow ${DELIVERY || '15–25 days'} for delivery.</b> These
          pieces are made to order and travel a long way before they reach you, so this is longer
          than a shop holding stock on a shelf — we would rather say so here than have it be a
          surprise after you have paid. Shipped across India; delivery is free over
          ${inr(FREE_OVER)} and ${inr(SHIPPING_FLAT)} below it.</p>
          <p class="about">No payment is taken on this site. We call to confirm the order and
          arrange payment before anything is sent, so you can cancel at no cost up to that point.
          <a href="/contact.html">Contact us</a> about a piece that arrives damaged or not as
          described, and we will replace it or refund it.</p></div>
        </details>
      </div>
    </div>`;

  const variants = $('#variants');
  const hasSwatches = product.variants.some((v) => v.swatch);
  if (hasSwatches) variants.classList.add('swatches');
  product.variants.forEach((v) => {
    const b = document.createElement('button');
    b.dataset.sku = v.sku;
    b.title = v.label;
    if (v.swatch) {
      // The picture is the label; the name still goes to screen readers.
      b.classList.add('swatch');
      b.setAttribute('aria-label', v.label);
      const im = document.createElement('img');
      // A chip is drawn at 68 px; the full file is only fetched when the
      // swatch is clicked and becomes the hero.
      const chip = imgAttrs({ path: v.swatch, widths: SWATCH_CHIPS }, '68px');
      im.src = chip.src;
      if (chip.srcset) { im.srcset = chip.srcset; im.sizes = chip.sizes; }
      im.alt = '';
      im.loading = 'lazy';
      im.decoding = 'async';
      b.appendChild(im);
    } else {
      b.textContent = v.label;
    }
    if (v.stock === 0) b.disabled = true;
    b.addEventListener('click', () => select(v.sku));
    variants.appendChild(b);
  });
  $('#colourways').hidden = product.variants.length < 2;

  /*
   * Twenty-three swatches in one block reads as a texture, not as a choice.
   * Twelve is about where a grid still scans as individual pieces; the rest
   * are one click away and the count says how many there are.
   */
  const extra = product.variants.length - SWATCHES_SHOWN;
  if (extra > 0) {
    variants.classList.add('folded');
    const more = $('#more-swatches');
    more.hidden = false;
    more.textContent = `Show all ${product.variants.length} colourways`;
    more.addEventListener('click', () => {
      variants.classList.remove('folded');
      more.hidden = true;
    });
  }

  select(first.sku, { silent: true, keepHero: true });

  // Ours and Meta's, side by side: the first works with no ad running.
  count('product', { slug: product.slug });
  track('ViewContent', {
    content_type: 'product',
    content_ids: product.variants.map((v) => v.sku),
    content_name: product.title,
    content_category: product.category,
    value: rupees(Math.min(...product.variants.map((v) => v.price))),
    currency: 'INR',
  });

  // Opening the hero full size. A lightbox rather than a zoom lens: on a phone
  // the lens is the thing that never works, and this is the same control.
  $('#zoom')?.addEventListener('click', () => {
    const hero = $('#hero');
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${hero.currentSrc || hero.src}" alt="${escapeHtml(hero.alt)}">
      <button class="close" aria-label="Close">✕</button>`;
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('.lightbox')?.remove(); });

  $('#thumbs')?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const im = images[Number(b.dataset.i)];
    setHero(im, im.alt);
    for (const el of $('#thumbs').children) el.setAttribute('aria-current', String(el === b));
  });

  const qty = $('#qty');
  const clamp = (n) => Math.max(1, Math.min(selected?.stock || 1, n));
  $('#minus').addEventListener('click', () => { qty.value = clamp(Number(qty.value) - 1); });
  $('#plus').addEventListener('click', () => { qty.value = clamp(Number(qty.value) + 1); });
  qty.addEventListener('change', () => { qty.value = clamp(Number(qty.value) || 1); });

  /*
   * The phone buy bar. Driven by whether the real Add to cart is on screen, so
   * there is never a moment with two of them visible arguing for the same tap.
   */
  const bar = $('#buy-bar');
  if (bar && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      bar.hidden = e.isIntersecting || !selected || selected.stock === 0;
    }, { rootMargin: '-60px 0px 0px 0px' }).observe($('.buy-row'));
    $('#bb-add').addEventListener('click', () => $('#add').click());
  }

  // Straight to checkout. The same add, then a navigation — not a second path
  // through pricing, which is where a "buy now" usually goes wrong.
  $('#buy-now').addEventListener('click', () => {
    if (!selected || selected.stock === 0) return;
    cart.add(selected.sku, Number(qty.value) || 1);
    count('add', { slug: product.slug });
    location.href = '/checkout.html';
  });

  $('#add').addEventListener('click', () => {
    if (!selected || selected.stock === 0) return;
    const quantity = Number(qty.value) || 1;
    cart.add(selected.sku, quantity);
    count('add', { slug: product.slug });
    track('AddToCart', {
      content_type: 'product',
      content_ids: [selected.sku],
      content_name: `${product.title} — ${selected.label}`,
      value: rupees(selected.price * quantity),
      currency: 'INR',
      contents: [{ id: selected.sku, quantity }],
    });
  });
}

function select(sku, { silent = false, keepHero = false } = {}) {
  selected = product.variants.find((v) => v.sku === sku) ?? null;

  /**
   * Which design a visitor picks is the question the catalogue cannot answer.
   * Nine patterns are priced identically because there was nothing to price
   * them on; this is what tells you which three are worth ordering.
   */
  if (!silent && selected) {
    count('variant', { slug: product.slug });
    track('SelectVariant', {
      content_ids: [selected.sku],
      content_name: product.title,
      variant_label: selected.label,
      variant_index: product.variants.indexOf(selected),
      in_stock: selected.stock > 0,
    });
  }
  for (const b of $('#variants').children) b.setAttribute('aria-pressed', String(b.dataset.sku === sku));
  const nameEl = $('#variant-name');
  if (nameEl && selected) {
    nameEl.textContent = selected.stock === 0 ? `${selected.label} — sold out` : selected.label;
  }
  // A colour swatch is a photograph of the piece, so show it large on selection.
  if (selected?.swatch && !keepHero) {
    // The stored swatch is hero-sized; only the chip siblings are small.
    setHero({ path: selected.swatch }, `${product.title} — ${selected.label}`);
    for (const el of ($('#thumbs')?.children ?? [])) el.setAttribute('aria-current', 'false');
  }
  /*
   * The price block was two numbers the same size, side by side — "₹755 ₹839"
   * with nothing saying which one you pay. Now: what you pay is the big one,
   * what it was is struck and quiet, and the saving is stated in words so
   * nobody has to do the arithmetic to see whether the sale is worth anything.
   */
  const onSale = selected?.compareAt && selected.compareAt > selected.price;
  const saved = onSale ? selected.compareAt - selected.price : 0;
  $('#price').innerHTML = !selected ? '' : `
    <span class="now">${inr(selected.price)}</span>
    ${onSale ? `<s class="was">${inr(selected.compareAt)}</s>
      <span class="save">Save ${inr(saved)} · ${Math.round((saved / selected.compareAt) * 100)}%</span>` : ''}`;
  // The bar mirrors the price block rather than formatting it a second time.
  const bbNow = $('#bb-now');
  if (bbNow && selected) {
    bbNow.textContent = inr(selected.price);
    const bbWas = $('#bb-was');
    const sale = selected.compareAt && selected.compareAt > selected.price;
    bbWas.textContent = sale ? inr(selected.compareAt) : '';
    bbWas.hidden = !sale;
  }

  const line = $('#stockline');
  const gone = !selected || selected.stock === 0;
  // Only a genuinely small number is worth saying. "Only 15 left" on a piece
  // with fifteen in a drawer is the manufactured-scarcity trick, and it is
  // both a dark pattern and a lie the stock file can contradict.
  if (gone) line.textContent = 'Sold out in this colourway';
  else if (selected.stock <= 5) line.textContent = `Only ${selected.stock} left`;
  else line.textContent = '';
  for (const id of ['#add', '#buy-now']) {
    const b = $(id);
    if (b) b.disabled = gone;
  }
  $('#qty').value = '1';
}

/**
 * Presence: how many people are on this page at the same time as you.
 *
 * A heartbeat every forty-five seconds while the tab is visible, and nothing at
 * all while it is hidden — a phone in a pocket is not a person looking at a
 * necklace, and counting it would make the number a lie in the slowest possible
 * way. The token is the per-tab visit id, which never leaves the browser except
 * for this and is held on the server for ninety seconds.
 */
function watchLive() {
  const line = $('#watching');
  if (!line) return;

  let token;
  try {
    token = sessionStorage.getItem('oxj.tab');
    if (!token) {
      token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('oxj.tab', token);
    }
  } catch {
    token = Math.random().toString(36).slice(2);
  }

  /*
   * The number counts to its new value rather than snapping. A count that
   * jumps is read as a widget; one that moves is read as a measurement — and
   * this one *is* a measurement, so it should look like what it is.
   */
  const el = $('#watching-n');
  let shown = 0;
  let stepper = null;

  const show = (n, animate = true) => {
    line.hidden = !n;
    if (!n) { shown = 0; return; }
    if (!animate || shown === 0) {
      shown = n;
      el.textContent = `${n} ${n === 1 ? 'person' : 'people'}`;
      return;
    }
    clearInterval(stepper);
    stepper = setInterval(() => {
      if (shown === n) { clearInterval(stepper); return; }
      shown += Math.sign(n - shown);
      el.textContent = `${shown} ${shown === 1 ? 'person' : 'people'}`;
      line.classList.add('ticked');
      setTimeout(() => line.classList.remove('ticked'), 260);
    }, 70);
  };
  show(product.watching ?? 0, false);

  const beat = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(product.slug)}/live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) show((await res.json()).watching);
    } catch {
      // A missed heartbeat is not worth a broken page; the next one will do.
    }
  };
  /*
   * Twenty seconds. The presence window is ninety, so this is three beats of
   * slack before a visit is dropped — and it is short enough that arrivals and
   * departures show up while somebody is still on the page, which is the whole
   * point of saying it at all.
   */
  void beat();
  setInterval(beat, 20_000);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void beat(); });
}

/**
 * Reviews, and the form for leaving one.
 *
 * The form asks for an order reference, and the server refuses anything that
 * is not a real order containing this piece. That check is the difference
 * between a rating system and a liability — and it is why the shop shows no
 * stars at all until somebody has actually bought something.
 */
async function renderReviews() {
  const box = $('#reviews');
  if (!box) return;
  const data = await fetch(`/api/products/${encodeURIComponent(product.slug)}/reviews`)
    .then((r) => r.json()).catch(() => null);
  if (!data) return;

  const { rating, reviews: list } = data;
  const bar = (n) => {
    const share = rating.count ? (rating.spread[n] / rating.count) * 100 : 0;
    return `<div class="bar"><span>${n}★</span>
      <span class="track"><span style="width:${share}%"></span></span>
      <span class="n">${rating.spread[n]}</span></div>`;
  };

  box.innerHTML = `
    <h2>Reviews</h2>
    ${rating ? `
      <div class="rating-summary">
        <div class="big">
          <span class="avg">${rating.average}</span>
          ${stars(rating.average, 18)}
          <span class="cnt">${rating.count} verified ${rating.count === 1 ? 'review' : 'reviews'}</span>
        </div>
        <div class="bars">${[5, 4, 3, 2, 1].map(bar).join('')}</div>
      </div>
      <ul class="review-list">${list.map((r) => `<li>
        ${stars(r.rating, 13)}
        ${r.title ? `<b>${escapeHtml(r.title)}</b>` : ''}
        ${r.body ? `<p>${escapeHtml(r.body)}</p>` : ''}
        <span class="who">${escapeHtml(r.name)} · verified buyer ·
          ${new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      </li>`).join('')}</ul>`
      : `<p class="muted-note">No reviews yet — this piece has not been rated by anyone who bought it.
         Ratings here only ever come from a real order, so there is nothing to show until then.</p>`}

    <details class="write">
      <summary>Bought this? Leave a review</summary>
      <form id="review-form">
        <p class="muted-note">Your order reference is on the confirmation — it looks like
        <span class="mono">OXJ-260913-A4F2</span>. It is checked against the order and never shown
        to anyone.</p>
        <div class="picker" id="picker" role="radiogroup" aria-label="Rating">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="false"
            data-n="${n}" aria-label="${n} star${n === 1 ? '' : 's'}">★</button>`).join('')}
        </div>
        <label>Order reference<input name="reference" required placeholder="OXJ-…" spellcheck="false"></label>
        <label>Name shown<input name="name" maxlength="40" placeholder="Optional — your first name otherwise"></label>
        <label>Headline<input name="title" maxlength="80" placeholder="Optional"></label>
        <label>Your review<textarea name="body" rows="4" maxlength="1200" placeholder="Optional"></textarea></label>
        <button class="btn" type="submit">Submit review</button>
        <p class="note" id="review-note" role="status"></p>
      </form>
    </details>`;

  let chosen = 0;
  const picker = $('#picker');
  picker?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    chosen = Number(b.dataset.n);
    for (const el of picker.children) {
      const on = Number(el.dataset.n) <= chosen;
      el.setAttribute('aria-checked', String(Number(el.dataset.n) === chosen));
      el.classList.toggle('on', on);
    }
  });

  $('#review-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = $('#review-note');
    if (!chosen) { note.textContent = 'Pick a star rating first.'; note.className = 'note warn'; return; }
    const f = new FormData(e.target);
    note.textContent = 'Sending…';
    note.className = 'note';
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(product.slug)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: chosen,
          reference: f.get('reference'),
          name: f.get('name') || undefined,
          title: f.get('title') || undefined,
          body: f.get('body') || undefined,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? 'could not send that');
      // Said plainly, because the alternative is someone refreshing the page
      // looking for words that are not going to appear on their own.
      e.target.innerHTML = `<p class="note good">Thank you — it has been sent for checking and
        will appear here once it is approved.</p>`;
    } catch (err) {
      note.textContent = err.message;
      note.className = 'note warn';
    }
  });
}

/**
 * Other pieces from the same category. A product page with nothing after it is
 * a dead end — whoever lands on one from an ad has exactly one thing to look at
 * and one way to leave.
 */
async function related() {
  const box = $('#related');
  if (!box) return;
  const page = await api.products({ category: product.category, perPage: 9 }).catch(() => null);
  const others = (page?.items ?? []).filter((p) => p.slug !== product.slug).slice(0, 4);
  if (others.length < 2) return;
  box.innerHTML = `<h2>More in ${escapeHtml(catalogue.categories.find((c) => c.slug === product.category)?.name ?? 'this category')}</h2>
    <div class="grid">${others.map((p) => {
      const v = p.variants.find((x) => x.stock > 0) ?? p.variants[0];
      const was = v?.compareAt && v.compareAt > v.price ? v.compareAt : null;
      return `<a class="card" href="/product.html?slug=${encodeURIComponent(p.slug)}">
        <div class="shot">${was ? '<span class="badge sale">Sale</span>' : ''}${imgTag(p.images[0], {
          sizes: '(max-width: 700px) 46vw, 260px', alt: p.images[0]?.alt ?? p.title,
          extra: 'loading="lazy" decoding="async"',
        })}</div>
        <div class="title">${escapeHtml(p.title)}</div>
        <div class="price"><span>${inr(v?.price ?? 0)}</span>${was ? `<span class="was">${inr(was)}</span>` : ''}</div>
      </a>`;
    }).join('')}</div>`;
  box.hidden = false;
}

(async () => {
  // Before the fetch: a page that fails to load is still a page that was opened.
  countPage();
  if (!slug) { location.href = '/'; return; }
  try {
    const [p, cats] = await Promise.all([api.product(slug), api.categories().catch(() => [])]);
    product = p;
    catalogue.categories = cats;
    render();
    void related();
    void renderReviews();
    watchLive();
  } catch (e) {
    $('#detail').innerHTML = `<p class="empty">${escapeHtml(e.message)} — <a href="/">back to all pieces</a></p>`;
  }
  cart.render();
})();
