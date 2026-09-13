/**
 * The shopkeeper's page.
 *
 * Everything here comes from /api/admin/*, which is closed unless ADMIN_TOKEN
 * is set and refuses without a bearer token. This file holds the token and
 * nothing else — there is no state worth keeping, so every tab re-reads.
 *
 * Order data contains names, phone numbers and addresses that a customer typed.
 * It is escaped on the way into the DOM in every single place, without
 * exception: this is the one page on the site that renders text written by
 * someone else.
 */
const $ = (s) => document.querySelector(s);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const inr = (paise) => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const pct = (n) => (n ? `${n}%` : '<span class="dash">—</span>');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ auth -- */

const KEY = 'oxj.admin.token';
/*
 * sessionStorage by default so closing the tab signs you out; localStorage
 * only if you ask for it. A token in localStorage on a phone that gets lost is
 * a real exposure, and the fix for that is rotating ADMIN_TOKEN.
 */
let token = sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || '';

function signOut() {
  token = '';
  sessionStorage.removeItem(KEY);
  localStorage.removeItem(KEY);
  $('#app').hidden = true;
  $('#signin').hidden = false;
  $('#token').value = '';
}

async function get(path) {
  const res = await fetch(`/api/admin${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { signOut(); throw new Error('Signed out — the token was not accepted.'); }
  if (res.status === 404) throw new Error('The admin API is switched off. Set ADMIN_TOKEN and restart.');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

async function patch(path, body) {
  const res = await fetch(`/api/admin${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

/* --------------------------------------------------------------- overview -- */

function tiles(s) {
  const devices = Object.entries(s.devices).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`).join(', ');
  return `<div class="tiles">
    <div class="tile"><span class="n">${s.visits}</span><span class="k">Visits</span>
      ${devices ? `<span class="sub">${esc(devices)}</span>` : ''}</div>
    <div class="tile"><span class="n">${s.orders.count}</span><span class="k">Orders</span>
      ${s.orders.pending ? `<span class="sub warn">${plural(s.orders.pending, 'awaiting', 'awaiting')} confirmation</span>` : ''}</div>
    <div class="tile"><span class="n">${inr(s.orders.booked)}</span><span class="k">Booked</span>
      ${s.orders.count ? `<span class="sub">${inr(s.orders.average)} average</span>` : ''}</div>
    <div class="tile"><span class="n">${s.catalogue.live}</span><span class="k">Live pieces</span>
      ${s.reviewsPending ? `<span class="sub warn">${plural(s.reviewsPending, 'review', 'reviews')} to approve</span>` : ''}
      ${s.catalogue.drafts ? `<span class="sub">${plural(s.catalogue.drafts, 'draft', 'drafts')}</span>` : ''}</div>
  </div>`;
}

/**
 * A bar a day. Deliberately not a library: it is one number over time, and the
 * only thing it has to show is the shape — which days were busy and which had
 * an order. Height is relative to the busiest day in the window.
 */
function chart(daily) {
  const peak = Math.max(1, ...daily.map((d) => d.views));
  return `<div class="chart">${daily.map((d) => {
    const h = Math.round((d.views / peak) * 100);
    const title = `${d.date}: ${plural(d.views, 'view', 'views')}, ${plural(d.visits, 'visit', 'visits')}`
      + (d.orders ? `, ${plural(d.orders, 'order', 'orders')}` : '');
    return `<div style="height:${Math.max(h, 2)}%" data-had-order="${d.orders ? 1 : 0}" title="${esc(title)}"></div>`;
  }).join('')}</div>`;
}

function attention(s) {
  const notes = [];
  if (s.catalogue.soldOut.length) {
    notes.push(['Sold out', `${plural(s.catalogue.soldOut.length, 'piece is', 'pieces are')} live with no stock in any colourway.`, s.catalogue.soldOut]);
  }
  if (s.catalogue.low.length) {
    notes.push(['Nearly gone', 'Five or fewer left across every colourway.',
      s.catalogue.low.map((p) => `${p.slug} (${p.stock})`)]);
  }
  if (s.catalogue.unseen.length) {
    notes.push(['Nobody opened these',
      'Not selling badly — not being seen. A different problem, and more traffic is the fix, not a lower price.',
      s.catalogue.unseen]);
  }
  if (s.emptySearches.length) {
    notes.push(['Searched for, not stocked', 'People typed these and got nothing back.',
      s.emptySearches.map((x) => `${x.q} (${x.count})`)]);
  }
  if (!notes.length) return '<p class="muted">Nothing needs attention in this window.</p>';
  return `<div class="notes">${notes.map(([title, why, items]) => `
    <div class="note"><b>${esc(title)}</b>${esc(why)}
      <div class="slugs">${items.slice(0, 14).map(esc).join(', ')}${items.length > 14 ? ', …' : ''}</div>
    </div>`).join('')}</div>`;
}

function simpleTable(head, rows, empty) {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<div class="tw"><table class="grid2"><thead><tr>${
    head.map((h, i) => `<th${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')
  }</tr></thead><tbody>${rows.map((cells) => `<tr>${
    cells.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')
  }</tr>`).join('')}</tbody></table></div>`;
}

async function overview(days) {
  const s = await get(`/summary?days=${days}`);
  $('#tab-overview').innerHTML = `
    <h2>${esc(s.from)} to ${esc(s.to)}</h2>
    ${tiles(s)}
    <h2>Page views a day</h2>
    ${chart(s.daily)}
    <h2>Needs attention</h2>
    ${attention(s)}
    <h2>Where visits came from</h2>
    ${simpleTable(['Source', 'Visits'],
      [...s.campaigns.map((c) => [`${esc(c.utm)} <span class="pill">utm</span>`, c.visits]),
       ...s.referrers.map((r) => [esc(r.host), r.visits])],
      'No referrers yet — every visit so far was typed or bookmarked.')}
    <h2>Pages</h2>
    ${simpleTable(['Path', 'Views', 'Entered here'],
      s.pages.map((p) => [esc(p.path), p.views, p.entries]), 'No page views recorded yet.')}
    <h2>Searched for</h2>
    ${simpleTable(['Term', 'Times', 'Found nothing'],
      s.searches.map((x) => [esc(x.q), x.count, x.empty ? `<span class="warn">${x.empty}</span>` : '<span class="dash">—</span>']),
      'Nobody has used site search yet.')}`;
}

/* ----------------------------------------------------------------- pieces -- */

let pieceSort = { key: 'views', dir: -1 };

/*
 * The table this page exists for. Funnel, price, stock and margin on one row,
 * because each of those alone leads to the wrong decision: a piece with a good
 * add rate and no stock, or a piece selling well at a margin that does not
 * cover the returns, both look fine in any report that shows one column.
 */
const COLUMNS = [
  /*
   * The disclosure used to be the thumbnail itself, with no marker on it. It
   * worked and nobody could find it — a control with no affordance is a control
   * that does not exist. So: a chevron that turns, the title as a button, and
   * the whole row clickable.
   */
  ['piece', 'Piece', (p) => `<div class="piece">
      <span class="chev" aria-hidden="true">›</span>
      ${p.image ? `<img src="/images/${esc(p.image)}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
      <div>
        <button class="expand" data-slug="${esc(p.slug)}" aria-expanded="false">${esc(p.title)}</button>
        <small>${esc(p.category)}${p.status !== 'active' ? ` · ${esc(p.status)}` : ''} · ${
          p.variantCount === 1 ? '1 variant' : `${p.variantCount} variants`} ·
          <a href="/product.html?slug=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">on the shop ↗</a></small>
      </div>
    </div>`],
  ['priceFrom', 'Price', (p) => inr(p.priceFrom)],
  ['marginPct', 'Margin', (p) => (p.marginPct === null
    ? '<span class="dash" title="No cost recorded — npm run price">not costed</span>'
    : `<span class="${p.marginPct < 20 ? 'bad' : p.marginPct < 35 ? 'warn' : ''}">${p.marginPct}%</span>`)],
  ['stock', 'Stock', (p) => (p.stock === 0
    ? '<span class="bad">0</span>'
    : `<span class="${p.stock <= 5 ? 'warn' : ''}">${p.stock}</span>`)],
  ['views', 'Views', (p) => p.views || '<span class="dash">0</span>'],
  ['colourClicks', 'Colour', (p) => p.colourClicks || '<span class="dash">0</span>'],
  ['adds', 'Adds', (p) => p.adds || '<span class="dash">0</span>'],
  ['addRate', 'Add %', (p) => pct(p.addRate)],
  ['orders', 'Orders', (p) => p.orders || '<span class="dash">0</span>'],
  ['revenue', 'Earned', (p) => (p.revenue ? inr(p.revenue) : '<span class="dash">—</span>')],
];

/**
 * The reorder panel under a piece: your SKU beside the supplier's, and the
 * listing it came from.
 *
 * This is the only screen in the project where any of it appears. The
 * storefront has no word for where a piece came from, and `data/sourcing.json`
 * is gitignored and read by no public route — that separation is deliberate
 * and this page does not weaken it, it is just the one side of the wall where
 * you are allowed to look.
 */
/**
 * The whole cost of one piece, in the order the money actually moves.
 *
 * A single "cost" number hides the thing that matters: on a ₹234 piece, the
 * freight, duty and clearance add more than the piece itself, and the returns
 * provision costs more than the delivery. Showing only what the supplier
 * charges is how an import business talks itself into a price that loses money.
 *
 * Every figure is per piece, at the order quantity it was costed against.
 */
function costStack(v, rates) {
  const c = v.pricing;
  if (!c) {
    return `<div class="stack none">No cost recorded for this colourway.
      <span class="muted">Put the supplier's price in data/sourcing.json and run
      <span class="mono">npm run price</span>.</span></div>`;
  }

  const line = (label, amount, note = '', cls = '') =>
    `<div class="${cls}"><span>${label}${note ? ` <i>${note}</i>` : ''}</span><span>${inr(amount)}</span></div>`;
  const rule = (label, amount) =>
    `<div class="sum"><span>${label}</span><span>${inr(amount)}</span></div>`;

  const perKg = `₹${Math.round(rates.freightPerKg / 100)}/kg`;

  return `<div class="stack">
    <div class="col">
      <h5>Getting it here</h5>
      ${line('What the supplier charges', c.purchase)}
      ${line('Freight to India', c.shippingIn, `${c.weightGrams} g at ${perKg}`)}
      ${line('Insurance', c.insurance, `${rates.insurancePctOfFob}%`)}
      ${rule('Customs value (CIF)', c.customsValue)}
      ${line('Basic customs duty', c.duty, `${rates.basicCustomsDutyPct}%`)}
      ${line('Social welfare surcharge', c.surcharge, `${rates.socialWelfareSurchargePct}% of duty`)}
      ${line('Clearance', c.clearance, `share of one shipment`)}
      ${rule('Landed — in your hands', c.landed)}
      ${line('IGST at the border', c.igstCredit,
        rates.igstCreditable ? 'creditable — funded, not spent' : 'not creditable', 'credit')}
    </div>
    <div class="col">
      <h5>Getting it to the customer</h5>
      ${line('Delivery and packaging', c.deliveryOut)}
      ${line('Returns provision', c.returns, `${rates.returnRatePct}% come back`)}
      ${rule('Cost to serve', c.costToServe)}
      <h5>What the sale does</h5>
      ${line('Price on the page', c.final, 'GST included', 'price')}
      ${line('GST you collect and remit', -c.gst, `${rates.outputGstPct}%`)}
      ${line('Payment gateway', -c.gateway, `${rates.paymentGatewayPct}%`)}
      ${c.commission ? line('Marketplace commission', -c.commission) : ''}
      ${line('Cost to serve', -c.costToServe)}
      <div class="sum margin"><span>Margin <i>share of the price ex-GST, not of cost</i></span>
        <span>${inr(c.margin)} · ${c.marginPct}%</span></div>
    </div>
    <p class="muted note">Per piece, costed at an order of ${c.orderQty}${
      c.manualOverride ? ' · price set by hand, not by the model' : ''} ·
      computed ${new Date(c.computedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.
      Rates come from <span class="mono">data/costs.json</span> and are assumptions you own.</p>
  </div>`;
}

/**
 * The discount control.
 *
 * There is no box for "was" price, and there cannot be: the struck-through
 * figure on the storefront is the list price already in the catalogue. Typing a
 * higher one to make the saving look bigger is a misleading price
 * representation under the Consumer Protection Act 2019, so the only way to
 * fund a discount here is out of margin — which is why the margin after it is
 * shown before you commit, and again in red if it goes under the floor.
 */
function discountControl(p, rates) {
  const d = p.discount;
  const state = !d ? ''
    : p.discountLive
      ? `<span class="pill paid">live${d.endsAt ? ` until ${esc(d.endsAt)}` : ''}</span>`
      : `<span class="pill">scheduled${d.startsAt ? ` from ${esc(d.startsAt)}` : ''}</span>`;

  return `<form class="discount" data-slug="${esc(p.slug)}">
    <h5>Discount ${state}</h5>
    <div class="fields">
      <label>% off<input type="number" name="pct" min="1" max="90" step="1"
        value="${d?.pct ?? ''}" placeholder="e.g. 15"></label>
      <label>Reason shown to buyers<input type="text" name="label" maxlength="40"
        value="${esc(d?.label ?? '')}" placeholder="Launch week"></label>
      <label>Ends<input type="date" name="endsAt" value="${esc(d?.endsAt?.slice(0, 10) ?? '')}"></label>
      <button class="btn small" type="submit">${d ? 'Update' : 'Start sale'}</button>
      ${d ? '<button class="btn ghost small" type="button" data-clear>End it</button>' : ''}
    </div>
    <p class="effect muted">Margin now ${
      p.marginPct === null ? 'unknown — this piece has no recorded cost' : `${p.marginPct}%`
    }. Floor is ${rates.floorMarginPct}%; a discount comes out of that, not out of a raised price.</p>
  </form>`;
}

function reorderPanel(p, rates) {
  const dash = '<span class="dash">—</span>';
  return `<div class="reorder">
    <div class="piece-admin">
      ${discountControl(p, rates)}
      <form class="listing" data-slug="${esc(p.slug)}">
        <h5>Listing</h5>
        <div class="fields">
          <label>On the storefront<select name="status">
            ${['active', 'draft', 'archived'].map((st) =>
              `<option value="${st}"${p.status === st ? ' selected' : ''}>${st}</option>`).join('')}
          </select></label>
          <button class="btn small" type="submit">Save</button>
          <span class="muted" data-listing-note></span>
        </div>
        <p class="muted" style="font-size:12px;margin:0">Draft and archived both take the page down —
        its URL returns 404 and it leaves the grid. Nothing is deleted.</p>
      </form>
    </div>
    <div class="source">
      ${p.sourceUrl
        ? `<a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">Original listing ↗</a>`
        : '<span class="dash">No source link recorded</span>'}
      ${p.supplier ? `<span class="muted">${esc(p.supplier)}</span>` : ''}
      ${p.moq ? `<span class="muted">MOQ ${esc(p.moq)}</span>` : ''}
    </div>
    <div class="tw"><table class="grid2 sub"><thead><tr>
      <th>Colourway</th><th>Our SKU</th><th>Their SKU</th><th>Their ref</th>
      <th class="n">Cost</th><th class="n">Price</th><th class="n">Margin</th><th class="n">Stock</th>
      <th></th>
    </tr></thead><tbody>${p.variants.map((v) => `<tr>
      <td>${esc(v.label)}</td>
      <td class="sku">${esc(v.sku)}</td>
      <td class="sku their">${v.supplierSku ? esc(v.supplierSku) : dash}</td>
      <td class="sku their">${v.supplierSkuId ? esc(v.supplierSkuId) : dash}</td>
      <td class="n">${v.cost === null ? dash : inr(v.cost)}</td>
      <td class="n">
        ${v.discountLive ? `<s class="dash" title="list price">${inr(v.price)}</s> ` : ''}
        <input class="cell rupees" type="number" min="1" step="1" value="${Math.round(v.price / 100)}"
          data-edit="price" data-slug="${esc(p.slug)}" data-sku="${esc(v.sku)}"
          aria-label="Price for ${esc(v.label)}">
        ${v.discountLive ? `<small class="dash">sells at ${inr(v.salePrice)}</small>` : ''}
      </td>
      <td class="n">${v.marginPct === null ? dash
        : v.discountLive
          ? `<span class="${v.saleMarginPct < 0 ? 'bad' : v.saleMarginPct < 25 ? 'warn' : ''}">${v.saleMarginPct}%</span>`
          : `${v.marginPct}%`}</td>
      <td class="n"><input class="cell" type="number" min="0" step="1" value="${v.stock}"
        data-edit="stock" data-slug="${esc(p.slug)}" data-sku="${esc(v.sku)}"
        aria-label="Stock for ${esc(v.label)}"></td>
      <td class="n"><button class="cost-toggle" data-slug="${esc(p.slug)}" data-sku="${esc(v.sku)}"
        aria-expanded="false" title="Full cost of this colourway">cost&nbsp;↓</button></td>
    </tr>`).join('')}</tbody></table></div>
    <!--
      The stack lives here rather than in a row of the table above, because that
      table scrolls sideways on a narrow screen: inside it, the labels showed
      and every figure sat off the right edge. One host per piece, filled with
      whichever colourway was asked for.
    -->
    <div class="stack-host" data-host="${esc(p.slug)}" hidden></div>
    <p class="muted">Click a SKU to select the whole thing — these are what you quote when you reorder.</p>
  </div>`;
}

async function pieces(days) {
  const { pieces: rows, rates } = await get(`/pieces?days=${days}`);
  const sorted = [...rows].sort((a, b) => {
    const k = pieceSort.key;
    if (k === 'piece') return a.title.localeCompare(b.title) * pieceSort.dir * -1;
    // "Not costed" sorts to the bottom either way rather than reading as zero.
    const av = a[k] ?? -1;
    const bv = b[k] ?? -1;
    return (av - bv) * pieceSort.dir;
  });

  $('#tab-pieces').innerHTML = `
    <h2>${plural(rows.length, 'piece', 'pieces')} · last ${days} days</h2>
    <p class="hint">Click any row for its SKUs, the original listing, and what each colourway costs
    to land and to sell.</p>
    <div class="tw"><table class="grid2"><thead><tr>${
      COLUMNS.map(([key, label], i) => `<th data-sort="${key}"${i ? ' class="n"' : ''}${
        pieceSort.key === key ? ` aria-sort="${pieceSort.dir < 0 ? 'descending' : 'ascending'}"` : ''
      }>${esc(label)}</th>`).join('')
    }</tr></thead><tbody>${
      sorted.map((p) => `<tr data-row="${esc(p.slug)}">${COLUMNS.map(([, , cell], i) =>
        `<td${i ? ' class="n"' : ''}>${cell(p)}</td>`).join('')}</tr>
        <tr class="detail" data-detail="${esc(p.slug)}" hidden>
          <td colspan="${COLUMNS.length}">${reorderPanel(p, rates)}</td>
        </tr>`).join('')
    }</tbody></table></div>
    <p class="muted" style="font-size:12.5px;margin-top:10px">Margin is the lowest across a piece's
    colourways, not the average — a set is only as good as the one people actually pick.</p>`;

  for (const form of document.querySelectorAll('#tab-pieces form.discount')) {
    const say = (html, cls = 'muted') => {
      const el = form.querySelector('.effect');
      el.className = `effect ${cls}`;
      el.innerHTML = html;
    };

    const send = async (body) => {
      say('saving…');
      try {
        const r = await patch(`/pieces/${encodeURIComponent(form.dataset.slug)}/discount`, body);
        if (!r.discount) { say('No discount. The list price is what people pay.'); }
        else {
          const worst = Math.min(...r.effect.map((e) => e.marginPct).filter((m) => m !== null));
          const shown = Number.isFinite(worst) ? `${Math.round(worst * 10) / 10}%` : 'unknown';
          /*
           * Below the floor is a warning, not a block. A loss-leader is
           * sometimes deliberate — what is never fine is not knowing.
           */
          say(r.belowFloor
            ? `<b>Margin falls to ${shown}</b> — under the ${r.floorMarginPct}% floor.
               ${worst < 0 ? 'You would lose money on every one sold.' : 'Deliberate, or a typo?'}`
            : `Saved. ${r.live ? 'Live now' : 'Scheduled'} — margin ${shown}.`,
            r.belowFloor ? 'warn' : 'good');
        }
        // Re-read so the table beside it shows the same numbers as the message.
        setTimeout(() => pieces(days), 1400);
      } catch (e) {
        say(esc(e.message), 'bad');
      }
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const pct = Number(f.get('pct'));
      if (!pct) { say('Enter a percentage, or use “End it”.', 'warn'); return; }
      send({
        pct,
        label: String(f.get('label') || '').trim() || undefined,
        endsAt: String(f.get('endsAt') || '') || undefined,
      });
    });

    form.querySelector('[data-clear]')?.addEventListener('click', () => send({ clear: true }));
  }

  /*
   * Stock and price save on blur rather than behind a Save button. This is the
   * screen you are on with a courier on the phone, and a button you have to
   * find after typing is a button that gets missed.
   */
  for (const input of document.querySelectorAll('#tab-pieces input[data-edit]')) {
    let last = input.value;
    const save = async () => {
      if (input.value === last) return;
      const raw = Number(input.value);
      if (!Number.isFinite(raw)) { input.value = last; return; }
      const field = input.dataset.edit;
      const value = field === 'price' ? Math.round(raw * 100) : Math.trunc(raw);
      input.classList.remove('saved', 'failed');
      try {
        await patch(
          `/pieces/${encodeURIComponent(input.dataset.slug)}/variants/${encodeURIComponent(input.dataset.sku)}`,
          { [field]: value },
        );
        last = input.value;
        input.classList.add('saved');
        setTimeout(() => input.classList.remove('saved'), 1400);
      } catch (e) {
        input.classList.add('failed');
        input.title = e.message;
        input.value = last;
      }
    };
    input.addEventListener('blur', save);
    // Enter saves and stays put, so a run of edits is a run of keystrokes.
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  }

  for (const form of document.querySelectorAll('#tab-pieces form.listing')) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = form.querySelector('[data-listing-note]');
      note.textContent = 'saving…';
      try {
        const r = await patch(`/pieces/${encodeURIComponent(form.dataset.slug)}`,
          { status: new FormData(form).get('status') });
        note.textContent = r.status === 'active' ? 'live on the storefront' : `${r.status} — page is down`;
        setTimeout(() => pieces(days), 1200);
      } catch (err) {
        note.textContent = err.message;
      }
    });
  }

  const bySlug = new Map(rows.map((p) => [p.slug, p]));
  for (const b of document.querySelectorAll('#tab-pieces .cost-toggle')) {
    b.addEventListener('click', () => {
      const host = document.querySelector(`[data-host="${CSS.escape(b.dataset.slug)}"]`);
      const same = host.dataset.showing === b.dataset.sku && !host.hidden;

      // One open at a time per piece: two stacks side by side is two columns of
      // numbers with nothing telling you which belongs to which colourway.
      for (const other of document.querySelectorAll(`.cost-toggle[data-slug="${CSS.escape(b.dataset.slug)}"]`)) {
        other.setAttribute('aria-expanded', 'false');
        other.innerHTML = 'cost&nbsp;↓';
      }

      if (same) { host.hidden = true; host.innerHTML = ''; return; }

      const piece = bySlug.get(b.dataset.slug);
      const variant = piece.variants.find((v) => v.sku === b.dataset.sku);
      host.innerHTML = `<div class="stack-head">${esc(variant.label)}
        <span class="sku">${esc(variant.sku)}</span></div>${costStack(variant, rates)}`;
      host.dataset.showing = b.dataset.sku;
      host.hidden = false;
      b.setAttribute('aria-expanded', 'true');
      b.innerHTML = 'cost&nbsp;↑';
    });
  }

  const toggle = (slug) => {
    const row = document.querySelector(`[data-detail="${CSS.escape(slug)}"]`);
    const button = document.querySelector(`.expand[data-slug="${CSS.escape(slug)}"]`);
    const open = !row.hidden;
    row.hidden = open;
    button.setAttribute('aria-expanded', String(!open));
    button.closest('tr').classList.toggle('open', !open);
  };

  // The whole row is the target, so there is nothing small to aim at on a
  // phone — except the link out to the shop, which has its own job.
  for (const tr of document.querySelectorAll('#tab-pieces tr[data-row]')) {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      toggle(tr.dataset.row);
    });
  }

  for (const th of document.querySelectorAll('#tab-pieces th[data-sort]')) {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      pieceSort = { key, dir: pieceSort.key === key ? -pieceSort.dir : -1 };
      pieces(days);
    });
  }
}

/* ----------------------------------------------------------------- orders -- */

const STATUSES = ['pending', 'paid', 'shipped', 'cancelled'];

/** A packing slip. Opened in its own window so printing it does not print the
 *  whole dashboard, and laid out for an A5 label pouch. */
function packingSlip(o) {
  const w = window.open('', '_blank', 'width=620,height=800');
  if (!w) return;
  const money = (p) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>${esc(o.reference)}</title><style>
      body { font: 13px/1.55 system-ui, sans-serif; margin: 26px; color: #1a1a1a; }
      h1 { font-size: 17px; margin: 0 0 2px; }
      .ref { font: 600 15px ui-monospace, monospace; }
      .to { border: 1px solid #333; padding: 14px; margin: 18px 0; font-size: 15px; line-height: 1.6; }
      .to b { font-size: 17px; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      td, th { text-align: left; padding: 6px 4px; border-bottom: 1px solid #ddd; font-size: 12.5px; }
      th { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #666; }
      .r { text-align: right; }
      .note { margin-top: 18px; font-size: 11.5px; color: #555; }
      @media print { body { margin: 10mm; } .noprint { display: none; } }
    </style></head><body>
    <h1>Moteeka</h1>
    <div class="ref">${esc(o.reference)}</div>
    <div style="font-size:12px;color:#555">Placed ${new Date(o.createdAt).toLocaleDateString('en-IN',
      { day: 'numeric', month: 'long', year: 'numeric' })} · ${esc(o.status)}</div>
    <div class="to">
      <b>${esc(o.customer.name)}</b><br>
      ${[o.address.line1, o.address.line2, o.address.city, o.address.state]
        .filter(Boolean).map(esc).join('<br>')}<br>
      <b>${esc(o.address.pincode)}</b><br>
      ${esc(o.customer.phone)}
    </div>
    <table><thead><tr><th>Item</th><th>SKU</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
    <tbody>${o.lines.map((l) => `<tr>
      <td>${esc(l.title)} — ${esc(l.variantLabel)}</td>
      <td style="font-family:ui-monospace,monospace;font-size:11px">${esc(l.sku)}</td>
      <td class="r">${l.quantity}</td><td class="r">${money(l.unitPrice * l.quantity)}</td></tr>`).join('')}
      <tr><td colspan="3" class="r">Shipping</td><td class="r">${o.shipping === 0 ? 'Free' : money(o.shipping)}</td></tr>
      <tr><td colspan="3" class="r">GST</td><td class="r">${money(o.tax)}</td></tr>
      <tr><td colspan="3" class="r"><b>Total</b></td><td class="r"><b>${money(o.total)}</b></td></tr>
    </tbody></table>
    <p class="note">Payment is arranged by phone before dispatch — do not collect on delivery
    unless the order says otherwise.</p>
    <p class="noprint"><button onclick="print()">Print</button></p>
  </body></html>`);
  w.document.close();
}

let orderFilter = { status: '', q: '' };

async function orders() {
  const data = await get('/orders');
  if (!data.orders.length) {
    $('#tab-orders').innerHTML = '<h2>Orders</h2><p class="muted">No orders yet.</p>';
    return;
  }

  const counts = STATUSES.filter((s) => data.counts[s])
    .map((s) => `<span class="pill ${s}">${data.counts[s]} ${esc(s)}</span>`).join(' ');

  /*
   * Filtering happens here rather than on the server: the list is already in
   * hand, and a search that answers as you type beats one that waits for a
   * round trip. Matches a reference, a name, a phone or a PIN code — the four
   * things you have when somebody rings up about an order.
   */
  const q = orderFilter.q.trim().toLowerCase();
  const shown = data.orders.filter((o) => {
    if (orderFilter.status && o.status !== orderFilter.status) return false;
    if (!q) return true;
    return [o.reference, o.customer.name, o.customer.phone, o.customer.email, o.address.pincode]
      .some((v) => String(v).toLowerCase().includes(q));
  });

  $('#tab-orders').innerHTML = `
    <h2>${plural(data.total, 'order', 'orders')} ${counts}
      ${data.orders.some((o) => !o.announced)
        ? `<span class="pill pending">${data.orders.filter((o) => !o.announced).length} not announced</span>` : ''}</h2>
    <div class="order-bar">
      <input type="search" id="order-q" value="${esc(orderFilter.q)}"
        placeholder="Reference, name, phone or PIN" aria-label="Search orders">
      <select id="order-status" aria-label="Filter by status">
        <option value="">All statuses</option>
        ${STATUSES.map((s) => `<option value="${s}"${orderFilter.status === s ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
      <a class="btn ghost small" id="csv" href="#">Export CSV</a>
      <span class="muted">${shown.length === data.orders.length
        ? '' : `${shown.length} of ${data.orders.length} shown`}</span>
    </div>
    <div class="tw">${shown.map((o) => `
      <details class="order">
        <summary>
          <span class="ref">${esc(o.reference)}</span>
          <span class="pill ${esc(o.status)}">${esc(o.status)}</span>
          <span class="muted">${esc(o.customer.name)} · ${new Date(o.createdAt).toLocaleDateString('en-IN',
            { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          ${o.announced ? '' : '<span class="pill pending" title="No notification was delivered for this order">unannounced</span>'}
          <span class="amt">${inr(o.total)}</span>
        </summary>
        <div class="body">
          <div>
            <h4>Customer</h4>
            <p>${esc(o.customer.name)}<br>
              <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a><br>
              <a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a></p>
          </div>
          <div>
            <h4>Deliver to</h4>
            <p>${[o.address.line1, o.address.line2, o.address.city, o.address.state, o.address.pincode]
              .filter(Boolean).map(esc).join('<br>')}</p>
          </div>
          <div class="lines">
            <h4>Ordered</h4>
            ${o.lines.map((l) => `<div><span>${esc(l.title)} — ${esc(l.variantLabel)} × ${l.quantity}</span>
              <span>${inr(l.unitPrice * l.quantity)}</span></div>`).join('')}
            <div><span>Shipping</span><span>${o.shipping === 0 ? 'Free' : inr(o.shipping)}</span></div>
            <div><span>GST (${Math.round(o.taxRate * 100)}%)</span><span>${inr(o.tax)}</span></div>
            <div><b>Total</b><b>${inr(o.total)}</b></div>
          </div>
          <div class="status-row">
            <button class="btn ghost small" type="button" data-slip="${esc(o.reference)}">Packing slip</button>
            <a class="btn ghost small" href="/order.html?ref=${encodeURIComponent(o.reference)}"
              target="_blank" rel="noopener" style="text-decoration:none">What the customer sees</a>
            <label for="st-${esc(o.reference)}">Status</label>
            <select id="st-${esc(o.reference)}" data-ref="${esc(o.reference)}">
              ${STATUSES.map((s) => `<option value="${s}"${s === o.status ? ' selected' : ''}>${s}</option>`).join('')}
            </select>
            <span class="muted" data-saved="${esc(o.reference)}"></span>
          </div>
        </div>
      </details>`).join('')}</div>
    <p class="muted" style="font-size:12.5px;margin-top:10px">Cancelling does not put stock back —
    do that with <span class="mono">npm run edit</span> when the piece is physically returned.</p>`;

  const byRef = new Map(data.orders.map((o) => [o.reference, o]));
  for (const b of document.querySelectorAll('#tab-orders [data-slip]')) {
    b.addEventListener('click', () => packingSlip(byRef.get(b.dataset.slip)));
  }

  let t;
  $('#order-q')?.addEventListener('input', (e) => {
    clearTimeout(t);
    const v = e.target.value;
    t = setTimeout(() => { orderFilter.q = v; orders(); }, 200);
  });
  $('#order-status')?.addEventListener('change', (e) => {
    orderFilter.status = e.target.value;
    orders();
  });

  /*
   * The export is behind the same bearer token as everything else, so it cannot
   * be a plain link — the browser would send no Authorization header. Fetched,
   * then handed to the browser as a blob.
   */
  $('#csv')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/admin/orders.csv', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  for (const sel of document.querySelectorAll('#tab-orders select[data-ref]')) {
    sel.addEventListener('change', async () => {
      const note = document.querySelector(`[data-saved="${CSS.escape(sel.dataset.ref)}"]`);
      const pill = sel.closest('.order').querySelector('summary .pill');
      note.textContent = 'saving…';
      try {
        const updated = await patch(`/orders/${encodeURIComponent(sel.dataset.ref)}`, { status: sel.value });
        pill.className = `pill ${updated.status}`;
        pill.textContent = updated.status;
        note.textContent = 'saved';
        setTimeout(() => { note.textContent = ''; }, 2000);
      } catch (e) {
        note.textContent = e.message;
      }
    });
  }
}

/* -------------------------------------------------------------- reviews -- */

const STARS = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

/**
 * Nothing a customer wrote reaches the storefront until it is approved here.
 *
 * The order reference sits next to each one because that is the check: the
 * server already proved the order exists and contains the piece, and this is
 * where you decide whether the words are worth publishing.
 */
async function reviewsTab() {
  const data = await get('/reviews');
  const pending = data.counts.pending ?? 0;

  if (!data.reviews.length) {
    $('#tab-reviews').innerHTML = `<h2>Reviews</h2>
      <p class="muted">Nothing yet. A review can only be left against a real order that contains
      the piece, so these start arriving after people have bought and received something.</p>`;
    return;
  }

  $('#tab-reviews').innerHTML = `
    <h2>${plural(data.reviews.length, 'review', 'reviews')}
      ${pending ? `<span class="pill pending">${pending} waiting on you</span>` : ''}</h2>
    <div class="tw">${data.reviews.map((r) => `
      <div class="rv ${esc(r.status)}">
        <div class="rv-head">
          <span class="rv-stars">${STARS(r.rating)}</span>
          <a href="/product.html?slug=${encodeURIComponent(r.slug)}" target="_blank" rel="noopener">${esc(r.slug)}</a>
          <span class="pill ${esc(r.status)}">${esc(r.status)}</span>
          <span class="muted">${esc(r.name)} · order <span class="mono">${esc(r.reference)}</span> ·
            ${new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
        ${r.title ? `<b>${esc(r.title)}</b>` : ''}
        ${r.body ? `<p>${esc(r.body)}</p>` : ''}
        <div class="rv-act">
          ${r.status !== 'published' ? `<button class="btn small" data-rv="${esc(r.id)}" data-to="published">Publish</button>` : ''}
          ${r.status !== 'rejected' ? `<button class="btn ghost small" data-rv="${esc(r.id)}" data-to="rejected">Reject</button>` : ''}
          ${r.status !== 'pending' ? `<button class="btn ghost small" data-rv="${esc(r.id)}" data-to="pending">Back to pending</button>` : ''}
          <span class="muted" data-rv-note="${esc(r.id)}"></span>
        </div>
      </div>`).join('')}</div>
    <p class="muted" style="font-size:12.5px;margin-top:12px">Publishing puts the stars and the
    words on the product page. Rejecting keeps the record — it is never deleted, because a review
    you removed is a thing you may have to account for.</p>`;

  for (const b of document.querySelectorAll('#tab-reviews button[data-rv]')) {
    b.addEventListener('click', async () => {
      const note = document.querySelector(`[data-rv-note="${CSS.escape(b.dataset.rv)}"]`);
      note.textContent = 'saving…';
      try {
        await patch(`/reviews/${encodeURIComponent(b.dataset.rv)}`, { status: b.dataset.to });
        await reviewsTab();
      } catch (e) {
        note.textContent = e.message;
      }
    });
  }
}

/* ------------------------------------------------------------------ shell -- */

let tab = 'overview';

async function render() {
  const days = Number($('#range').value);
  $('#error').hidden = true;
  for (const id of ['overview', 'pieces', 'orders', 'reviews']) $(`#tab-${id}`).hidden = id !== tab;
  try {
    if (tab === 'overview') await overview(days);
    if (tab === 'pieces') await pieces(days);
    if (tab === 'orders') await orders();
    if (tab === 'reviews') await reviewsTab();
  } catch (e) {
    $('#error').textContent = e.message;
    $('#error').hidden = false;
  }
}

async function start() {
  const me = await get('/me');
  $('#driver').textContent = `${me.driver}${me.analytics ? '' : ' · analytics off'}`;
  $('#signin').hidden = true;
  $('#app').hidden = false;
  await render();
}

$('#signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  token = $('#token').value.trim();
  const where = $('#remember').checked ? localStorage : sessionStorage;
  try {
    await get('/me');
    where.setItem(KEY, token);
    await start();
  } catch (err) {
    $('#signin-error').textContent = err.message;
    token = '';
  }
});

$('#signout').addEventListener('click', signOut);
$('#range').addEventListener('change', render);
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  for (const el of $('#tabs').children) el.setAttribute('aria-current', String(el === b));
  render();
});

