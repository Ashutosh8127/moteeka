import { deriveTitle } from './naming.ts';
import type { Product } from '../types.ts';

/**
 * Copy for a product page, composed from what the listing actually declared.
 *
 * Forty-three pieces came in with an empty `description`, so they opened with a
 * title, a price and a table of raw attributes — nothing that says what the
 * thing is. This writes that paragraph.
 *
 * **Every sentence here is a restatement of a recorded attribute.** Nothing is
 * inferred from the photographs and nothing is invented: no provenance, no
 * craft story, no claim about who made it or where. A generated line is a
 * decent default to publish and a better starting point to edit than a blank
 * field — `npm run edit -- <slug> --description "…"` overrules it.
 */

/** Attribute lookup that does not care how the listing capitalised the key. */
function attr(details: Record<string, string>, ...names: string[]): string {
  const lower = new Map(Object.entries(details).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) {
    const v = lower.get(n.toLowerCase());
    if (v && !/^(none|null|other|n\/?a|\/|-)$/i.test(v.trim())) return v.trim();
  }
  return '';
}

/** Listings write the same stone six ways. */
const STONES: Array<[RegExp, string]> = [
  [/zircon|cubic zirconia|\bcz\b/i, 'cubic zirconia'],
  [/rhinestone/i, 'rhinestones'],
  [/crystal/i, 'crystal'],
  [/pearl/i, 'faux pearls'],
  [/opal/i, 'opal'],
  [/turquoise/i, 'turquoise'],
  [/glass/i, 'glass stones'],
];

const CUTS: Array<[RegExp, string]> = [
  [/round brilliant/i, 'round brilliant-cut'],
  [/princess/i, 'princess-cut'],
  [/marquise/i, 'marquise-cut'],
  [/emerald cut/i, 'emerald-cut'],
  [/pear/i, 'pear-cut'],
  [/oval/i, 'oval-cut'],
  [/\bround\b/i, 'round-cut'],
];

/** Long form for the paragraph, short form for the card line. */
const SETTINGS: Array<[RegExp, string, string]> = [
  [/claw|prong/i, 'held in claw settings', 'claw-set'],
  [/pave|pavé/i, 'set pavé', 'pavé-set'],
  [/channel/i, 'set into channels', 'channel-set'],
  [/micro/i, 'micro-set', 'micro-set'],
  [/bezel/i, 'rubbed into bezels', 'bezel-set'],
];

/** The metal under the plating. Customers ask; it belongs in the paragraph. */
const METALS: Array<[RegExp, string]> = [
  [/brass/i, 'brass'],
  [/copper/i, 'copper alloy'],
  [/zinc|alloy/i, 'alloy'],
  [/stainless/i, 'stainless steel'],
];

const PLATINGS: Array<[RegExp, string]> = [
  [/oxidi[sz]ed|antique silver/i, 'oxidised silver'],
  [/rose gold/i, 'rose gold'],
  [/18k|24k|\bgold\b/i, 'gold'],
  [/rhodium|white gold/i, 'rhodium'],
  [/\bsilver\b/i, 'silver'],
];

const OCCASIONS: Array<[RegExp, string, string]> = [
  [/wedding|bridal/i, 'weddings', 'wedding'],
  [/engagement/i, 'engagements', 'engagement'],
  [/anniversary/i, 'anniversaries', 'anniversary'],
  [/party|prom/i, 'parties', 'party'],
  [/festival|diwali|holiday|christmas/i, 'festivals', 'festival'],
  [/daily|everyday|casual|shopping|traveling/i, 'every day', 'everyday'],
];

/**
 * The plating rules overlap on purpose — "Rose Gold" is gold and "oxidised
 * silver" is silver — so a listing that states one produces both, and the
 * paragraph reads "plated rose gold and gold". Keep the specific one.
 */
function platings(text: string): string[] {
  const got = all(PLATINGS, text);
  const golds = text.match(/\w+\s+gold|gold/gi) ?? [];
  return got.filter((x) => {
    if (x === 'silver' && got.includes('oxidised silver')) return false;
    if (x === 'gold' && got.includes('rose gold') && golds.every((g) => /rose/i.test(g))) return false;
    return true;
  });
}

