/**
 * Supplier listing titles are search bait, not names: "Dubai Fashion Openable
 * Bracelets Gift Jewelry 24K Gold Plating Ethiopia Bridal Saudi Arabia Design
 * Indian Wedding Gifts Bangles". Pasting that into a catalogue gives you a
 * 53-character slug and a product page that reads like a keyword stuffing.
 *
 * The listing's own attributes say what the thing is far more reliably than its
 * title does, so the name is built from those, with one descriptive word lifted
 * out of the title. The result is a decent default you can overrule — never a
 * pretence that a machine picked the right name.
 */

/** What the piece is, from the attribute that states it. */
const NOUNS: Array<[RegExp, string]> = [
  [/bangle/i, 'Bangle'],
  [/bracelet/i, 'Bracelet'],
  [/jhumk/i, 'Jhumka'],
  [/earring/i, 'Earrings'],
  [/necklace|choker|pendant/i, 'Necklace'],
  [/anklet|payal/i, 'Anklet'],
  // Nose jewellery before the generic ring rule: a "Nose Ring" is not a finger
  // ring, and a clip-on nath is not a ring at all.
  [/nose\s*cuff/i, 'Nose Cuff'],
  [/nose\s*clip|no[\s-]?piercing/i, 'Nose Clip'],
  [/nose\s*(pin|ring|stud)|\bnath\b|septum/i, 'Nose Pin'],
  // A word boundary after "ring" never matches "Rings", because "s" is a word
  // character — which is how four products ended up called "Piece".
  [/\brings?\b/i, 'Ring'],
  [/tikka|headpiece|passa/i, 'Maang Tikka'],
  [/brooch/i, 'Brooch'],
  [/\bsets?\b/i, 'Jewellery Set'],
];

/** How it is finished, from the plating or material attribute. */
const FINISHES: Array<[RegExp, string]> = [
  [/oxidi[sz]ed|antique silver|black silver/i, 'Oxidised'],
  [/rose gold/i, 'Rose Gold-Plated'],
  [/gold/i, 'Gold-Plated'],
  [/rhodium|white gold/i, 'Rhodium-Plated'],
  [/silver/i, 'Silver-Plated'],
];

/**
 * Words of shape or character, taken from the title, ordered by how much they
 * tell a buyer. "Openable" beats "Bridal"; "Peacock" beats "Vintage".
 */
const DESCRIPTORS = [
  // Construction and shape — the most specific thing a title usually says.
  'Openable', 'Adjustable', 'Screw', 'Hinged', 'Cuff', 'Kada', 'Chandbali', 'Jhumka',
  'Hoop', 'Stud', 'Crawler', 'Tassel', 'Layered', 'Tiered', 'Stacking', 'Stackable',
  // Motif.
  'Peacock', 'Lotus', 'Parrot', 'Elephant', 'Paisley', 'Ghungroo', 'Bell', 'Coin',
  'Mirror', 'Pearl', 'Filigree', 'Jaali', 'Meenakari', 'Temple', 'Floral',
  // Technique and character.
  'Carved', 'Engraved', 'Hammered', 'Twisted', 'Beaded', 'Hollow', 'Openwork',
  'Heart', 'Star', 'Moon', 'Butterfly', 'Leaf', 'Sunflower', 'Lantern', 'Petal', 'Snake',
  'Tribal', 'Boho', 'Geometric', 'Broad', 'Slim', 'Long', 'Bridal',
];

/**
 * Matches a descriptor in a title, tolerating the plural. "Bells" against
 * /\bBell\b/ fails because "s" is a word character — the same trap that named
 * four ring listings "Piece".
 */
const mentions = (word: string, text: string) => new RegExp(`\\b${word}s?\\b`, 'i').test(text);

export interface Named { title: string; noun: string; finish: string }

/**
 * A short, honest product name built from the listing's own attributes.
 *
 * `taken` is the titles already in the catalogue. Listings from the same
 * category share most of their attributes — oxidised, alloy, earrings,
 * wedding — so the obvious name collides the moment you import a second one.
 * Rather than silently returning a duplicate and letting the slug grow a `-2`,
 * this walks progressively more specific candidates until one is free.
 */
