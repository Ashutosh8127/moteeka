import { join } from 'node:path';
import { ROOT } from '../config.ts';
import { JsonStore } from './json-store.ts';
import type { Paise } from '../types.ts';

/**
 * What a piece actually costs you, and what it has to sell for.
 *
 * The supplier's price is the smallest part of it. Between their quote and
 * your bank there is freight from China, customs duty, a clearance fee, a
 * courier to the customer, a share of the parcels that come back, the payment
 * gateway's cut, and GST. "Supplier cost × 6" gets the right order of
 * magnitude by luck and the wrong answer for any specific piece — a ₹100
 * earring and a ₹400 bangle do not carry the same freight or the same return
 * risk per rupee.
 *
 * Two distinctions this model insists on, because they are where the money
 * hides:
 *
 *   IGST on import is NOT a cost if you are GST-registered. You pay it at the
 *   border and credit it against the GST you collect. It is working capital
 *   locked up for a month or two, and it belongs in a cash-flow line, not in
 *   the cost you price against. Basic customs duty and the surcharge on it are
 *   real costs — there is no credit for either.
 *
 *   Margin is a share of revenue, not a multiple of cost. A 45% margin means
 *   45 paise of every rupee you keep after GST. A "6x markup" says nothing
 *   about what survives the gateway fee and the returns.
 */

export interface ImportCosts {
  basicCustomsDutyPct: number;
  socialWelfareSurchargePct: number;
  igstPct: number;
  igstCreditable: boolean;
  insurancePctOfFob: number;
  clearanceFeePerShipment: Paise;
  freightPerKg: Paise;
  defaultWeightGrams: number;
}
export interface FulfilmentCosts {
  domesticShippingPerOrder: Paise;
  packagingPerOrder: Paise;
  paymentGatewayPct: number;
  marketplaceCommissionPct: number;
}
export interface ReturnCosts {
  ratePct: number;
  reverseShippingPerReturn: Paise;
  handlingPerReturn: Paise;
  unsellablePctOfReturns: number;
}
export interface PricingRules {
  targetMarginPct: number;
  /** The margin below which a discount is flagged — see the admin page. */
  floorMarginPct: number;
  outputGstPct: number;
  roundTo: number;
  roundEnding: number;
}
export interface Costs {
  import: ImportCosts;
  fulfilment: FulfilmentCosts;
  returns: ReturnCosts;
  pricing: PricingRules;
}

const store = new JsonStore<Costs>(join(ROOT, 'data', 'costs.json'), () => {
  throw new Error('data/costs.json is missing');
});

export const costs = (): Costs => store.read();

export interface LandedInput {
  /** Supplier's unit price, in paise, at the quantity you are ordering. */
  supplierPaise: Paise;
  /** Units in the shipment — the clearance fee is per shipment, not per piece. */
  orderQty: number;
  /** Shipped weight of one piece. Falls back to the configured default. */
  weightGrams?: number;
}

export interface LandedCost {
  fob: Paise;
  freight: Paise;
  insurance: Paise;
  /** Cost, insurance and freight — what customs assesses duty on. */
  cif: Paise;
  basicDuty: Paise;
  surcharge: Paise;
  clearance: Paise;
  /** Everything above: the real cost of getting one piece into your hands. */
  landed: Paise;
  /** Paid at the border and credited back later. Cash flow, not cost. */
  igstOnImport: Paise;
  igstIsCreditable: boolean;
  /** Landed cost plus the IGST you actually have to fund up front. */
  cashOutlay: Paise;
}

/** What one piece costs to get from the supplier's dock into your stock. */
export function landedCost(input: LandedInput, c: Costs = costs()): LandedCost {
  const im = c.import;
  const grams = input.weightGrams ?? im.defaultWeightGrams;
  const qty = Math.max(1, input.orderQty);

  const fob = Math.round(input.supplierPaise);
  const freight = Math.round((grams / 1000) * im.freightPerKg);
  const insurance = Math.round((fob * im.insurancePctOfFob) / 100);
  const cif = fob + freight + insurance;

  const basicDuty = Math.round((cif * im.basicCustomsDutyPct) / 100);
  const surcharge = Math.round((basicDuty * im.socialWelfareSurchargePct) / 100);
  const igstOnImport = Math.round(((cif + basicDuty + surcharge) * im.igstPct) / 100);
  const clearance = Math.round(im.clearanceFeePerShipment / qty);

  const landed = cif + basicDuty + surcharge + clearance;
  return {
    fob, freight, insurance, cif, basicDuty, surcharge, clearance, landed,
    igstOnImport,
    igstIsCreditable: im.igstCreditable,
    cashOutlay: landed + (im.igstCreditable ? igstOnImport : 0),
  };
}

export interface SaleCost {
  /** Shipping and packaging for every parcel that goes out. */
  fulfilment: Paise;
  /**
   * What returns add to every order that sticks. At an 18% return rate you
   * ship 100 parcels to keep 82, and the 18 that come back cost you the
   * forward leg, the reverse leg, handling, and whatever cannot be resold.
   */
  returnsProvision: Paise;
}

export function saleCost(landed: Paise, c: Costs = costs()): SaleCost {
  const f = c.fulfilment;
  const r = c.returns;
  const outbound = f.domesticShippingPerOrder + f.packagingPerOrder;
  const rate = Math.min(Math.max(r.ratePct, 0), 95) / 100;
  const perReturn = f.domesticShippingPerOrder + r.reverseShippingPerReturn + r.handlingPerReturn
    + Math.round((landed * r.unsellablePctOfReturns) / 100);

  // Costs are spread over the orders that survive, not over the ones you sent.
  const kept = 1 - rate;
  return {
    fulfilment: outbound,
    returnsProvision: Math.round((rate * perReturn) / kept),
  };
}