const first = (table: Array<[RegExp, ...string[]]>, text: string, col = 1): string =>
  text ? (table.find(([re]) => re.test(text))?.[col] as string ?? '') : '';

const all = (table: Array<[RegExp, ...string[]]>, text: string, col = 1): string[] =>
  text ? table.filter(([re]) => re.test(text)).map((row) => row[col] as string) : [];

/** "a, b and c" — Oxford-less, which is how the rest of the site reads. */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const NUMBER = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve'];
/** Words up to twelve, figures above — the usual rule, and it reads better. */
const spell = (n: number) => NUMBER[n] ?? String(n);

const sentence = (s: string) => (s ? `${s[0]!.toUpperCase()}${s.slice(1)}.` : '');

const an = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * A stable choice among equally true phrasings, keyed on the slug. Without it
 * fifty pages open with the same sentence; with it the wording varies and the
 * same product still reads the same way on every rebuild.
 */
function pick<T>(options: T[], seed: string): T {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return options[h % options.length]!;
}

export interface Facts {
  noun: string;
  pieces: string;
  stone: string;
  cut: string;
  setting: string;
  shape: string;
  metal: string;
  platings: string[];
  style: string;
  occasions: string[];
  colourways: number;
  size: string;
  weight: string;
  closure: string;
  adjustable: boolean;
  noPiercing: boolean;
  /** True when each option has its own photograph, so "colourway" is honest. */
  swatched: boolean;
  /** The short adjectival setting, for the card line: "claw-set". */
  settingShort: string;
  /** Occasions as tags — singular, and kept even when the sentence drops them. */
  occasionTags: string[];
  /** A listing that names five occasions has named none. */
  occasionSpam: boolean;
  /** Free text someone wrote about the piece itself, where a listing has it. */
  described: string;
}

export function facts(p: Pick<Product, 'title' | 'category' | 'material' | 'finish' | 'details' | 'variants'>): Facts {
  const d = p.details ?? {};
  const text = `${p.title} ${Object.values(d).join(' ')}`;
  const setsType = attr(d, 'Jewelry Sets Type');

  // A "4piece jewelry set" and a "Necklace and Earring Sets" are both sets; only
  // one of them can say how many pieces.
  const counted = /(\d)\s*piece/i.exec(setsType) ?? /(\d)\s*piece/i.exec(p.title);
  const named = setsType.includes('/') ? setsType.split('/').map((s) => s.trim().toLowerCase()) : [];
  const pieces = counted
    ? `${['', 'one', 'two', 'three', 'four', 'five', 'six'][Number(counted[1])] ?? counted[1]} pieces`
    : named.length > 1 ? list(named)
    : /necklace and earring/i.test(setsType) ? 'necklace and earrings'
    : '';

  return {
    noun: deriveTitle(d, p.title, p.category).noun,
    pieces,
    stone: first(STONES, attr(d, 'Main Stone', 'Rings Material', 'Stones', 'Pearl Type')),
    cut: first(CUTS, attr(d, 'Diamond shape', 'Stone Shape')),
    setting: first(SETTINGS, attr(d, 'Inlay technology', 'Setting Type')),
    settingShort: first(SETTINGS, attr(d, 'Inlay technology', 'Setting Type'), 2),
    // "Bells" and "Leaf Shape" both describe the same thing the same way.
    shape: attr(d, 'Shape / pattern', 'Shape').toLowerCase()
      .replace(/\s*(shape|pattern|style)$/, '').replace(/s$/, ''),
    metal: first(METALS, `${p.material} ${attr(d, 'Jewelry Main Material', 'Material Type', 'Material')}`),
    platings: platings(`${p.finish} ${attr(d, 'Plating', 'Metal Color', 'Color')}`),
    style: first([[/vintage|retro|antique/i, 'vintage'], [/classic|traditional/i, 'classic'],
      [/trendy|fashion|modern/i, 'modern'], [/romantic/i, 'romantic'], [/boho|ethnic|tribal/i, 'ethnic']],
      attr(d, 'Style')),
    occasions: all(OCCASIONS, `${attr(d, 'Occasion')} ${attr(d, 'Application', 'Usage')}`),
    occasionTags: all(OCCASIONS, `${attr(d, 'Occasion')} ${attr(d, 'Application', 'Usage')}`, 2),
    // "Other, Anniversary, Engagement, Gift, Wedding, Party, Prom, Christmas,
    // Holiday" is a search-keyword field, not a statement about the piece.
    occasionSpam: attr(d, 'Occasion').split(',').filter(Boolean).length >= 4,
    described: [attr(d, 'Top'), attr(d, 'Drop'), attr(d, 'Stones')]
      .filter((x) => x && x.split(' ').length > 2).join('; ').toLowerCase(),
    colourways: new Set(p.variants.map((v) => v.label)).size,
    swatched: p.variants.some((v) => v.swatch),
    size: attr(d, 'Size', 'Length', 'Drop length'),
    weight: attr(d, 'Weight', 'Weight per pair'),
    closure: attr(d, 'Closure').toLowerCase(),
    adjustable: /adjustable|open band|one size|fits most/i.test(text),
    noPiercing: /no[\s-]?piercing|clip[\s-]?on|non[\s-]?pierced/i.test(text),
  };
}

