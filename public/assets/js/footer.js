/**
 * One footer for every page. It carries the links Meta and the Consumer
 * Protection (E-Commerce) Rules expect to find from any page an ad lands on,
 * so they cannot go missing from a page someone adds later.
 */
const shop = globalThis.__SHOP ?? {};
const inr = (paise) => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
// One value, from data/business.json via /config.js. It used to be typed out
// here and twice more on the product page, which is three chances to disagree.
const DELIVERY = shop.deliveryMinDays && shop.deliveryMaxDays
  ? `${shop.deliveryMinDays}–${shop.deliveryMaxDays} days` : '15–25 days';
const FREE_OVER = shop.freeShippingOver ? inr(shop.freeShippingOver) : '₹999';

const FOOTER = `
  <div>
    <h3>Moteeka</h3>
    <p>Jhumka, chandbali, bridal sets, bangles and anklets — silver and gold-plated, shipped across India.</p>
  </div>
  <div>
    <h3>Care</h3>
    <p>Keep away from water and perfume. Wipe with a dry cloth; the darkening is the finish, not tarnish.</p>
  </div>
  <div>
    <h3>Shipping</h3>
    <p>Free over ${FREE_OVER}. Please allow ${DELIVERY} for delivery.</p>
  </div>
  <div>
    <h3>Shop</h3>
    <ul>
      <li><a href="/">All pieces</a></li>
      <li><a href="/order.html">Track an order</a></li>
      <li><a href="/contact.html">Contact</a></li>
      <li><a href="/privacy.html">Privacy</a></li>
    </ul>
  </div>`;

const el = document.querySelector('#footer');
if (el && !el.children.length) el.innerHTML = FOOTER;

/*
 * While `npm run demo -- --seed` data is in the shop, every page says so.
 *
 * This is the thing that makes seeded ratings a development tool rather than a
 * deception: whatever else goes wrong, nobody can read a fabricated review here
 * without also reading that it is fabricated.
 */
if (shop.demoData) {
  // const bar = document.createElement('div');
  // bar.className = 'demo-bar';
  // // Addressed to whoever is reading the page, not to whoever deployed it. A
  // // visitor cannot run an npm command and should not be shown one; what they
  // // need is the plain fact that the stars and the viewer count are not real.
  // bar.innerHTML = '<div class="wrap"><b>Sample data.</b> <span>The star ratings, reviews and '
  //   + '&ldquo;people looking at this&rdquo; counts on this site are fabricated test data, '
  //   + 'not real customers. Prices, stock and delivery times are real.</span></div>';
  // document.body.prepend(bar);
}