export interface PriceBreakdown {
  landed: LandedCost;
  sale: SaleCost;
  /** Everything that has to be covered before a rupee of margin. */
  costToServe: Paise;
  /** What the customer pays, GST included. */
  price: Paise;
  priceBeforeRounding: Paise;
  /** Of that price: the GST you collect and remit. */
  outputGst: Paise;
  gatewayFee: Paise;
  commission: Paise;
  /** Revenue net of GST. */
  netRevenue: Paise;
  profit: Paise;
  marginPct: number;
  /** How many times the supplier's price you are charging, for comparison. */
  multipleOfSupplier: number;
  /** GST you owe after crediting the IGST paid at the border. */
  netGstPayable: Paise;
}

/**
 * The price that leaves `targetMarginPct` of net revenue as profit.
 *
 * Solved rather than guessed. Gateway and marketplace fees are charged on the
 * gross the customer pays, GST is a share of it, and margin is a share of what
 * is left — so the price appears on both sides and has to be rearranged:
 *
 *   P · [ (1 − m) / (1 + gst) − (g + c) ] = costToServe
 */
export function priceFor(input: LandedInput, c: Costs = costs()): PriceBreakdown {
  const landed = landedCost(input, c);
  const sale = saleCost(landed.landed, c);
  const costToServe = landed.landed + sale.fulfilment + sale.returnsProvision;

  const p = c.pricing;
  const f = c.fulfilment;
  const gst = p.outputGstPct / 100;
  const m = p.targetMarginPct / 100;
  const fees = (f.paymentGatewayPct + f.marketplaceCommissionPct) / 100;

  const denominator = (1 - m) / (1 + gst) - fees;
  if (denominator <= 0) {
    throw new Error(
      `a ${p.targetMarginPct}% margin is impossible once GST (${p.outputGstPct}%) and `
      + `fees (${(fees * 100).toFixed(2)}%) are taken out — no price satisfies it`);
  }

  const raw = costToServe / denominator;
  const price = roundPrice(raw, p);

  const netRevenue = Math.round(price / (1 + gst));
  const outputGst = price - netRevenue;
  const gatewayFee = Math.round((price * f.paymentGatewayPct) / 100);
  const commission = Math.round((price * f.marketplaceCommissionPct) / 100);
  const profit = netRevenue - costToServe - gatewayFee - commission;

  return {
    landed, sale, costToServe, price, priceBeforeRounding: Math.round(raw),
    outputGst, gatewayFee, commission, netRevenue, profit,
    marginPct: netRevenue === 0 ? 0 : (profit / netRevenue) * 100,
    multipleOfSupplier: landed.fob === 0 ? 0 : price / landed.fob,
    netGstPayable: outputGst - (landed.igstIsCreditable ? landed.igstOnImport : 0),
  };
}

/** Lands a price on a ₹__9 ending without ever rounding below cost. */
export function roundPrice(paise: number, p: PricingRules): Paise {
  const rupees = paise / 100;
  const step = Math.max(1, p.roundTo);
  const up = Math.ceil(rupees / step) * step - (step - p.roundEnding);
  return Math.round((up < rupees ? up + step : up) * 100);
}

/**
 * The breakdown in the shape it is stored in, following the money in order:
 * purchase, getting it here, getting it to the customer, returns, margin,
 * final price. See `VariantPricing` in sourcing.ts.
 */
export function pricingRecord(
  b: PriceBreakdown,
  input: LandedInput,
  c: Costs = costs(),
): Record<string, unknown> {
  return {
    computedAt: new Date().toISOString(),
    orderQty: input.orderQty,
    weightGrams: input.weightGrams ?? c.import.defaultWeightGrams,

    purchase: b.landed.fob,
    shippingIn: b.landed.freight,
    insurance: b.landed.insurance,
    customsValue: b.landed.cif,
    duty: b.landed.basicDuty,
    surcharge: b.landed.surcharge,
    clearance: b.landed.clearance,
    landed: b.landed.landed,
    igstCredit: b.landed.igstIsCreditable ? b.landed.igstOnImport : 0,

    deliveryOut: b.sale.fulfilment,
    returns: b.sale.returnsProvision,
    costToServe: b.costToServe,

    gst: b.outputGst,
    gateway: b.gatewayFee,
    commission: b.commission,
    margin: b.profit,
    marginPct: Number(b.marginPct.toFixed(1)),

    final: b.price,
  };
}

/**
 * What a price on the page actually earns, as opposed to what it should be.
 * Used to report a variant someone priced by hand.
 */
export function marginAt(price: Paise, costToServe: Paise, c: Costs = costs()): {
  netRevenue: Paise; gst: Paise; fees: Paise; profit: Paise; marginPct: number;
} {
  const gstPct = c.pricing.outputGstPct / 100;
  const netRevenue = Math.round(price / (1 + gstPct));
  const gst = price - netRevenue;
  const fees = Math.round((price * (c.fulfilment.paymentGatewayPct + c.fulfilment.marketplaceCommissionPct)) / 100);
  const profit = netRevenue - costToServe - fees;
  return { netRevenue, gst, fees, profit, marginPct: netRevenue === 0 ? 0 : (profit / netRevenue) * 100 };
}
