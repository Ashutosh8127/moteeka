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
