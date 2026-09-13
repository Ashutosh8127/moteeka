import { api, inr, lowestPrice, compareAt, totalStock, imgTag } from './api.js';
import * as cart from './cart.js';
import { count, countPage } from './analytics.js';

const $ = (s) => document.querySelector(s);
const grid = $('#grid');

/** Pieces per page. 24 is the API's own default, so the two agree. */
const PER_PAGE = 24;

/*
 * The whole view lives in the query string — category, search, sort and page.
 * Not decoration: a visitor who opens a piece from page 3 and presses Back has
 * to land on page 3 of the same filter, and an ad can point at one category.
 */
const state = { category: '', search: '', sort: 'newest', page: 1, maxPrice: '' };

function readUrl() {
  const q = new URLSearchParams(location.search);
  state.category = q.get('category') ?? '';
  state.search = q.get('search') ?? '';
  state.sort = q.get('sort') ?? 'newest';
  state.maxPrice = q.get('under') ?? '';
  state.page = Math.max(1, Number(q.get('page')) || 1);
}

function writeUrl(replace = false) {
  const q = new URLSearchParams();
  if (state.category) q.set('category', state.category);
  if (state.search) q.set('search', state.search);
  if (state.sort !== 'newest') q.set('sort', state.sort);
  if (state.maxPrice) q.set('under', state.maxPrice);
  if (state.page > 1) q.set('page', String(state.page));
  const url = q.toString() ? `?${q}` : location.pathname;
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

/** Any change to what is being listed puts you back on the first page. */
function filtered(fn) {
  return (...args) => { fn(...args); state.page = 1; writeUrl(); load(); };
}

/**
 * Five stars clipped to a rating. Same two-row trick as the product page, kept
 * small enough to sit under a card title without competing with the price.
 */
function stars(value) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return `<span class="stars" role="img" aria-label="${value} out of 5">
    <span style="color:var(--rule-strong)">★★★★★</span>
    <span class="fill" style="width:${pct}%;color:var(--brass)">★★★★★</span></span>`;
}

function card(p) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `/product.html?slug=${encodeURIComponent(p.slug)}`;

  const img = p.images[0];
  const was = compareAt(p);
  const stock = totalStock(p);
  const badge = was ? '<span class="badge sale">Sale</span>' : '';

  a.innerHTML = `
    <div class="shot">
      ${badge}
      ${p.watching ? `<span class="watchers"><span class="dot" aria-hidden="true"></span>${p.watching}</span>` : ''}
      ${imgTag(img, {
        // Two across on a phone, a fixed column on desktop.
        sizes: '(max-width: 700px) 46vw, 300px',
        alt: img?.alt ?? p.title,
        extra: 'loading="lazy" decoding="async"',
      })}
    </div>
    <div class="title">${escapeHtml(p.title)}</div>
    ${p.rating ? `<div class="card-rating">${stars(p.rating.average)}
      <span>${p.rating.average}</span><small>(${p.rating.count})</small></div>` : ''}
    ${p.tagline ? `<p class="tag">${escapeHtml(p.tagline)}</p>` : ''}
    <div class="price">
      <span>${inr(lowestPrice(p))}</span>
      ${was ? `<span class="was">${inr(was)}</span>` : ''}
    </div>
    ${stock > 0 && stock <= 15 ? `<div class="stock-low">only ${stock} left</div>` : ''}
    ${stock === 0 ? '<div class="stock-low">sold out</div>' : ''}`;
  return a;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/*
 * Card-shaped placeholders, drawn before the request goes out.
 *
 * The measurements match the real card — the square shot, the 12px gap to the
 * title, a line each for tagline and price — so when the catalogue lands the
 * cards fill in where the boxes already were instead of shoving the page
 * around. A skeleton of the wrong height is worse than none: it moves the
 * content out from under whoever was about to tap it.
 *
 * Marked aria-hidden because there is nothing here to read. The status line
 * is what tells a screen reader the grid is busy.
 */
function skeletons(n = PER_PAGE) {
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'card-sk';
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<div class="shot skeleton" style="aspect-ratio:1"></div>'
      + '<div class="skeleton" style="height:15px;margin:13px 0 6px;width:76%"></div>'
      + '<div class="skeleton" style="height:11px;margin-bottom:11px;width:92%"></div>'
      + '<div class="skeleton" style="height:11px;width:34%"></div>';
    grid.appendChild(d);
  }
  // "loading…" is a word where a number belongs. A bar of the same size says
  // the count is coming without pretending to be one.
  const c = $('#count');
  if (c) {
    c.innerHTML = '<span class="skeleton" style="display:inline-block;width:86px;height:11px"></span>';
    c.setAttribute('aria-busy', 'true');
  }
}

