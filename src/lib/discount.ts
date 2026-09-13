import type { Paise, Product, Variant } from '../types.ts';

/**
 * Discounts, and the one thing that makes them legal.
 *
 * A discount is a reduction **from a price the piece genuinely sells at**. The
 * struck-through figure a customer sees is the list price in the catalogue —
 * the price that was being charged the day before the sale started and will be
 * charged again when it ends. It is never a number invented to make the
 * discount look bigger.
 *
 * That is not a style preference. Inflating a reference price to manufacture a
 * saving is a misleading price representation under the Consumer Protection
 * Act 2019, and where a piece carries a printed MRP, overstating it breaches
 * the Legal Metrology (Packaged Commodities) Rules. The CCPA's 2023 dark
 * patterns guidelines name the practice directly. So this module cannot
 * express a fake reference price: `compareAt` is *derived* from the stored
 * list price and cannot be typed in.
 *
 * The honest way to fund a discount is the boring one — decide the margin you
 * can live with, and let the model tell you what discount that buys. See
 * `marginAfter()` and the floor in data/costs.json.
 */
export interface Discount {
  /** Percentage off the list price. One of `pct` or `amountPaise`. */
  pct?: number;
  /** A flat amount off, in paise. */
  amountPaise?: Paise;
  /** Shown on the product page: "Diwali", "Launch week". */
  label?: string;
  /** ISO dates. A sale with an end date stops on its own. */
  startsAt?: string;
  endsAt?: string;
}

/** Is this discount running right now? */
export function isLive(d: Discount | undefined, at: Date = new Date()): boolean {
  if (!d) return false;
  if (!d.pct && !d.amountPaise) return false;
  const t = at.getTime();
  if (d.startsAt && t < Date.parse(d.startsAt)) return false;
  // An end date is the end of that day, not midnight at the start of it —
  // "ends 30 September" means the 30th is a sale day.
  if (d.endsAt && t > Date.parse(d.endsAt) + 86_400_000 - 1) return false;
  return true;
}

/**
 * A discount can never take a price below zero, and never *raise* one — a
 * negative percentage is a typo, not a surcharge.
 *
 * Rounded **down** to the whole rupee. Down, because a price rounded up is a
 * smaller reduction than the one advertised, and "20% off" has to mean at
 * least 20% off. Whole rupees rather than the list price's ...9 ending: on a
 * ₹1,219 piece, 20% off is ₹975.20, and dropping to ₹969 to keep the nine
 * costs ₹6 a unit for a cosmetic convention, at a moment when margin is
 * already the thing under pressure.
 */
export function priceAfter(list: Paise, d: Discount): Paise {
  const off = d.pct ? Math.round((list * d.pct) / 100) : (d.amountPaise ?? 0);
  const reduced = Math.max(0, Math.min(list, list - Math.max(0, off)));
  return Math.floor(reduced / 100) * 100;
}

/**
 * The catalogue price is the list price, always. This returns the product as a
 * customer should see it during a sale: `price` reduced, `compareAt` set to the
 * list price it is reduced *from*.
 *
 * Applied at the API boundary rather than written into the product, so ending a
 * sale is deleting a field and nothing has to be un-done. Both the catalogue
 * route and the cart quote call this, which is what keeps the price on the page
 * and the price you are charged the same number.
 */
export function withDiscount(p: Product, at: Date = new Date()): Product {
  if (!isLive(p.discount, at)) return p;
  const d = p.discount!;
  return {
    ...p,
    variants: p.variants.map((v): Variant => {
      /*
       * Idempotent on purpose. Two routes apply this — the catalogue and the
       * cart quote — and the day one is composed with the other, a second pass
       * over an already-reduced price would take 15% off 15% off and nobody
       * would notice until the month's takings were short. A variant already
       * carrying the exact result of this discount is left alone.
       */
      if (v.compareAt !== undefined && priceAfter(v.compareAt, d) === v.price) return v;
      const price = priceAfter(v.price, d);
      if (price >= v.price) return v;
      return { ...v, price, compareAt: v.price };
    }),
  };
}

/** A short line for the product page: "20% off", "₹200 off". */
export function discountLabel(d: Discount): string {
  const amount = d.pct ? `${d.pct}% off` : `₹${Math.round((d.amountPaise ?? 0) / 100)} off`;
  return d.label ? `${d.label} · ${amount}` : amount;
}