export function deriveTitle(
  attributes: Record<string, string>,
  supplierTitle: string,
  categoryName?: string,
  taken: string[] = [],
): Named {
  const attrText = Object.values(attributes).join(' ');
  const typeText = [
    attributes['Jewelry Type'], attributes['Bracelets or Bangles Type'],
    attributes['Earrings Type'], attributes['Necklaces Type'], categoryName, supplierTitle,
  ].filter(Boolean).join(' ');

  /*
   * A multi-piece set names itself after the set, not after one of its parts.
   * "4pcs Bridal Jewelry Set … Ring Earring Bracelets Necklace" was named
   * "Bracelet" because the word appears in the title and the noun list is
   * ordered — so the declared type wins outright when it says "set".
   */
  const declaredType = attributes['Jewelry Type'] ?? '';
  const noun = /\bsets?\b/i.test(declaredType)
    ? 'Jewellery Set'
    : NOUNS.find(([re]) => re.test(typeText))?.[1] ?? 'Piece';

  // "Other" is the listing's placeholder for a field nobody filled in, not a
  // finish — the same trap as the spec rows.
  const platingAttr = /^other$/i.test(attributes['Plating'] ?? '') ? '' : attributes['Plating'] ?? '';
  const finish = FINISHES.find(([re]) =>
    re.test(platingAttr) || re.test(attrText) || re.test(supplierTitle))?.[1] ?? '';

  // Every descriptor the title offers, in priority order, minus the noun
  // itself — "Oxidised Jhumka Jhumka" helps nobody.
  const found = DESCRIPTORS.filter((d) =>
    // Not just equal to the noun — contained in it. "Cuff" beside a noun of
    // "Nose Cuff" would otherwise read "Gold-Plated Cuff Nose Cuff".
    mentions(d, supplierTitle) && !noun.toLowerCase().includes(d.toLowerCase()));
  // The descriptor list also contains "Bridal", so without this a title
  // carrying the word and an Occasion of Wedding reads "Bridal Bridal".
  const occasion = /wedding|bridal/i.test(attributes['Occasion'] ?? '')
    && !found.includes('Bridal') ? 'Bridal' : '';

  const join = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(' ');
  const candidates = [
    // With nothing specific in the title, the occasion is the best first
    // answer: "Gold-Plated Bridal Bangle" says more than "Gold-Plated Bangle".
    found[0] ? join(finish, found[0], noun) : join(finish, occasion, noun),
    join(finish, found[0], found[1], noun),
    join(finish, found[1], noun),
    join(finish, found[0], occasion, noun),
    join(finish, found[1], found[2], noun),
    join(finish, occasion, noun),
    join(finish, noun),
  ].filter((t, i, all) => t && all.indexOf(t) === i)
    // A title that is nothing but the noun — "Jhumka" — names a category, not
    // a product. Keep it only as the last resort it is.
    .sort((a, b) => Number(a === noun) - Number(b === noun));

  const normal = (t: string) => t.trim().toLowerCase();
  const used = new Set(taken.map(normal));
  const title = candidates.find((c) => !used.has(normal(c)))
    ?? candidates[0]
    ?? (join(finish, noun) || noun);
  return { title, noun, finish };
}
/**
 * Supplier variant names are internal codes — "Design 5 One Piece - Gold Color"
 * says nothing a buyer can act on, and the colour half is usually a lie when
 * every option is the same gold. Strip the noise and keep the number, which at
 * least matches the order the swatches appear in.
 */
export function tidyVariantLabel(label: string): string {
  let out = label
    .replace(/\bone\s*piece\b/gi, '')
    .replace(/\bgold\s*colou?r\b/gi, '')
    .replace(/\bcolou?r\b/gi, '')
    .replace(/[-–—/]\s*$/g, '')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // "Design 5" is the supplier's word; "Pattern 5" is at least a word a buyer
  // reads as "one of several looks" rather than a part number.
  out = out.replace(/\bdesign\s*(\d+)\b/gi, 'Pattern $1');
  return out || label;
}

/**
 * True when a label still reads like a supplier code rather than a name.
 * Codes arrive in several shapes: a word and a number ("Pattern 5", "Gold3"),
 * a part number ("A-3", "FX916-1"), or a bare number.
 */
export function looksUnnamed(label: string): boolean {
  const t = label.trim();
  // A measurement is a name: "Size 2.4" and "18 in" tell a buyer what they get,
  // unlike "A-3". Without this a bangle's real sizes read as supplier codes.
  if (/^(size|length|width|diameter)\b/i.test(t)) return false;
  if (/\d\s*(mm|cm|in|inch|inches|g|gm|grams?)\b/i.test(t)) return false;

  return /^(pattern|design|style|colou?r|option|type|item|no)[\s.-]*\d+$/i.test(t)
    || /^[a-z]{1,6}[\s.-]?\d{1,6}([\s.-]\d{1,3})?$/i.test(t)
    || /^\d+$/.test(t);
}
