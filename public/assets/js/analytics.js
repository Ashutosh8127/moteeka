/**
 * Two separate things, on purpose.
 *
 * `track()` is ad measurement — the Meta Pixel, off unless META_PIXEL_ID is
 * set, which means no third-party script, no request and no cookie on a site
 * that is not running ads.
 *
 * `count()` is your own analytics: which pages get opened, which pieces get
 * looked at, which get added to a cart. It posts to this site and nowhere
 * else, it sets no cookie, and it sends nothing that identifies anybody — no
 * id that survives the tab, no screen fingerprint, no click path. The server
 * turns each event into `+1` on a counter and keeps no record of the event.
 *
 * Both are mirrored to the console under ?debug=analytics, because the usual
 * way this goes wrong is silently: the pixel fires on PageView, you assume the
 * rest works, and three weeks of spend later there is no AddToCart data.
 */
const cfg = globalThis.__SHOP ?? {};
const debug = new URLSearchParams(location.search).get('debug') === 'analytics';

function boot(id) {
  /* eslint-disable */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', id);
}

if (cfg.pixelId) boot(cfg.pixelId);

/**
 * `name` is a standard Meta event (ViewContent, AddToCart, InitiateCheckout)
 * or one of ours. Standard ones go through `track`, ours through
 * `trackCustom` — sending a custom name to `track` is silently dropped.
 */
const STANDARD = new Set([
  'PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase', 'Search', 'Lead',
]);

export function track(name, params = {}) {
  if (debug) console.log('[analytics]', name, params);
  // Both tags hang off this one call, so adding the second did not mean
  // editing twenty call sites — or missing one of them.
  sendGa(name, params);
  if (!cfg.pixelId || !window.fbq) return;
  window.fbq(STANDARD.has(name) ? 'track' : 'trackCustom', name, params);
}

/** Meta expects value in major units, so paise become rupees here and only here. */
export const rupees = (paise) => Number((paise / 100).toFixed(2));

export const isOn = () => Boolean(cfg.pixelId);

/* ------------------------------------------------------- our own counters -- */

/**
 * Respect the browser's own answer before asking anything else. Global Privacy
 * Control is a legal signal in some places and a clear preference everywhere;
 * Do Not Track is older and weaker but costs nothing to honour.
 */
const optedOut = navigator.globalPrivacyControl === true
  || navigator.doNotTrack === '1' || window.doNotTrack === '1';

const on = cfg.analytics !== false && !optedOut;

/* ------------------------------------------ Firebase Analytics (GA4) -- */

/**
 * Firebase Analytics, which on the web is Google Analytics 4 under a different
 * name. Off unless FIREBASE_WEB_CONFIG is set on the server, so a shop that
 * has not turned it on loads no SDK and sets no Google cookie.
 *
 * It honours Global Privacy Control and Do Not Track, which the Meta Pixel
 * above does not. That is inconsistent and deliberately so: this one was added
 * knowing the signal exists, and a browser saying "do not track me" is not
 * something to read past because the other tag does.
 *
 * Loaded lazily, on the first event rather than on boot. The two modules are
 * about 45 kB and nothing on the page waits for them — a storefront should not
 * spend a phone's first connection on measurement.
 */
const fb = cfg.firebase ?? null;
let firebasePending = null;