/** Sentence one: what the piece is. */
function whatItIs(f: Facts, seed: string): string {
  const noun = f.noun.toLowerCase();
  // The setting is a clause about the stones, not another adjective on them:
  // "cubic zirconia, micro-set", never "cubic zirconia micro-set".
  const stone = f.stone
    ? `${f.cut ? `${f.cut} ` : ''}${f.stone}${f.setting ? `, ${f.setting}` : ''}`
    : '';
  const shape = f.shape && !new RegExp(`\\b${f.shape}s?\\b`, 'i').test(noun) ? f.shape : '';

  if (f.pieces) {
    const inStone = stone ? ` in ${stone}` : '';
    return pick([
      `${f.pieces[0]!.toUpperCase()}${f.pieces.slice(1)}${inStone}, meant to be worn together.`,
      `A matching set — ${f.pieces}${inStone}.`,
      `A set of ${f.pieces}${inStone}.`,
    ], seed);
  }

  const head = shape ? `${shape} ${noun}` : noun;
  const Head = `${head[0]!.toUpperCase()}${head.slice(1)}`;
  // "A tassel earrings" is what a template writes and no person ever does.
  const article = /earrings|drops$/.test(noun) ? 'A pair of'
    : /s$/.test(noun) ? '' : `${an(head)[0]!.toUpperCase()}${an(head).slice(1)}`;
  const opener = article ? `${article} ${head}` : Head;
  return pick([
    `${opener}${stone ? ` in ${stone}` : ''}.`,
    `${Head}${stone ? `, ${stone}` : ''}.`,
    `${opener}${stone ? `, ${stone}` : ''}.`,
  ], seed);
}

/** Sentence two: the metal, the plating, and how many ways it comes. */
function howItIsMade(f: Facts, seed: string): string {
  let metal = '';
  if (f.metal && f.platings.length) {
    metal = pick([
      `${f.metal} under ${list(f.platings)} plate`,
      `${list(f.platings)} plate over ${f.metal}`,
      `plated ${list(f.platings)} over ${an(f.metal)} ${f.metal} body`,
    ], seed);
  } else if (f.platings.length) {
    metal = `finished in ${list(f.platings)} plate`;
  } else if (f.metal) {
    metal = f.metal;
  }

  // Colourways are the variants a buyer picks between, so say how many.
  const word = f.swatched ? 'colourways' : 'options';
  const many = f.colourways > 1
    ? pick([`in ${spell(f.colourways)} ${word}`, `${spell(f.colourways)} ${word} to pick from`,
        `${spell(f.colourways)} ${word}`], seed + 'c')
    : '';

  if (metal && many) return sentence(`${metal}, ${many}`);
  return sentence(metal || many);
}