async function load({ keepScroll = false } = {}) {
  // However many cards are on screen already, so paging does not change the
  // height of the grid under the reader's thumb.
  const showing = grid.querySelectorAll('.card, .card-sk').length;
  skeletons(showing || PER_PAGE);
  try {
    const page = await api.products({
      category: state.category, search: state.search, sort: state.sort,
      // The API takes rupees and holds paise — see rupeesToPaise in lib/http.ts.
      maxPrice: state.maxPrice || undefined,
      page: state.page, perPage: PER_PAGE,
    });

    /*
     * A page number out of range — a stale link, or a filter that shrank the
     * catalogue under it — answers with nothing rather than an error. Fall back
     * to the last real page instead of showing an empty grid that has results.
     */
    if (page.items.length === 0 && page.total > 0 && state.page > page.pages) {
      state.page = page.pages;
      writeUrl(true);
      return load({ keepScroll });
    }

    grid.innerHTML = '';
    if (page.items.length === 0) {
      grid.innerHTML = '<p class="empty">Nothing matches that. Try a different search.</p>';
    } else {
      for (const p of page.items) grid.appendChild(card(p));
    }

    const first = (page.page - 1) * page.perPage + 1;
    const last = first + page.items.length - 1;
    /*
     * A search that finds nothing is the most useful thing on this page: it is
     * a customer telling you what they came for and what you do not stock.
     */
    if (state.search) count('search', { q: state.search, empty: page.total === 0 });

    $('#count').textContent = page.total === 0 ? 'no pieces'
      : page.pages > 1 ? `${first}–${last} of ${page.total}`
      : `${page.total} piece${page.total === 1 ? '' : 's'}`;
    $('#count').removeAttribute('aria-busy');

    pager(page);
    if (!keepScroll) document.querySelector('.toolbar')?.scrollIntoView({ block: 'start' });
  } catch (e) {
    grid.innerHTML = `<p class="empty">Could not load the catalogue: ${escapeHtml(e.message)}</p>`;
    $('#count').textContent = '';
    $('#count').removeAttribute('aria-busy');
    $('#pager').hidden = true;
  }
}

/**
 * First, last, and a window of two either side of where you are — so the row
 * stays the same width at 3 pages and at 300, and the ends are always one
 * click away. Gaps collapse into an ellipsis rather than a jump in the numbers.
 */
function pageNumbers(current, pages) {
  const want = new Set([1, pages, current, current - 1, current + 1, current - 2, current + 2]);
  const shown = [...want].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  let previous = 0;
  for (const n of shown) {
    if (n - previous > 1) out.push('gap');
    out.push(n);
    previous = n;
  }
  return out;
}

function pager({ page: current, pages }) {
  const nav = $('#pager');
  nav.innerHTML = '';
  // One page of results needs no controls at all.
  nav.hidden = pages <= 1;
  if (nav.hidden) return;

  const step = (label, to, enabled, cls) => {
    const b = document.createElement('button');
    b.className = cls;
    b.innerHTML = label;
    if (enabled) b.dataset.page = String(to);
    else b.disabled = true;
    return b;
  };

  nav.appendChild(step('&larr; <span>Previous</span>', current - 1, current > 1, 'step'));
  for (const n of pageNumbers(current, pages)) {
    if (n === 'gap') {
      const s = document.createElement('span');
      s.className = 'gap';
      s.textContent = '…';
      nav.appendChild(s);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'num';
    b.textContent = String(n);
    b.dataset.page = String(n);
    if (n === current) {
      b.setAttribute('aria-current', 'page');
      b.disabled = true;
    }
    b.setAttribute('aria-label', `Page ${n}`);
    nav.appendChild(b);
  }
  nav.appendChild(step('<span>Next</span> &rarr;', current + 1, current < pages, 'step'));
}

/** The controls show what the URL says, not what they were left at. */
function syncControls() {
  $('#search').value = state.search;
  $('#sort').value = state.sort;
  if ($('#price')) $('#price').value = state.maxPrice;
  for (const el of $('#cats').children) {
    el.setAttribute('aria-current', String(el.dataset.slug === state.category));
  }
}

async function boot() {
  readUrl();
  countPage();

  const facets = await api.facets().catch(() => null);
  if (facets) {
    $('#stat-products').textContent = facets.total;
    $('#stat-cats').textContent = facets.categories.length;
    const nav = $('#cats');
    const mk = (slug, name) => {
      const b = document.createElement('button');
      b.textContent = name;
      b.dataset.slug = slug;
      b.setAttribute('aria-current', String(state.category === slug));
      b.addEventListener('click', filtered(() => {
        state.category = slug;
        for (const el of nav.children) el.setAttribute('aria-current', String(el.dataset.slug === slug));
      }));
      return b;
    };
    nav.appendChild(mk('', 'All'));
    for (const c of facets.categories) nav.appendChild(mk(c.slug, c.name));

    /*
     * Price bands from the catalogue's own range rather than a fixed list, so
     * the options are always ones that return something. Round numbers people
     * think in — nobody shops "under ₹1,347".
     */
    const top = Math.ceil((facets.priceBounds?.max ?? 0) / 100);
    const bands = [500, 1000, 2000, 5000, 10000].filter((b) => b < top);
    const sel = $('#price');
    if (sel && bands.length) {
      for (const b of bands) {
        const o = document.createElement('option');
        o.value = String(b);
        o.textContent = `Under ₹${b.toLocaleString('en-IN')}`;
        sel.appendChild(o);
      }
      sel.value = state.maxPrice;
      sel.addEventListener('change', filtered((e) => { state.maxPrice = e.target.value; }));
    } else if (sel) {
      sel.hidden = true;
    }
  }

  let t;
  $('#search').addEventListener('input', (e) => {
    const value = e.target.value;
    clearTimeout(t);
    t = setTimeout(filtered(() => { state.search = value; }), 220);
  });
  $('#sort').addEventListener('change', filtered((e) => { state.sort = e.target.value; }));
  $('#checkout').addEventListener('click', () => { location.href = '/checkout.html'; });

  $('#pager').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-page]');
    if (!b) return;
    state.page = Number(b.dataset.page);
    writeUrl();
    load();
  });

  // Back and Forward move through pages and filters, not off the storefront.
  addEventListener('popstate', () => { readUrl(); syncControls(); load({ keepScroll: true }); });

  syncControls();
  await load({ keepScroll: true });
  cart.render();
}

boot();