function firebaseAnalytics() {
  if (!fb?.measurementId || optedOut) return null;
  firebasePending ??= (async () => {
    const base = 'https://www.gstatic.com/firebasejs/11.0.2';
    const [{ initializeApp }, analytics] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-analytics.js`),
    ]);
    // isSupported() is false in a private window and in some in-app browsers;
    // calling getAnalytics() there throws rather than returning null.
    if (!(await analytics.isSupported())) return null;
    return { a: analytics.getAnalytics(initializeApp(fb)), log: analytics.logEvent };
  })().catch((e) => {
    if (debug) console.warn('[ga] did not load', e);
    return null;
  });
  return firebasePending;
}

/*
 * A page view on every page, which otherwise would not happen.
 *
 * The Meta Pixel gets one free from fbq('init'); Firebase logs page_view when
 * getAnalytics() is created, and nothing creates it until the first track()
 * call — which on the home page, the contact page and the checkout never
 * comes. Analytics that records product views and no sessions is worse than
 * none, because the numbers look real.
 *
 * Deferred to after load, and then a beat longer. A measurement tag has no
 * business competing with the first photograph for a phone's connection.
 */
if (fb?.measurementId && !optedOut) {
  const begin = () => setTimeout(() => { firebaseAnalytics(); }, 1200);
  if (document.readyState === 'complete') begin();
  else addEventListener('load', begin, { once: true });
}

/** Meta's event names on the left, the GA4 recommended ones on the right. */
const GA_NAME = {
  PageView: 'page_view',
  ViewContent: 'view_item',
  AddToCart: 'add_to_cart',
  InitiateCheckout: 'begin_checkout',
  Search: 'search',
  Lead: 'generate_lead',
  Purchase: 'purchase',
};

/**
 * Meta wants `content_ids` and `contents`; GA4 wants `items` with `item_id`.
 * Same events, different shapes — translated here so no call site has to know
 * that two tags are listening.
 */
function gaParams(p) {
  const out = {};
  const contents = Array.isArray(p.contents) ? p.contents : null;
  const ids = Array.isArray(p.content_ids) ? p.content_ids : null;
  const items = contents
    ? contents.map((c) => ({ item_id: c.id, quantity: c.quantity ?? 1, item_name: p.content_name }))
    : ids?.map((id) => ({ item_id: id, quantity: 1, item_name: p.content_name }));
  if (items?.length) out.items = items;
  if (typeof p.value === 'number') out.value = p.value;
  if (p.currency) out.currency = p.currency;
  if (p.search_string) out.search_term = p.search_string;
  if (p.reference) out.transaction_id = p.reference;
  return out;
}

function sendGa(name, params) {
  const pending = firebaseAnalytics();
  if (!pending) return;
  // GA4 names must be snake_case; anything not mapped is sent under its own
  // name so a custom event still arrives rather than being silently dropped.
  const event = GA_NAME[name] ?? name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  void pending.then((f) => { if (f) f.log(f.a, event, gaParams(params)); });
}



/**
 * A visit, not a person. This id never leaves the browser — it is not sent
 * anywhere and never stored on disk. It exists so a reload is not counted as
 * a second visitor, and `sessionStorage` means it dies with the tab.
 */
function firstOfVisit() {
  try {
    if (sessionStorage.getItem('oxj.visit')) return false;
    sessionStorage.setItem('oxj.visit', '1');
    return true;
  } catch {
    // Private window, or storage blocked. Counting it as a new visit each time
    // overstates visitors slightly, which beats failing to count at all.
    return true;
  }
}

/** Host only. A full referrer URL can carry someone's search terms in it. */
function referrerHost() {
  try {
    const host = new URL(document.referrer).host;
    return host && host !== location.host ? host.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

function campaign() {
  const q = new URLSearchParams(location.search);
  const source = q.get('utm_source');
  if (!source) return '';
  return [source, q.get('utm_campaign')].filter(Boolean).join(' / ').slice(0, 80);
}

/** Three buckets. Not a screen size, which is half of a fingerprint. */
const device = () => (innerWidth < 700 ? 'phone' : innerWidth < 1100 ? 'tablet' : 'desktop');

let queue = [];
let timer = null;

function flush() {
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue });
  queue = [];
  clearTimeout(timer);
  timer = null;
  try {
    /*
     * sendBeacon hands the request to the browser and returns: it survives the
     * page being closed, and it cannot hold up a navigation. The fetch is the
     * fallback for browsers without it, with keepalive for the same reason.
     */
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/events', {
        method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' },
      }).catch(() => {});
    }
  } catch {
    // Analytics failing is never a reason for a page to misbehave.
  }
}

/**
 * `t` is one of page, product, variant, add, checkout, search. Anything else
 * is dropped by the server.
 */
export function count(t, fields = {}) {
  if (debug) console.log('[count]', t, fields);
  if (!on) return;
  const first = t === 'page' ? firstOfVisit() : false;
  queue.push({
    t,
    ...fields,
    ...(first ? { first: true, ref: referrerHost(), utm: campaign(), device: device() } : {}),
  });
  // Batched so a product page's view and variant clicks go in one request.
  if (queue.length >= 10) flush();
  else if (!timer) timer = setTimeout(flush, 1200);
}

if (on) {
  // Whatever is still queued when the tab goes away. `visibilitychange` is the
  // one that actually fires on a phone; `pagehide` covers the rest.
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
}

/** Every page calls this once. The path is ours, so it is sent as-is. */
export function countPage(extra = {}) {
  count('page', { path: location.pathname === '/' ? '/' : location.pathname, ...extra });
}

export const counting = () => on;