/** Sentence three: when it is meant to be worn, and how it fits. */
function howItWears(f: Facts, seed: string): string {
  const bits: string[] = [];
  if (f.noPiercing) bits.push('No piercing needed');
  else if (f.adjustable) bits.push(pick(['Adjustable, so it fits most', 'Open band — adjusts by hand'], seed));
  else if (f.closure) bits.push(`Closes with ${an(f.closure)} ${f.closure}`);

  const when = f.occasions.filter((o) => o !== 'every day');
  if (when.length && !f.occasionSpam) {
    const occasions = list(when.slice(0, 2));
    bits.push(pick([`made for ${occasions}`, `cut for ${occasions}`, `meant for ${occasions}`], seed + 'o'));
  } else if (f.occasions.includes('every day') && !f.occasionSpam) {
    bits.push('light enough for every day');
  }

  return sentence(bits.join(', '));
}

/** Sentence four: the numbers, when the listing bothered to state any. */
function theNumbers(f: Facts): string {
  const bits: string[] = [];
  if (f.size) bits.push(f.size);
  if (f.weight) bits.push(f.weight);
  return bits.length ? `${bits.join(' · ')}.` : '';
}

export interface Copy { tagline: string; description: string; tags: string[] }

export function describe(
  p: Pick<Product, 'slug' | 'title' | 'category' | 'material' | 'finish' | 'details' | 'variants'>,
): Copy {
  const f = facts(p);
  const seed = p.slug;

  const description = [
    whatItIs(f, seed),
    f.described ? sentence(f.described) : '',
    howItIsMade(f, seed),
    howItWears(f, seed),
    theNumbers(f),
  ].filter(Boolean).join(' ');

  /*
   * The card line. Short enough not to wrap to three lines in the grid, and it
   * has to carry something the title does not already say — a title that is
   * already "Gold-Plated Tassel Earrings" makes "gold-plated tassel" wasted
   * words.
   */
  const said = p.title.toLowerCase();
  const unsaid = (s: string) => s && !said.includes(s.split(' ')[0]!.toLowerCase());
  const line = [
    f.cut && f.stone ? `${f.cut} ${f.stone}` : f.stone,
    f.settingShort,
    f.pieces && unsaid(f.pieces) ? f.pieces : '',
    f.colourways > 1 ? `${spell(f.colourways)} ${f.swatched ? 'colourways' : 'options'}` : '',
  ].filter(Boolean);
  // Commas, not "and": these are separate facts, not a list of like things.
  let tagline = line.slice(0, 2).join(', ');
  while (tagline.length > 68 && tagline.includes(',')) tagline = tagline.slice(0, tagline.lastIndexOf(','));
  if (tagline) tagline = tagline[0]!.toUpperCase() + tagline.slice(1);

  /*
   * Tags are what site search matches on besides the title — every one of these
   * products came in with none, so a search for "pearl" or "wedding" found
   * nothing that was not spelled out in a title.
   */
  const tags = [...new Set([
    p.category,
    f.noun.toLowerCase(),
    f.stone, f.shape, f.style,
    ...f.platings.map((x) => `${x}-plated`),
    ...f.occasionTags,
    f.adjustable ? 'adjustable' : '',
    f.noPiercing ? 'no piercing' : '',
  ].filter(Boolean).map((t) => t.toLowerCase()))].slice(0, 10);

  return { tagline, description, tags };
}

/* ------------------------------------------------------------------ specs -- */

/**
 * Attribute keys that must never reach a customer. Two of these were live: a
 * ring listing a "Factory Advantage" of ten years' experience, and a pair of
 * earrings carrying a `CN` row naming a Chinese province. Neither is ours to
 * publish, and both sat on the product page under the description.
 */
const NEVER = [
  /^cn$/i, /factory/i, /\bmoq\b/i, /supplier/i, /place of origin/i, /country of origin/i,
  /^picture$/i, /^item ?(name|no|code)$/i, /^product ?name$/i, /^model/i, /^name or words$/i,
  /^brand$/i, /^fits for$/i, /^quality$/i, /^feature$/i, /^birthstone$/i,
  /precious metals/i, /^gender$/i,
];

