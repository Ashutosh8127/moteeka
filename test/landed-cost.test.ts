import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landedCost, saleCost, priceFor, roundPrice, pricingRecord, marginAt, type Costs } from '../src/lib/landed-cost.ts';

/** Round numbers, so the arithmetic can be checked by hand. */
const C: Costs = {
  import: {
    basicCustomsDutyPct: 20, socialWelfareSurchargePct: 10, igstPct: 18,
    igstCreditable: true, insurancePctOfFob: 0,
    clearanceFeePerShipment: 500000, freightPerKg: 50000, defaultWeightGrams: 100,
  },
  fulfilment: {
    domesticShippingPerOrder: 8000, packagingPerOrder: 2000,
    paymentGatewayPct: 2, marketplaceCommissionPct: 0,
  },
  returns: {
    ratePct: 20, reverseShippingPerReturn: 8000, handlingPerReturn: 2000,
    unsellablePctOfReturns: 0,
  },
  pricing: { targetMarginPct: 40, floorMarginPct: 25, outputGstPct: 18, roundTo: 10, roundEnding: 9 },
};

test('duty is charged on cost, insurance and freight — not on the supplier price', () => {
  // ₹100 FOB + 100 g at ₹500/kg = ₹50 freight → CIF ₹150.
  const l = landedCost({ supplierPaise: 10000, orderQty: 100 }, C);
  assert.equal(l.freight, 5000);
  assert.equal(l.cif, 15000);
  assert.equal(l.basicDuty, 3000, '20% of ₹150');
  assert.equal(l.surcharge, 300, '10% of the duty, not of the CIF');
});

test('the clearance fee is per shipment, so a bigger order dilutes it', () => {
  const small = landedCost({ supplierPaise: 10000, orderQty: 10 }, C);
  const large = landedCost({ supplierPaise: 10000, orderQty: 500 }, C);
  assert.equal(small.clearance, 50000, '₹5000 over 10 pieces');
  assert.equal(large.clearance, 1000, '₹5000 over 500 pieces');
  assert.ok(large.landed < small.landed);
});

test('creditable IGST is funded but is not a cost', () => {
  const l = landedCost({ supplierPaise: 10000, orderQty: 100 }, C);
  assert.equal(l.igstOnImport, Math.round((15000 + 3000 + 300) * 0.18));
  // The distinction the whole model turns on.
  assert.equal(l.landed, l.cif + l.basicDuty + l.surcharge + l.clearance);
  assert.ok(!String(l.landed).includes('NaN'));
  assert.equal(l.cashOutlay, l.landed + l.igstOnImport);

  const notRegistered = landedCost({ supplierPaise: 10000, orderQty: 100 },
    { ...C, import: { ...C.import, igstCreditable: false } });
  assert.equal(notRegistered.cashOutlay, notRegistered.landed,
    'with no credit the IGST is already inside the landed cost line');
});

test('returns are spread over the orders that stick, not the ones you ship', () => {
  const s = saleCost(20000, C);
  // 20% back: ship 100, keep 80. Each return costs forward ₹80 + reverse ₹80
  // + handling ₹20 = ₹180, so 20 × ₹180 spread over 80 kept = ₹45.
  assert.equal(s.returnsProvision, 4500);
  assert.equal(s.fulfilment, 10000);
});

test('a higher return rate costs more than proportionally', () => {
  const at10 = saleCost(20000, { ...C, returns: { ...C.returns, ratePct: 10 } }).returnsProvision;
  const at20 = saleCost(20000, C).returnsProvision;
  assert.ok(at20 > at10 * 2, 'doubling the rate more than doubles the cost');
});

test('the price actually delivers the margin it promises', () => {
  const b = priceFor({ supplierPaise: 10000, orderQty: 100 }, C);
  // Rounding to a ₹__9 ending can only push margin up, never below target.
  assert.ok(b.marginPct >= C.pricing.targetMarginPct - 0.01,
    `asked for ${C.pricing.targetMarginPct}%, got ${b.marginPct.toFixed(2)}%`);
  assert.ok(b.marginPct < C.pricing.targetMarginPct + 3, 'and not wildly above it');

  // The identity the whole thing rests on.
  assert.equal(b.netRevenue + b.outputGst, b.price);
  assert.equal(b.profit, b.netRevenue - b.costToServe - b.gatewayFee - b.commission);
});

test('fixed per-order costs dominate a cheap piece, which a markup misses', () => {
  const cheap = priceFor({ supplierPaise: 5000, orderQty: 50 }, C);
  const dear = priceFor({ supplierPaise: 40000, orderQty: 50 }, C);
  // A flat multiple would price the cheap one at 6x = ₹300 and lose money.
  assert.ok(cheap.multipleOfSupplier > dear.multipleOfSupplier * 1.5,
    `cheap ${cheap.multipleOfSupplier.toFixed(1)}x vs dear ${dear.multipleOfSupplier.toFixed(1)}x`);
  assert.ok(cheap.price > 5000 * 6, 'a 6x markup would not cover the cost to serve');
});

test('an unreachable margin is refused rather than silently missed', () => {
  assert.throws(() => priceFor({ supplierPaise: 10000, orderQty: 100 },
    { ...C, pricing: { ...C.pricing, targetMarginPct: 99 } }), /impossible/);
});

test('rounding never lands below the price it was given', () => {
  const p = C.pricing;
  for (const paise of [10000, 10001, 10900, 10901, 11000, 45678, 99]) {
    assert.ok(roundPrice(paise, p) >= paise, `${paise} rounded down`);
    assert.equal(roundPrice(paise, p) % 1000, 900, 'should end in 9');
  }
});

test('the stored record follows the money and adds up', () => {
  const input = { supplierPaise: 10000, orderQty: 100 };
  const rec = pricingRecord(priceFor(input, C), input, C) as Record<string, number>;
  const r = (k: string) => rec[k] ?? 0;

  // Purchase → getting it here → getting it to the customer → returns → margin.
  assert.equal(r('customsValue'), r('purchase') + r('shippingIn') + r('insurance'));
  assert.equal(r('landed'), r('customsValue') + r('duty') + r('surcharge') + r('clearance'));
  assert.equal(r('costToServe'), r('landed') + r('deliveryOut') + r('returns'));
  assert.equal(r('final'), r('costToServe') + r('gst') + r('gateway') + r('commission') + r('margin'),
    'the price is exactly what it is made of');
  assert.equal(r('orderQty'), 100);
});

test('a price set by hand is measured, not assumed', () => {
  const input = { supplierPaise: 10000, orderQty: 100 };
  const b = priceFor(input, C);
  // Sell it for ₹100 less than the model wants and the margin must fall.
  const at = marginAt(b.price - 10000, b.costToServe, C);
  assert.ok(at.marginPct < b.marginPct, 'a lower price cannot earn the same margin');
  assert.equal(at.netRevenue + at.gst, b.price - 10000);
});

test('selling below the cost to serve reports a negative margin', () => {
  const b = priceFor({ supplierPaise: 10000, orderQty: 100 }, C);
  const at = marginAt(Math.round(b.costToServe / 2), b.costToServe, C);
  assert.ok(at.profit < 0 && at.marginPct < 0, 'a loss must read as a loss');
});
