/*
 * Paste this into your browser's console on a supplier product page.
 * It saves the listing's own data payload as a JSON file you can then run
 * through `npm run onboard -- ./captured/<id>.json`.
 *
 * Why this and not a downloader: the supplier site shows a slider verification to
 * anything that looks automated. You are a real visitor with a real session,
 * so the data is right there in the page — this just writes it out.
 *
 * It keeps only the fields the importer reads, which turns a 150 kB page
 * payload into about 6 kB: the title, the price ladder, the attributes, the
 * SKU axes and their swatch images, and the gallery.
 *
 * Chrome: F12 → Console → paste → Enter. Allow the download if prompted.
 */
(() => {
  const d = window.detailData;
  if (!d || !d.globalData || !d.globalData.product) {
    console.warn('No product payload on this page — is it a product listing, and did the slider clear?');
    return;
  }
  const g = d.globalData, p = g.product, s = g.seller || {}, pr = p.price || {}, sk = p.sku || {};
  const props = (k) => (p[k] || []).map((a) => ({ attrName: a.attrName, attrValue: a.attrValue }));

  const trimmed = { globalData: {
    seller: {
      companyName: s.companyName,
      companyRegisterCountry: s.companyRegisterCountry,
      companyJoinYears: s.companyJoinYears,
    },
    product: {
      productId: p.productId, subject: p.subject, moq: p.moq, boxMoq: p.boxMoq,
      customsMoq: p.customsMoq, quantityUnit: p.quantityUnit,
      productBasicProperties: props('productBasicProperties'),
      productKeyIndustryProperties: props('productKeyIndustryProperties'),
      productOtherProperties: props('productOtherProperties'),
      price: {
        unit: pr.unit,
        currencyRule: pr.currencyRule ? { rate: pr.currencyRule.rate } : undefined,
        productLadderPrices: pr.productLadderPrices,
        productRangePrices: pr.productRangePrices,
      },
      sku: {
        skuAttrs: (sk.skuAttrs || []).map((a) => ({
          id: a.id, name: a.name,
          values: (a.values || []).map((v) => ({ id: v.id, name: v.name, largeImage: v.largeImage, fileName: v.fileName })),
        })),
        skuInfoMap: Object.fromEntries(Object.entries(sk.skuInfoMap || {})
          .map(([k, v]) => [k, { id: v.id, price: v.price, dollarPrice: v.dollarPrice }])),
      },
      mediaItems: (p.mediaItems || []).filter((m) => m.imageUrl)
        .map((m) => ({ group: m.group, imageUrl: { big: m.imageUrl.big, small: m.imageUrl.small } })),
    },
    sourceUrl: location.href.split('?')[0],
  } };

  const payload = JSON.stringify(trimmed);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = p.productId + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  console.log('saved ' + p.productId + '.json — ' + (payload.length / 1024).toFixed(1) + ' kB');
})();