/** Supplier key → what a customer would call it. */
const RENAME: Array<[RegExp, string]> = [
  [/^jewelry main material$/i, 'Metal'],
  [/^material( type)?$/i, 'Metal'],
  [/^main stone$/i, 'Stone'],
  // The listing states the stone twice under two keys often enough to matter.
  [/^(rings?|earrings?|necklaces?) material$/i, 'Stone'],
  [/^diamond shape$/i, 'Stone cut'],
  [/^stone shape$/i, 'Stone cut'],
  [/^inlay technology$/i, 'Setting'],
  [/^setting type$/i, 'Setting'],
  [/^shape ?\/ ?pattern$/i, 'Shape'],
  [/^jewelry sets type$/i, 'Set contains'],
  [/^(earrings?|rings?|body jewelry|bracelets or bangles) type$/i, 'Type'],
  [/^jewelry type$/i, 'Type'],
  [/^main stone colou?r$/i, 'Stone colour'],
  [/^metal colou?r$/i, 'Finish'],
  [/^religious type$/i, 'Tradition'],
  [/^application$|^usage$/i, 'Wear it for'],
  [/^colou?r styles$/i, 'Colourways'],
];

/** Listings shout, spell American, and name a stone six ways. */
const TERMS: Array<[RegExp, string]> = [
  [/^zircon(ia)?$/i, 'Cubic zirconia'],
  [/^cz$/i, 'Cubic zirconia'],
  [/^rhinestones?$/i, 'Rhinestone'],
  [/^alloy$/i, 'Alloy'],
  [/^brass$/i, 'Brass'],
  [/^copper$/i, 'Copper'],
];

function tidyValue(value: string): string {
  let v = value.replace(/\s+/g, ' ').trim();
  const term = TERMS.find(([re]) => re.test(v));
  if (term) return term[1];
  // "BANGLES" and "ZIRCON" are the listing's caps lock, not an acronym.
  if (v.length > 2 && v === v.toUpperCase() && /[A-Z]{3}/.test(v)) {
    v = v[0]! + v.slice(1).toLowerCase();
  }
  return v
    .replace(/\bJewelry\b/g, 'Jewellery').replace(/\bjewelry\b/g, 'jewellery')
    .replace(/\bColor\b/g, 'Colour').replace(/\bcolor\b/g, 'colour');
}

/**
 * The rows worth keeping. Drops what a customer must never see, drops junk
 * values ("/", "Null", "none") that cost more than a missing row, and tidies
 * the shouting — but **keeps the listing's own key names**, because that is
 * what `facts()` above and `deriveTitle()` read. Renaming on the way into the
 * data made this function destroy the input of everything downstream of it.
 */
export function visibleDetails(details: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(details ?? {})) {
    const k = key.trim();
    if (NEVER.some((re) => re.test(k))) continue;
    const value = String(raw ?? '').trim();
    if (!value || /^(null|none|n\/?a|\/|-|other)$/i.test(value)) continue;

    /*
     * "Other, Anniversary, Engagement, Gift, Wedding, Party, Prom, Christmas,
     * Holiday" is a search-keyword field. Printed as a spec it tells a buyer
     * nothing and reads like the listing it was scraped from.
     */
    if (/^occasion$/i.test(k) && value.split(',').filter(Boolean).length >= 4) continue;

    const tidied = tidyValue(value);
    if (out[k] && out[k]!.toLowerCase() === tidied.toLowerCase()) continue;
    if (!out[k]) out[k] = tidied;
  }
  return out;
}

/**
 * The same rows under the names a buyer would use, for the product page only.
 *
 * `material` and `finish` are the two rows the page prints itself above the
 * table; pass them and the attribute that says the same thing again is
 * dropped, so the table cannot contradict the two rows above it.
 */
export function displayDetails(
  details: Record<string, string>,
  printed: { material?: string; finish?: string } = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(visibleDetails(details))) {
    let name = RENAME.find(([re]) => re.test(key))?.[1] ?? key;
    // "Set contains" only earns its name when the value lists the pieces.
    if (name === 'Set contains' && !/\/| and /i.test(value)) name = 'Type';
    if (name === 'Metal' && printed.material) continue;
    if (name === 'Finish' && printed.finish) continue;
    if (out[name]?.toLowerCase() === value.toLowerCase()) continue;
    if (!out[name]) out[name] = value;
  }
  return out;
}