/**
 * Is there an admin API at all?
 *
 * With no ADMIN_TOKEN set the server answers 404 on every admin route, and a
 * sign-in form could never succeed — so ask first, and show the one-line fix
 * instead of a door that does not open. A 401 is the good answer here: it
 * means the API exists and is asking who you are.
 */
async function apiIsOn() {
  const res = await fetch('/api/admin/me').catch(() => null);
  return Boolean(res && res.status !== 404);
}

async function boot() {
  if (!(await apiIsOn())) {
    $('#setup').hidden = false;
    return;
  }
  /*
   * A saved token is checked before anything is drawn, so a stale one shows the
   * sign-in form rather than an empty dashboard full of error messages. Only an
   * authentication failure signs you out — `render()` handles its own errors, so
   * a server that is merely down leaves you signed in and says so.
   */
  if (token) {
    start().catch((e) => {
      signOut();
      $('#signin-error').textContent = e.message;
    });
  } else {
    $('#signin').hidden = false;
  }
}

$('#setup-retry').addEventListener('click', () => location.reload());
$('#copy-cmd').addEventListener('click', async (e) => {
  try {
    await navigator.clipboard.writeText($('#setup-cmd').textContent);
    e.target.textContent = 'Copied';
    setTimeout(() => { e.target.textContent = 'Copy'; }, 1600);
  } catch {
    // No clipboard permission — the command is on screen to select by hand.
    e.target.textContent = 'Select it above';
  }
});

boot();
