/**
 * The catalogue's shape.
 *
 * Money is stored in paise as an integer — a ₹1,299 price is 129900. Prices
 * that live as floats drift the moment you apply a discount and sum a cart.
 */
export type Paise = number;

import type { Discount } from './lib/discount.ts';
export type { Discount };

export interface ImageRef {
  /** Path under /images, e.g. "jhumka-ethnic-retro/01.jpg". */
  path: string;
  alt: string;
  /**
   * Widths that exist beside `path` as "01-400.webp", "01-800.webp" and so on,
   * for the storefront's srcset. Absent means only the original was written —
   * the page still renders, it just sends the full-size file.
   */
  widths?: number[];
}

export interface Variant {
  sku: string;
  /** What actually differs — "Silver / 2.5 in", "Gold tone / small". */
  label: string;
  /**
   * Path under /images to a small photograph of this colourway, shown as a
   * swatch on the product page. A named colour tells a buyer far less than a
   * picture of the piece in that colour.
   */
  swatch?: string;
  price: Paise;
  /** Struck-through reference price, when there is a genuine one. */
  compareAt?: Paise;
  stock: number;
  weightGrams?: number;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  /** Category slug — see categories.json. */
  category: string;
  /** Short line for cards; the long copy lives in `description`. */
  tagline: string;
  description: string;
  material: string;
  finish: string;
  /** Free-text attributes buyers filter and ask about. */
  details: Record<string, string>;
  images: ImageRef[];
  variants: Variant[];
  tags: string[];
  featured: boolean;
  status: 'draft' | 'active' | 'archived';
  /**
   * A running or scheduled price reduction. The variant prices above stay the
   * list price — the discount is applied at the API boundary — so ending a sale
   * is deleting this field and nothing has to be put back. See src/lib/discount.ts.
   */
  discount?: Discount;
  /**
   * Sourcing — where a piece came from and who supplies it — deliberately does
   * NOT live on the product. It sits in data/sourcing.json, which is private
   * and never served, so the public API cannot leak it.
   */
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
}

export interface OrderLine {
  sku: string;
  productId: string;
  title: string;
  variantLabel: string;
  unitPrice: Paise;
  quantity: number;
  /** First catalogue image, so a cart line can show a thumbnail. */
  image?: string;
  /** Widths available beside `image`, so a cart thumbnail need not be full size. */
  imageWidths?: number[];
  /**
   * Stock remaining when the cart was quoted. Present on a quote so the
   * quantity stepper knows its ceiling; an order records what was bought, not
   * what was left, so it is absent there.
   */
  stock?: number;
  /**
   * The product's slug. Present on a quote, so the page can count a checkout
   * against the piece; absent on an order, where `productId` is the stable
   * reference and a slug is only what the piece was called that week.
   */
  slug?: string;
}

export interface Order {
  id: string;
  reference: string;
  lines: OrderLine[];
  subtotal: Paise;
  shipping: Paise;
  /** GST on jewellery is 3% for articles of precious metal; imitation is 18%. */
  taxRate: number;
  tax: Paise;
  total: Paise;
  customer: { name: string; email: string; phone: string };
  address: { line1: string; line2?: string; city: string; state: string; pincode: string };
  status: 'pending' | 'paid' | 'shipped' | 'cancelled';
  createdAt: string;
}

export interface ListQuery {
  category?: string;
  tag?: string;
  search?: string;
  minPrice?: Paise;
  maxPrice?: Paise;
  sort?: 'newest' | 'price-asc' | 'price-desc' | 'name';
  page?: number;
  perPage?: number;
  includeDrafts?: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

/**
 * Who is selling. Required on the site, not optional branding: the Consumer
 * Protection (E-Commerce) Rules 2020 make a seller publish its legal name,
 * address, customer-care contact and a named grievance officer, and Meta will
 * not run ads to a destination with no privacy policy.
 *
 * Kept in data/business.json so the legal pages, and later the invoices, read
 * the same values from one place.
 */
export interface Business {
  tradingName: string;
  legalName: string;
  address: string;
  email: string;
  phone: string;
  hours?: string;
  gstin?: string;
  /**
   * How long a customer waits. Published because the Consumer Protection
   * (E-Commerce) Rules 2020 require a delivery timeline, and because a
   * timeline someone discovers after ordering is where a dispute starts.
   */
  deliveryMinDays?: number;
  deliveryMaxDays?: number;
  grievanceOfficer: { name: string; designation: string; email: string; phone?: string };
  policyUpdated: string;
}
