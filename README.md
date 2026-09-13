# oxide-jewelry

Storefront and API for an oxidised silver jewellery shop. JSON-backed today,
database-ready for when you ship it.

```bash
npm install
cp .env.example .env          # ADMIN_TOKEN goes here; without it /admin.html is off
npm run seed                  # the category list, into an empty data/
npm run dev                   # http://localhost:4000
```

Node 24 or newer runs the TypeScript directly — no build step, no bundler.

| | |
|---|---|
| Storefront | http://localhost:4000 |
| A product | http://localhost:4000/product.html?slug=wedding-kada |
| Checkout | http://localhost:4000/checkout.html |
| API | http://localhost:4000/api/products |
| Health | http://localhost:4000/api/health |
| Privacy | http://localhost:4000/privacy.html |
| Contact | http://localhost:4000/contact.html |

`PORT=3000 npm run dev` moves it. Every URL below follows the port.

## Adding a product from a listing URL

The whole runbook, from a link someone sent you to a page a customer can buy
from. **Step 1 is yours** — the supplier site shows a slider check to anything
that looks automated, so the capture happens in your own logged-in browser.
Everything after it is two commands.

### 1. Capture the listing (in the browser)

Open the URL, clear the slider if one appears, then **F12 → Console**, paste the
contents of `scripts/capture-snippet.js`, press Enter. It downloads
`<productId>.json`. Move that file into `captured/`:

```bash
mv ~/Downloads/1601926604847.json captured/
```

It saves about 6 kB rather than the 150 kB the page holds, because it keeps only
the fields the importer reads — and it records the page's own URL, so you never
pass `--url`.

To make it one click, add a bookmarklet: **Bookmarks → Add**, and paste
`javascript:` followed by the snippet body as the URL.

### 2. Import it

```bash
npm run slugs                                    # which categories exist
npm run onboard -- ./captured/1601926604847.json \
  --category earrings --qty 20 --brand Moteeka --activate
```

`--category` is the only required flag. Everything else has a default: the name
is built from the listing's attributes, the slug from that name, variants become
`Pattern 1`…`Pattern N`, stock is 10 with `--activate`, and the price is the
supplier's cost at `--qty` times six.

Use `--qty` to say how many you will actually order — cost is read from that
quantity tier, and the listing's cheapest tier is a 500-piece break you will not
hit on a first order.

### 3. Look at it, then name it

```bash
open http://localhost:4000/product.html?slug=<slug>
```

`onboard` prints the exact next command with your slug and variant labels
already in it. Fill in your own words:

```bash
npm run edit -- <slug> \
  --title "Hoop & Stud Earring Set" \
  --tagline "A card of hoops, studs and pearls — twelve sets to choose from" \
  --description "A whole card of earrings in one buy: chunky hoops, …" \
  --tags "earrings,hoops,studs,pearl,set,gifting" \
  --rename "Pattern 1=Gold Twisted Hoops" \
  --rename "Pattern 2=Gold Mini Hoop Mix" \
  --stock 25
```

**You cannot name a pattern you have not seen**, which is why naming comes after
the import rather than before it.

### 4. Check it before it goes out

```bash
npm run slugs                      # status and page weight
npm run sourcing -- --audit        # can every variant be reordered?
npm run images:resize -- --dry-run # anything still full size?
```

### If the page shows a slider and never loads

Nothing here can clear it, and nothing here should try. Clear it yourself in
the browser, wait for the product page, then run the snippet. A saved HTML page
works too — **Save Page As → HTML** into `html/`, then pass that file to
`onboard` instead of the JSON.

## What's here

| | |
|---|---|
| **Storefront** | `public/` — plain HTML/CSS/JS, no framework, no bundler |
| **API** | `src/routes/` — Express, JSON in and out |
| **Storage** | `src/repo/` — one interface, two drivers: files and Firestore |
| **Container** | `Dockerfile` — no build stage; the image is the source |
| **Postgres** | `prisma/schema.prisma` — written, no driver yet |

## The seam that matters

`src/repo/index.ts` defines `Repo` — twelve methods. Routes only ever talk to
that interface, never to a file and never to a query.

| `REPO_DRIVER` | | |
|---|---|---|
| `json` | default | `data/products/`, one file per slug |
| `firestore` | written and wired | for a host whose filesystem is not real |
| `postgres` | schema only | `prisma/schema.prisma` mirrors `src/types.ts` field for field |

Adding the Firestore driver changed **no route, no handler and no frontend
call** — it is one new class and one branch in `openRepo()`. That is what the
seam was for. Postgres would be the same three steps:

1. `npx prisma migrate dev`
2. write `src/repo/prisma-repo.ts` implementing `Repo`
3. return it from `openRepo()` and set `REPO_DRIVER=postgres`

The client for a driver is imported **lazily**, so the JSON path never loads
the Firestore package and a machine with no credentials still runs.

## API

```
GET  /api/products?category=jhumka&search=silver&sort=price-asc&page=1
GET  /api/products/:idOrSlug
GET  /api/categories
GET  /api/facets                  categories + price bounds + tag counts, one call
POST /api/cart/quote              { lines: [{ sku, quantity }] }
POST /api/orders                  quote + customer + address
GET  /api/orders/:reference
GET  /api/business             seller details for the legal pages
GET  /api/health
```

`POST /api/orders` answers **409** when stock ran out between quoting the cart
and placing it. The request was valid; the world changed under it. Anything
that posts an order has to handle that, not only 400.

A quote line carries `stock`, so the cart's quantity stepper knows its ceiling.
An order does not: what was left at the moment of buying is not part of what
was bought.

`POST /api/cart/quote` **never fails because of a bad line.** A cart lives in
the customer's browser and the catalogue moves underneath it — a SKU gets
renamed, a product goes to draft, the last one sells. Unknown and sold-out
lines come back in `dropped`; the rest are still priced, so the drawer can
render and the customer can remove them. A quantity above what is left is
clamped rather than rejected.

Throwing on the first bad line took the whole cart down: the quote failed, so
the drawer could not render, so there was no way even to remove the offending
item. `POST /api/orders` still refuses outright (**409**) if any line was
dropped — you cannot sell what is not there.

**Prices are never taken from the request.** A posted cart is a list of SKUs and
quantities; the server re-reads every price from the catalogue, checks stock and
computes shipping and GST itself. A cart edited in devtools changes nothing.

Money is **integer paise** throughout — ₹649 is `64900`. Floats drift the moment
you apply a discount and sum a cart.

## What a product page says

Forty-three pieces came in with `description: ""` and opened with a title, a
price and a table of raw supplier attributes. `npm run describe` writes that
paragraph, from `src/lib/describe.ts`.

```bash
npm run describe                      # what it would write; changes nothing
npm run describe -- --write           # fill the empty ones
npm run describe -- --write --specs   # and tidy the spec tables
npm run describe -- --slug <slug> --write --force   # rewrite one by hand-off
```

**Every sentence is a restatement of a recorded attribute.** Nothing is read off
the photographs and nothing is invented — no provenance, no craft story, no
claim about who made a piece or where. Where a listing declared nothing, the
sentence is simply absent, which is why some pieces get four sentences and some
get two. The wording varies by slug so fifty pages do not open identically, and
the same product is described the same way on every run.

Two things it will not say. It never calls a piece **unplated** because the
listing was silent about plating — silence is not a fact. And it drops the
occasion sentence when the listing names four or more: *"Other, Anniversary,
Engagement, Gift, Wedding, Party, Prom, Christmas, Holiday"* is a search-keyword
field, not a statement about the piece.

A generated line is a **default to edit, not a finished sentence**. Hand-written
copy is never overwritten without `--force`:

```bash
npm run edit -- <slug> --description "…" --tagline "…"
```

New imports arrive with it already filled — `scrape` composes the copy into
`intake/onboard.json`, so nothing needs a second command.

### The spec table

The table under the description is filtered twice.

`visibleDetails()` runs on the way **into** the catalogue and drops rows a
customer must never see. Two were live on the site: a ring advertising a
*"Factory Advantage"* of ten years' experience, and a pair of earrings carrying
a `CN` row naming a Chinese province. It also drops junk values (`/`, `Null`,
`none`) and fixes the listing's caps lock and American spelling — `ZIRCON`
becomes `Cubic zirconia`, `Jewelry` becomes `Jewellery`.

`displayDetails()` runs on the way **out**, in the product route, and renames
the keys to what a buyer would call them — `Jewelry Main Material` → `Metal`,
`Inlay technology` → `Setting`. It also drops any row that repeats the Material
or Finish the page already prints above the table, so the table cannot
contradict the two rows above it.

The split matters: renaming on the way *in* silently broke `deriveTitle()` and
`facts()`, which read the listing's key names, and a second `--write` produced a
worse description than the first. **The stored keys stay the listing's own.**

## The product page

Rebuilt around the one thing it has to do: say what the piece is, what it costs,
and let someone buy it without scrolling back up.

**The price block.** During a sale it used to read `₹755 ₹839` — two numbers the
same size, side by side, with nothing saying which one you pay. Now what you pay
is set large in the display face, what it was is struck through and quiet, and
the saving is spelled out so nobody does the arithmetic themselves:

```
₹755   ₹̶8̶3̶9̶   [ SAVE ₹84 · 10% ]
Inclusive of all taxes · Free delivery over ₹999
```

Shipping thresholds and the **delivery window** now come from `/config.js`, so
the product page, the footer, the contact page and the cart cannot disagree
about them — each was hardcoded in three or four places.

The window itself is two numbers in `data/business.json`:

```json
"deliveryMinDays": 15,
"deliveryMaxDays": 25
```

Change them there and every page that mentions delivery changes. It is said in
three places on purpose — the assurance line, the delivery fold, and the
contact page — and said up front rather than buried, because the
**Consumer Protection (E-Commerce) Rules 2020** require a published delivery
timeline, and a fifteen-to-twenty-five day wait discovered *after* paying is the
single most reliable way to turn an order into a dispute.

The rest of the page: a breadcrumb back to the category; a hero that opens full
size in a lightbox (not a zoom lens, which is the control that never works on a
phone); **colourways folded after twelve**, because twenty-three swatches in one
block reads as wallpaper rather than as a choice; `Add to cart` beside `Buy now`;
three assurances; four folds — About / Specifications / Care / Delivery and
returns; and four more pieces from the same category, because a product page
with nothing after it is a dead end for whoever arrived from an ad.

On a phone a **sticky buy bar** appears once the real buy row scrolls away,
driven by an IntersectionObserver on that row so there is never a moment with
two Add to cart buttons arguing for the same tap. On desktop the buy column is
sticky instead and the bar never renders.

### Ratings and interest — the real ones

Two pieces of social proof, both built on data that exists.

**Stars come from verified buyers only.** Leaving a review requires an **order
reference that actually contains that piece**; the server checks it against the
orders file and refuses anything else with a deliberately vague message, so the
form cannot be used to find out whether a reference is real. Nothing is
published by posting it — every review lands as `pending` and appears only when
you approve it in the admin **Reviews** tab, where the order reference sits
beside it so you can check the words against the order.

```
GET  /api/products/:slug/reviews     published only; no order references
POST /api/products/:slug/reviews     needs a real order → 202 pending
```

A product with no approved reviews shows **no stars at all** — not zero, not
five empty ones. That is correct: stars before anyone has bought anything are
decoration, and the customer who works that out has learned something about the
shop that no amount of design recovers from.

**"Opened 34 times in the last 7 days"** is a real count out of
`data/analytics/`, not a number invented to look busy. Below **15** real views
the line is not sent to the page at all, because "opened 3 times this week" is
worse than silence.

### Watching now

`● 12 people looking at this right now` — real presence, held in memory and
nowhere else.

An open product page posts a heartbeat every **20 seconds** while its tab is
visible, and a visit that stops saying so drops out after 90 — three beats of
slack, and short enough that arrivals and departures show up while somebody is
still reading, which is the whole point of saying it at all. The number counts
to its new value rather than snapping, and flickers green as it moves. Nothing is
written to disk, nothing survives a restart, and the token is the browser's own
per-tab id, which dies with the tab. A phone in a pocket stops counting
immediately, because a hidden tab is not a person looking at a necklace.

**The floor is two.** One is you, and "1 person is looking at this" on a page
you are looking at is a shop telling you about yourself.

```
POST /api/products/:slug/live   { token }  →  { watching }
```

This is the counter sites most often invent, and it is the easiest to catch —
open two tabs and compare. Ours is countable, which is the only reason it can be
shown at all. A fabricated one is false urgency under the CCPA's 2023 dark
patterns guidelines.

### Looking at it with data in it

Both of those render **nothing** on a shop with no orders, which makes the
design impossible to judge. So there is a seeder:

```bash
npm run demo -- --seed     # fabricated ratings and traffic
npm run demo -- --clear    # remove all of it
```

It fills the watching line too, and the way it moves is the part worth getting
right. Two properties make a counter read as a measurement rather than a widget:

- **A slow walk around a fixed base**, not a fresh number each time. Three
  overlapping steps of different lengths sum to a drift that is mostly still
  with occasional runs — `153 → 154 → 148 → 147` over a minute and a half. One
  redrawn at random jumps 61 → 187 → 54 and gives itself away instantly.
- **Every viewer sees the same number at the same moment**, because it comes
  from the clock rather than from a per-request roll. Two tabs disagreeing is
  the other tell, and the one people actually check.

226 reviews across 45 pieces with a believable spread — mostly four and five, a
few threes, the occasional one, because a shop where every rating is five stars
is a shop nobody believes — and 30 days of traffic, enough that the "opened N
times" line clears its floor. The sequence is fixed, so two runs produce the
same shop and yesterday's screenshot still matches today's page.

**This is a seeder and not a random number in the product page**, and the
difference is three guards:

| | |
|---|---|
| Every record is marked `demo: true` | `--clear` removes exactly those and leaves real reviews alone, so it is safe on a shop that has started selling |
| The storefront shows a **banner** while any is present | Nobody can read a fabricated review without also reading that it is fabricated |
| The server **refuses to start** with `NODE_ENV=production` | Not a warning in a log, which is a thing you scroll past |

A `Math.random()` in the render path would have none of those. It ships, it
cannot be switched off, and the first customer to open two tabs sees a different
number in each.

### What was left out, deliberately

The reference this was modelled on carries *"97 visitors are viewing this
product"* and *"Wishlisted by 200+ shoppers"*. Both are **false urgency**, named
as a dark pattern in the CCPA's 2023 guidelines, and neither number would be
true here. For the same reason the stock line only speaks under **five** left,
not fifteen: manufactured scarcity is a lie the stock file can contradict.

There is no EMI banner and no "secure payments" badge either — no payment is
taken on this site at all, and a badge for something that does not happen is
the same problem in a friendlier font.

## When an order arrives

Before this, an order was written to disk and that was the end of it — you found
out by opening the admin page and looking. On a shop that takes payment by phone
after a fifteen-to-twenty-five day wait, the order you do not notice is the
order you lose.

```bash
ORDER_WEBHOOK_URL=https://…      # one HTTPS POST per order
ORDER_WEBHOOK_SECRET=…           # sent as X-Webhook-Secret
```

**A webhook rather than a mail server.** Every channel worth having in India —
WhatsApp through an approved provider, SMS through MSG91, email through any
transactional API — is an HTTPS POST. One outbound request reaches all of them
through Zapier, Make, n8n or thirty lines on your own box, with no dependency
here and no password in this repository. The payload is deliberately flat so a
no-code tool can map it, and carries a ready-made `message`:

```
New order OXJ-260913-DA9D — ₹1,057 from Test Buyer (+919876543210). 1× Zirconia Tennis Anklet
```

It is sent **after** the order is safely written and **never awaited into the
response** — a slow webhook must not turn a placed order into an error for the
customer. Every attempt is logged, and an order nobody was told about is marked
**unannounced** in the admin page, so a webhook that quietly stopped working is
visible rather than silent.

## Your order

`/order.html?ref=OXJ-…` — the page a customer comes back to.

There are no accounts, so the reference is the key: anyone holding it sees the
order, nobody else can guess it, and the page is `noindex`. The confirmation
screen now leads with **"Save this link"** rather than showing a reference on a
screen that is about to be closed.

It matters more here than on most shops. Delivery takes fifteen to twenty-five
days, and without it the only way to ask *where is my parcel* is to telephone
during business hours. Each status says what happens next in the customer's
terms — "pending" tells them nothing; *"we will call you to confirm and arrange
payment, nothing has been charged"* tells them what to expect.

## Share cards and search

`/` and `/product.html` are **rendered by the server**, not served off the
static directory, so their `<head>` carries the things that never run
JavaScript: WhatsApp, Instagram, Facebook and Google all read the HTML as it
arrives. Before this, every forwarded product link was a blank grey box — on a
shop whose plan is to buy traffic and be shared.

Each product page now carries `og:` and `twitter:` tags with an absolute image,
a canonical URL, and JSON-LD `Product` with an `AggregateOffer`. Proxy headers
decide the origin, so it is correct behind one.

**`aggregateRating` appears only when real published reviews exist.** Google
issues manual actions for rich results built on ratings a shop does not have.

`/sitemap.xml` is generated from the live catalogue — a sitemap you regenerate
by hand is a sitemap that is wrong — and `/404.html` answers with a **404
status** and a search box, because a soft 404 that returns the home page with a
200 is how a shop ends up with a hundred duplicate pages in a search index.

## Brand

The shop is **Moteeka** — from *moti*, pearl. It was called Kalakand, which is
a milk sweet.

```bash
npm run brand                                  # icons and the share card
npm run brand -- --slugs a-piece,another       # choose the photographs on the card
```

`public/brand/` holds the SVGs, which stay SVG because they are sharp at any
size and a browser renders them natively:

| | |
|---|---|
| `logo.svg` / `logo-reversed.svg` | mark plus wordmark, for an invoice or a marketplace listing |
| `mark.svg` / `mark-reversed.svg` | the mark alone, as it sits in the header |
| `favicon.svg` | the mark on its own ground, because a tab has no page behind it |

`npm run brand` builds the three that cannot be vector: `favicon.png`,
`apple-touch-icon.png`, and **`share-home.jpg`** — the card WhatsApp and
Facebook show for the front page. `src/lib/share.ts` had pointed at that file
since share cards were added and it did not exist, so every forwarded home-page
link showed a broken image.

### What the mark went through

Two versions were thrown away, and both failures are worth recording because
they only show up at the sizes people actually see:

- **One bead with a hard white catchlight** read as an *eye* at anything above
  favicon size.
- **Three beads arranged symmetrically** — two small above one large — read as
  a *face*.

The mark that shipped is three beads graduating along a thread, shaded with a
soft gradient rather than a highlight. Asymmetry and no hard dot fix both, and
at sixteen pixels what survives is three dots on a rising line.

Rasterising has its own trap. `qlmanage` — macOS's own, used because there is
no ImageMagick here and a brand asset is not worth a dependency — fits a
drawing to whichever side is longer, so a 1200×630 card came back scaled by
1.9× with the wordmark off the right edge. The card is authored on a **square**
canvas with the artwork in a centred band and cropped afterwards. It also does
not apply a `scale()` inside a translated group the way a browser does, so
nothing in the card uses a nested transform.

### The line under the name

It read **Oxidised Silver**, and 47 of the 54 live pieces are plated or stone-
set. It now reads *Silver & Gold-Plated*, and the hero says **"fashion jewellery
in plated alloy, not precious metal"** in as many words — the contact page
always said so, and the front page was quietly implying otherwise.

## The hero

```bash
npm run hero                                   # one piece per category, picked for you
npm run hero -- --slugs a,b,c,d,e              # choose the photographs yourself
```

Five real product photographs in a mosaic — one tall tile carrying the
composition and four in a block beside it — written into `public/index.html`
between `<!-- hero:start -->` and `<!-- hero:end -->`. Each tile links to its
piece. It replaced a line drawing of a jhumka in an empty box.

**A mosaic rather than one flattened image**, for three reasons. This machine
has `cwebp` and `sips`, which resize but cannot composite — there is no
ImageMagick to montage with. The tiles are the responsive variants that already
exist, so the hero is sharp on a retina screen without anyone generating a 2x
version of anything. And a flattened file goes stale the day a piece sells out
or a photograph is replaced; this is re-run with one command.

It is written into the HTML rather than fetched on load, because the hero is the
largest thing on the first screen and making it wait on an API call is how a
page scores badly on the one metric an ad click cares about.

**Pick the photographs yourself.** The automatic choice takes one piece per
category, preferring the import that came in cleanest and has stock. It cannot
tell that the first frame of that import is a hand holding a card with another
seller's branding on it — which is exactly what it chose first time. `--slugs`
is the real control.

## The grid

Each card carries the same two signals as the product page: a **presence chip**
on the photograph and **stars** under the title.

The chip sits top-right, opposite the Sale badge, so a piece that is both
discounted and busy does not stack two labels in one corner. It is white on a
dark translucent ground because these photographs run from black velvet to white
flat-lay, and a light chip disappears against half of them.

Both are read **once for the whole page** rather than per card — fifty-four
cards is fifty-four passes over the same review file otherwise.

### Two across on a phone

The card images have always carried `sizes="(max-width: 700px) 46vw, 300px"`,
but the grid's 238px minimum gave **one** column at 375px. Each card was 88vw
while the browser was told to fetch for 46vw, so it downloaded an image half the
width it needed and drew it soft — on the device three quarters of the traffic
arrives on. The grid is now explicitly two columns under 700px, which is what
the attribute always claimed and what a jewellery grid wants anyway.

## Browsing the catalogue

The storefront lists **24 pieces a page** — the API's own default, so the two
agree — with a pager under the grid: previous, first, a window of two either
side of where you are, last, next. The row is the same width at three pages and
at three hundred, and the ends are always one click away.

**The whole view is in the query string**, and that is the part that matters:

```
/?category=rings&sort=price-asc&page=2
```

Category, search, sort and page all round-trip. A visitor who opens a piece from
page 3 and presses Back lands on page 3 of the same filter rather than at the
top of the catalogue, an ad can point at one category, and a page anyone sends
anyone else opens on what they were looking at. Changing a filter returns you to
page 1 — the old page number means nothing against a different result set. A
page number past the end (a stale link, a filter that shrank under it) falls back
to the last real page instead of rendering an empty grid.

`perPage` is `PER_PAGE` at the top of `public/assets/js/index.js`. The API caps
it at 100.

## Getting products in from a supplier

You are the buyer, so the supplier is the source — not the listing page.

1. Send them `supplier-intake.template.json`, or just the questions inside it.
   Most suppliers return a filled sheet and a Drive/WeTransfer image pack the
   same day, at higher resolution than anything on the public listing.
2. Ask in the same message for written confirmation that you may use the images
   on your own site and marketplace listings. Keep the reply.
3. Save their answers into an intake file and run it in:

```bash
npm run product:add -- ./intake/jhumka.json
```

That creates the product, its variants and its SKUs, imports any images listed,
and leaves it **`draft`** — nothing reaches the storefront until you have
checked the price and the photographs:

```bash
npm run edit -- <slug> --status active
```

To pull only the image URLs out of a listing you have saved as HTML:

```bash
npm run extract -- ./html/page.html
```

## `onboard` in detail

The walkthrough is **Adding a product from a listing URL** above; this is the
reference for what the one command actually does and what it decides for you.

```bash
npm run onboard -- ./captured/1601927491404.json --category bangles --activate
```

It runs scrape → product:add → images:import → swatches → debrand → edit, in
order, printing each step, and fills in defaults for everything you did not say:

| | |
|---|---|
| **Name** | built from the listing's *attributes*, not its title — `Gold-Plated Openable Bangle`, not the 120-character keyword soup |
| **Slug** | derived from that name |
| **Variants** | `Design 5 One Piece - Gold Color` becomes `Pattern 5` |
| **Stock** | 10 with `--activate`, so the page is actually buyable; 0 otherwise |
| **Price** | the supplier's cost at `--qty` × 6, on a ₹__9 ending |
| **Images** | 160/400/800/1200 siblings written at import, `widths` recorded |
| **Sourcing** | supplier, listing URL and their part number per variant, privately |

Then it prints the `npm run edit` line to run next, with your slug and the real
variant labels already filled in.

You can say everything up front if you already know it:

```bash
npm run onboard -- ./captured/1601927491404.json \
  --category bangles --qty 20 --price 1079 --stock 20 \
  --title "Gold-Plated Wedding Kada" --slug wedding-kada \
  --tagline "A broad openable kada in nine wedding patterns" \
  --rename "Design 1=Sunburst Phool" --rename "Design 2=Ribbed Barrel" \
  --brand Moteeka --activate
```

### Every flag

Only `--category` is required.

| Flag | Default |
|---|---|
| `--category <slug>` | **required** — `npm run slugs` lists them |
| `--activate` | lands as a draft otherwise |
| `--brand <name>` | no brand stamped on |
| `--title "..."` | built from the listing's attributes |
| `--slug <slug>` | derived from that name |
| `--tagline "..."` | empty |
| `--qty <n>` | the MOQ — the quantity tier your cost is read from |
| `--markup <n>` | 6 |
| `--price <rupees>` | the suggestion, cost × markup on a ₹__9 ending |
| `--stock <n>` | 10 with `--activate`, 0 without |
| `--rename "A=B"` | repeatable, matches a fragment of the label; or do it afterwards with `edit --rename` |
| `--force` | import the same listing a second time |

### What it refuses, and what it only warns about

It **refuses before writing anything** when the slug is taken, or when the
listing has already been imported (`--force` overrides). Both checks run
ahead of the first file: a pipeline that creates the product and then fails on
step four leaves an orphan to find and delete by hand.

It **warns and keeps going** when a `--rename` matched no variant, when a
variant is still called `Pattern 4` or `FX916-2`, and when the page has no
description or tags. None of those fail loudly on their own, and none of them
are worth stopping an import over.

## Images

**There are no stand-in images.** Every piece on the storefront carries the
photographs that came with its listing; a piece with no photograph is held as a
draft until it has one, rather than shown behind a drawn silhouette. `npm run
slugs` names any live product whose image list is empty.

Three ways to get photographs in:

```bash
# 1. files you already have
npm run images:import -- --slug ethnic-retro-carved-jhumka ./photos/jhumka/*.jpg

# 2. a whole folder, in filename order
npm run images:import -- --slug ethnic-retro-carved-jhumka --dir ./photos/jhumka

# 3. URLs, once you have ones that actually serve
npm run images:import -- --slug ethnic-retro-carved-jhumka --url https://… --url https://…
```

### Scraping a whole listing

Every the supplier's product page embeds its own data as `window.detailData` — title,
ladder or per-SKU pricing, MOQ, all attributes, the SKU matrix, images and
supplier. Reading that beats scraping rendered HTML and does not break when the
markup changes.

```bash
npm run scrape -- ./html/listing.html --category jhumka --markup 6
npm run product:add -- intake/<productId>.json
```

Two ways to capture a page. the supplier site shows a slider verification to anything that
looks automated, so **the capture step is yours** — these scripts only read what
you already have:

1. Open the listing, clear the slider, **Save Page As → HTML**.
2. Or open the listing and paste `scripts/capture-snippet.js` into the browser
   console. It writes `<productId>.json` — about 6 kB rather than the 150 kB
   the page holds, because it keeps only the fields the importer reads and
   records the page's own URL, so `--url` is unnecessary.

`scrape` writes an intake file with the supplier's cost recorded per variant
(`_supplierCostRupees`) and a **suggested** retail at `--markup` × cost, landed
on a ₹__9 ending.

Cost is taken from the quantity tier that covers the order you are actually
placing — the MOQ by default, or `--qty 20` for what you really intend to buy.
The listing's cheapest tier is usually a 500-piece break you will not hit on a
first order; pricing off it understates your cost by about a third, so it is
printed as *best tier* for reference and not used for the suggestion.

A listing with no quantity ladder prices per SKU instead, and each variant then
carries its own cost — a twelve-set card of earrings came in at ₹929 to ₹2,419
a set. Where only a range is published, the **dearest** end is used: one price
has to cover whichever the buyer picks.

The suggestion is a starting point, not a decision. Run on its own, `scrape`
only writes the intake file; `product:add` is what creates the product, always
as a `draft`.

Both pricing shapes are handled: quantity ladders (*$0.96 for 5–39, $0.92 for
40–99, $0.89 for 100+*) and per-SKU pricing (*₹101–₹168 depending on colour*).

To pull only image URLs out of a listing: open it in your browser, **Save
Page As → HTML**, then

```bash
node scripts/extract-supplier.ts ./html/listing.html
npm run slugs                      # the product slugs you can import against
```

the supplier site blocks scripts from fetching the *page*, but its image CDN is open — so
the URLs the extractor finds download without any special handling.

It separates three things, because a saved listing is mostly page furniture:

| | |
|---|---|
| **Product images** | `/kf/<hash>.jpg` — the gallery, typically 1200×1200 |
| **Description panels** | `/kf/<hash>.png` — long infographics, usually not for your gallery |
| **Ignored** | icons, banners, trust badges, AI-assistant links (~130 per page) |

Images are then filtered again on the way in: anything under **400 px on its
short side is rejected** as a badge or logo (`--min-px` to change). On a real
listing this correctly kept 8 product photographs and dropped the supplier's
250×169 trust seal.

Note that `sc04.alicdn.com` serves **WebP** even for URLs ending `.jpg`. The
importer checks signature bytes rather than the extension, so files are saved
with the right type.

Files are checked by signature bytes, not by extension, so a mislabelled file
cannot become a broken image on a product page. The first image imported becomes
the card image — pass them in the order you want them shown.

### Before you go live

The product photographs on a supplier listing belong to that supplier. Resellers
are often allowed to use them, but that is a permission to get in writing from
each supplier rather than to assume. Your own shots of your own stock will
convert better regardless.

## Image sizes

A supplier photograph is 1200-1920 px. A product card shows it at 400 and a
colour swatch at 68. Serving the original for both made one product page
**7.5 MB**, which on a phone on 4G is most of your visitors leaving before
anything appears — and if you are paying for the click, leaving after you paid
for it.

`images:import` and `swatches` now write smaller siblings at import time:

```
wedding-kada/01.webp          the original
wedding-kada/01-160.webp      thumbnail strip
wedding-kada/01-400.webp      product card
wedding-kada/01-800.webp      hero on a phone
wedding-kada/01-1200.webp     hero on a desktop
```

The product records which widths exist, and the storefront emits a `srcset`
with a `sizes` that matches the layout. A product without `widths` — imported
before this, or on a machine with no resizer — still renders from the original.

`npm run slugs` shows what each product page costs a visitor, so a heavy one
is visible without opening devtools:

```
  SLUG                             STATUS   IMAGES        PAGE WEIGHT
  wedding-kada                     active   6 image(s)      260 kB
  broad-bridal-bangle              active   6 image(s)      230 kB
```

Anything over 1 MB is flagged `heavy`, and images with no smaller siblings are
counted as `unsized` with the command to fix them.

A replacing import (without `--append`) removes the files from the previous
import, siblings included — otherwise a listing that went from eight
photographs to four leaves four orphans on disk, still reachable by URL.

To backfill:

```bash
npm run images:resize -- --dry-run     # what it would save
npm run images:resize                  # all products
npm run images:resize -- --slug <slug> # one
```

Across the catalogue that was **13.5 MB → 514 kB, 96% lighter**, and the
heaviest product page went from 7.5 MB to about 250 kB.

### Which tool does the resizing

There is no way to re-encode an image in pure Node, and the runtime
dependencies here are two — Express, and the Firestore client, which is only
loaded when that driver is selected. Adding a third for thumbnails was not
worth it, so resizing uses whatever the machine has, picked **per format**:

| Format | Tool |
|---|---|
| WebP | `cwebp` (`brew install webp`), else ImageMagick |
| JPEG, PNG | ImageMagick, else `sips` (ships with macOS) |

`sips` will read a WebP and then silently write nothing when asked for one
back — a resize pass that reports success and changes not a byte. That is why
the choice is per format rather than one tool for everything. With no resizer
at all, imports still work and say what is missing.

A swatch is two things — a 68 px chip and, on click, the hero — so it is stored
at 800 px with 160/320 chips beside it. Importing one smaller than 400 px warns,
because it looks fine as a chip and soft as a hero.

### When the supplier's photo has their own text on it

Listing photographs often carry a spec overlay burnt in — *Wt: 8.40g/pair*,
*Material: Alloy*, dimension arrows. Invisible in a 68 px chip, and obviously
someone else's the moment it becomes the hero. The piece is centred and the
text sits at the edges, so it crops off:

```bash
npm run swatch:crop -- --slug stone-set-drops --variant "Leaf Drop, Blue" --inset 20
npm run swatch:crop -- --slug <slug> --all --inset 20 --dry-run
```

12% was not enough on the real ones — the dimension arrows survived; 20% cleared
them. It is a repair and it throws away real pixels: re-running `swatches`
restores the original, and your own photograph beats both.

## Deploying

```bash
docker build -t oxide-jewelry .
docker run -p 8080:8080 -e PORT=8080 oxide-jewelry
```

There is no build stage — Node runs the TypeScript, so the image is the source.
`PORT` is read from the environment, which is what Cloud Run, Render, Railway
and Fly all set. Image tooling is deliberately left out of the image: resizing
happens when you import a photograph, not when a visitor loads one.

### The catalogue is a filesystem, and a container's filesystem is not real

**Read this before taking an order.** `createOrder` appends to
`data/orders.json` and rewrites the products whose stock changed. On any host
with an ephemeral filesystem — Cloud Run, Render's free tier, Fly without a
volume — that means:

- **Orders vanish on restart.** A container is replaced on deploy, on crash and
  on idle scale-down. Everything written since it started goes with it.
- **Two instances disagree.** Each has its own copy of `data/`. Scale to two and
  one sells stock the other does not know about; deploy again and both are
  replaced by the original files from the image.

The catalogue itself is fine that way — it is written by scripts, baked into the
image, and only read at runtime. **Orders and stock are not.** Before a single
real order:

| Option | |
|---|---|
| **A persistent disk** | Render or Fly with a volume, or a small VM. Nothing in the code changes. |
| **A database behind `Repo`** | **The Firestore driver is written** — `REPO_DRIVER=firestore`. See *Orders, stock and the Firestore driver*. |

Firebase Hosting plus Cloud Run is a perfectly good way to serve this — but
Cloud Run's filesystem is ephemeral, so it needs the second option.

```bash
gcloud run deploy oxide-jewelry --source . \
  --set-env-vars REPO_DRIVER=firestore,GOOGLE_CLOUD_PROJECT=<project>
```

The service account needs Firestore read and write. `npm run firestore:sync`
puts the catalogue there first — the storefront reads an empty shop otherwise.

### Before the first ad

- [ ] `data/business.json` filled in — the server prints what is missing on startup
- [ ] `/privacy.html` and `/contact.html` reachable, which the footer does on every page
- [ ] Orders persisting somewhere that survives a restart
- [ ] Your own photographs, not the supplier's

## Who is selling, and the legal pages

India requires a seller to publish its legal name, address, customer-care
contact and a named grievance officer — Consumer Protection (E-Commerce) Rules,
2020 — and Meta will not run ads to a destination without a privacy policy.

All of it comes from **`data/business.json`**, so the pages, and later the
invoices, read one set of values:

```json
{
  "legalName": "…",
  "address": "…",
  "email": "…",
  "phone": "…",
  "grievanceOfficer": { "name": "…", "email": "…" },
  "policyUpdated": "2026-09-13"
}
```

Until it is filled, the server says so on startup and the pages render the gap
as a visible marker rather than an empty space:

```
  data/business.json is unfilled: legalName, address, email, phone, …
  /privacy and /contact will show placeholders until it is.
  the Meta Pixel is ON while those pages are incomplete — fix before spending.
```

A policy with blanks in it is worse than no policy: it looks like compliance and
names nobody you can complain to.

`/privacy.html` describes **what this code actually does** — the cart in
`localStorage`, the order fields and why each is needed, the eight-year
retention that GST law requires, Google Fonts as the one standing third-party
request, and the Meta Pixel section, which only appears when a pixel is
configured. It says plainly that no payment is taken online and that suppliers
never receive customer details.

What is still missing, because they are your decisions and not facts about the
code: **terms of sale, and a returns and refunds policy** with your own window
and who pays return shipping.

## Where the function runs

`vercel.json` pins `regions` to **`bom1`** (Mumbai). This is not a preference —
it has to match the Firestore location, which is `asia-south1`, also Mumbai.

Vercel defaults new projects to `iad1`, Washington DC. With that default a
request from India arrived at the `bom1` edge, crossed to a function in
Virginia, queried a database back in Mumbai, and returned the same way: every
Firestore round trip going around the planet twice. A single product read
measured **7.9s cold and 1.3s warm**. The header `x-vercel-id: bom1::iad1::…`
is what gives it away — the first code is the edge that took the request, the
second is where the function actually ran. They should match.

Hobby allows one region, Pro five. If the database ever moves, move this with
it. And note `vercel.json` is schema-validated: an unknown key — a `"_comment"`,
say — fails the deployment before the build starts, and the previous
deployment keeps serving, so the symptom is a push that appears to do nothing.

## Orders, stock and the Firestore driver

### The two things that had to be fixed first

**A cart line used to scan the catalogue.** Pricing a cart paged the products
with `perPage: 100` and searched that page in memory — a full listing per cart
line, and a valid SKU on the 101st product came back as *unknown sku*. `Repo`
now has `getVariantBySku`, which is one read in both drivers. There is a test
that builds 120 products and looks up the last one.

**Two buyers could both take the last piece.** Quoting and ordering are two
round trips, so stock can move in between; `createOrder` trusted the quote.
It now re-checks at write time and throws `InsufficientStock`, which the API
returns as **409** — the request was fine, the world changed under it.

In the JSON driver the check and the decrement run with no `await` between
them, so nothing interleaves *within one process*. Across processes it cannot
be safe — two containers each hold their own `data/`. That is not a limitation
to work around; it is the reason the next section exists.

### `REPO_DRIVER=firestore`

```bash
npm run firestore:sync -- --dry-run    # what would go up
npm run firestore:sync                 # push data/ into Firestore
REPO_DRIVER=firestore npm start
```

Set `GOOGLE_CLOUD_PROJECT`, or `FIRESTORE_EMULATOR_HOST` to work against the
emulator. The client is imported lazily, so the JSON path never loads it and a
machine with no credentials still runs.

The catalogue stays authored in files — editing a product should be a diff you
can read — and `firestore:sync` is how it reaches the database the storefront
serves from. **Orders are never synced**, in either direction: they are written
by customers, and pushing `data/orders.json` over them would lose real ones.

### The private record moves too

`data/sourcing.json` is the half of your data you cannot rebuild from the
catalogue: who supplies each piece, their part number per SKU, and the whole
cost stack. It is also the half that changes every time you import — so on a
host with no real filesystem it is the first thing you lose.

```bash
npm run firestore:sync -- --sourcing --dry-run
npm run firestore:sync -- --sourcing
```

It goes to a `sourcing` collection, one document per product. `firestore.rules`
denies every client read, and no route touches it — the scripts reach it with
server credentials. That rule is the only thing between a project id and a list
of what you pay and to whom, so do not loosen it to "just for the admin page".

The scripts pick their driver from `REPO_DRIVER` unless `SOURCING_DRIVER` says
otherwise, so one variable moves the catalogue and the private record together
and they cannot end up in different places by accident.

```bash
REPO_DRIVER=firestore npm run sourcing -- --sku JHU-SILVER
```

**`data/costs.json` and `data/business.json` stay as files.** They are
configuration — you edit them, commit them, and the image ships them. Sourcing
is data. Confusing the two is how a deploy silently reverts your freight rates,
or how your supplier list ends up in a git repository.

### Three things that changed shape rather than being translated

Firestore is not a relational database, and a driver that pretends otherwise
works on fifteen products and falls over on five hundred.

| | |
|---|---|
| **`priceFrom`** | The API sorts and filters on the cheapest variant, which lives inside an array. Firestore cannot compute that, so it is written alongside and kept in step on every write. |
| **`keywords`** | There is no substring matching. Title, tags, material and variant labels are tokenised and queried with `array-contains`, so *jhumka* matches and *jhum* does not. Real search means Algolia or Typesense. |
| **`variantsBySku`** | A collection mapping SKU to product id, so a cart line is one read. Renaming a SKU deletes the old entry. |

Two constraints are visible in the API rather than hidden:

- **A price range plus a name or newest sort orders by price first.** A range
  filter must be the first field ordered. Sorting the page in memory instead
  would be right within that page and wrong across the next one.
- **A search and a tag filter cannot both be indexed** — `array-contains` is
  allowed once per query. Search takes the index and the tag filters the
  returned page, so `total` overstates by the tag's share.

`createOrder` reads every ordered product, checks stock and writes the
decrements and the order in **one transaction**, which Firestore retries on
contention. That is the guarantee the JSON driver cannot make, and the whole
reason to be here.

### What is tested, and what is not

The writes, the SKU index, the renamed-SKU cleanup and the transaction — the
oversell path included — are covered against a stub, because they are our logic.

**The query paths are not.** Composite indexes, `count()` and range-filter
ordering are the database's behaviour, not ours, and a stub that agreed with me
about them would prove nothing. Verify them against the emulator:

```bash
firebase emulators:start --only firestore     # port 8088, set in firebase.json
FIRESTORE_EMULATOR_HOST=localhost:8088 npm run firestore:sync
FIRESTORE_EMULATOR_HOST=localhost:8088 REPO_DRIVER=firestore npm start
```

That needs **JDK 21 or newer** (`brew install openjdk@21`); firebase-tools
refuses to start the emulator on anything older.

`firestore.rules` denies everything. The browser never talks to Firestore — the
Express API does, with server credentials — so there is nothing a client should
be allowed to read. Orders carry customer addresses; one permissive rule would
hand them to anyone with the project id.

## What a piece actually costs

The supplier's price is the smallest part of it.

```bash
npm run cost -- --sku TEM-JHU-PARROT     one variant, every line
npm run cost -- --slug jhumka            a product
npm run cost -- --audit                  everything you sell, against its cost
npm run cost -- --supplier 101 --qty 50  a cost with no catalogue entry
```

```
  GETTING IT HERE
    supplier price                    ₹101.02
    freight from China                 ₹18.00   450/kg
    insurance                           ₹1.14   1.125% of supplier price
    = assessed value (CIF)            ₹120.16
    basic customs duty                 ₹24.03   20%
    social welfare surcharge            ₹2.40   10% of duty
    clearance, per piece               ₹70.00   ₹3500.00 ÷ 50
    LANDED COST                       ₹216.59
    (IGST at the border)               ₹26.39   paid now, credited back — not a cost

  GETTING IT TO THE CUSTOMER
    courier + packaging               ₹104.00
    returns provision                  ₹47.52   18% come back
    COST TO SERVE                     ₹368.11
```

### The breakdown is kept, not recomputed

```bash
npm run price                       # what would move, nothing written
npm run price -- --write --apply    # store the stack and set the prices
npm run price -- --slug jhumka --write --apply
npm run price -- --write --keep-price   # recost, leave prices as they are
```

Every variant carries its whole cost stack in `data/sourcing.json`, in the
order the money moves:

```json
"JHU-SILVER": {
  "supplierSku": "Silver",
  "costPaise": 10102,
  "pricing": {
    "computedAt": "2026-09-13T…", "orderQty": 50, "weightGrams": 40,

    "purchase": 10102,        "shippingIn": 1800,   "insurance": 114,
    "customsValue": 12016,    "duty": 2403,         "surcharge": 240,
    "clearance": 7000,        "landed": 21659,      "igstCredit": 2639,

    "deliveryOut": 10400,     "returns": 4752,      "costToServe": 36811,

    "gst": 12798,             "gateway": 1980,      "commission": 0,
    "margin": 32311,          "marginPct": 45.4,

    "final": 83900
  }
}
```

It adds up exactly — `final` equals cost to serve plus GST plus fees plus
margin, and there is a test that says so. **It lives in the private file**,
because it names what you pay and to whom; only `final` reaches the catalogue,
as the price on the page.

A price you set by hand is not overwritten. It is recorded with
`manualOverride: true` and its *actual* margin recalculated, so the next audit
can tell a deliberate price from a stale one.

`product:add` writes the stack at import, so a new product arrives costed and
`npm run price` has nothing to catch up on. Re-run it whenever
`data/costs.json` changes — a new freight quote, a budget that moves duty, or
your first month of real return data. Everything is derived and can be rebuilt.

### Two things the model insists on

**IGST at the border is not a cost.** You pay it on import and credit it
against the GST you collect. It is working capital locked up for a month or
two, and it belongs in a cash-flow line — not in the number you price against.
Basic customs duty and the surcharge on it *are* costs: there is no credit for
either. Mixing the two overstates cost by about a fifth and pushes prices up
for no reason.

**Margin is a share of revenue, not a multiple of cost.** Gateway fees come off
the gross the customer pays, GST is a share of it, and margin is a share of
what is left — so the price appears on both sides and is solved, not guessed:

```
P · [ (1 − margin) / (1 + gst) − fees ] = cost to serve
```

An unreachable target — a 99% margin once GST and fees are out — is refused
rather than silently missed.

### Why the old "× 6" was wrong

Freight, clearance, the courier and the returns provision are largely **fixed
per piece and per order**. They fall hardest on cheap stock, which is exactly
where a multiplier looks safest:

| | Supplier | × 6 said | Model says | |
|---|---|---|---|---|
| Temple Jhumka | ₹58.85 | ₹359 | **₹719** | sold at a loss |
| Filigree Chandbali | ₹101.02 | ₹609 | **₹839** | 10% margin, not 45% |

Running `--audit` over the catalogue as it stood: **49 of 59 priced variants
were below the model and 6 were sold at a loss.** The multiple the model ends
up at is 12–13× on a ₹59 earring and far less on a ₹400 bangle — which is the
point. There is no single multiplier that is right for both.

### The assumptions are yours

Every rate lives in **`data/costs.json`** and every one of them is a number you
should check against your own broker and courier, not take from here:

| | |
|---|---|
| `basicCustomsDutyPct` | 20, for HS **7117** (imitation jewellery). Duty rates change with each Union Budget, and a different heading is a different duty — confirm with your customs broker. |
| `freightPerKg`, `clearanceFeePerShipment` | from your forwarder's actual quote |
| `returns.ratePct` | 18 as a placeholder. Fashion jewellery sold D2C in India commonly runs 15–25% prepaid and much worse on COD — replace this with your own data the week you have any. |
| `igstCreditable` | true assumes you are GST-registered. If you are not, set it false and watch the price move. |
| `targetMarginPct` | 45% of net revenue |

`scrape` and `onboard` price new imports from this model rather than a
multiplier, so an import and `npm run cost` can never disagree. Pass
`--weight <grams>` when you know it: freight is charged by weight and duty is
charged on freight, so the default of 40 g is doing real work.

## The admin page

`/admin.html` — the only page on the site that shows cost, margin and customer
details. It is not linked from anywhere and carries `noindex`; `robots.txt`
disallows it.

**It needs `ADMIN_TOKEN`, and without one the page tells you so** rather than
showing a sign-in that cannot succeed. `npm run dev` reads `.env` (Node reads it
directly — there is no dotenv package, and `.env` is gitignored), and prints a
token you can paste when none is set:

```bash
echo 'ADMIN_TOKEN=...' >> .env    # the server prints a generated one on boot
npm run dev
```

`cp .env.example .env` is the other way in. Sign in with that token. It lives in `sessionStorage` and is gone when the tab
closes, unless you tick **Stay signed in on this device**, which puts it in
`localStorage` — worth thinking about on a phone, because the way to revoke it
is changing `ADMIN_TOKEN` and restarting, which signs out every device at once.

**Unset `ADMIN_TOKEN` means the admin API does not exist** — every route
answers 404, as though it were never mounted. A deploy that forgets the
variable therefore exposes nothing, and the failure is visible (you cannot sign
in) rather than silent (anyone can). Wrong guesses are compared in constant time
and throttled per address after eight attempts.

### Overview

Visits, orders, booked revenue and live pieces; a bar a day, brass where a day
took an order; then **Needs attention** — sold out, nearly gone, *nobody opened
these*, and search terms that found nothing. That last pair is the useful half:
a piece nobody opened is not selling badly, it is not being seen, and a term
people typed that returned nothing is what they came for and you do not stock.

### Pieces

The table this page exists for: **funnel, price, stock and margin on one row**.

```
PIECE                        PRICE   MARGIN  STOCK  VIEWS  COLOUR  ADDS  ADD %  ORDERS  EARNED
Gold-Plated Bridal Set      ₹4,639   45.1%      10     96      63     9   9.4%       4  ₹7,499
Gold-Plated Openable Bangle ₹1,079  not costed  50     98      79     7   7.1%       0       —
```

Each column alone leads to a wrong decision — a piece with a good add rate and
no stock, or one selling steadily at a margin that does not cover its returns,
both look fine in any report that shows one of them. Analytics live in
`data/analytics/`, prices in the catalogue and costs in `data/sourcing.json`,
and this is the only place the three are joined.

Margin is the **lowest** across a piece's colourways, not the average: a set is
only as good as the variant people actually pick. A piece with no recorded cost
says **not costed** rather than `0%` — "nobody has told the costing model what
this cost" is a different fact from "sells at no profit". Every column sorts.

**Click any row** and it opens on what you need to reorder that piece:

```
Original listing ↗   Yiwu Xiacheng Import And Export Co., Ltd.

COLOURWAY          OUR SKU           THEIR SKU          THEIR REF       COST    PRICE  MARGIN  STOCK
second row Silver  RHI-COL-SECOND    second row Silver  107472995044    ₹234   ₹1,219   45.1%     10
five row Silver    RHI-COL-FIVERO    five-row Silver    107472995040    ₹391   ₹1,669     45%     10
```

Your SKU beside theirs, their internal reference, and a link back to the
listing. Reordering without this means opening two files and matching SKUs by
hand. A SKU cell selects whole on one click, because these get pasted into a
supplier conversation.

**`cost ↓` on any colourway opens the whole stack**, per piece, in the order the
money moves:

```
GETTING IT HERE                          GETTING IT TO THE CUSTOMER
What the supplier charges        ₹234    Delivery and packaging           ₹104
Freight to India  40 g at ₹450/kg ₹18    Returns provision  18% come back  ₹53
Insurance  1.125%                  ₹3    Cost to serve                    ₹538
─────────────────────────────────────
Customs value (CIF)              ₹255    WHAT THE SALE DOES
Basic customs duty  20%           ₹51    Price on the page  GST incl.   ₹1,219
Social welfare surcharge  10%      ₹5    GST you collect and remit 18%   −₹186
Clearance  share of one shipment  ₹70    Payment gateway  2.36%           −₹29
─────────────────────────────────────    Cost to serve                   −₹538
Landed — in your hands           ₹381    ═════════════════════════════════════
IGST at the border  creditable    ₹56    Margin                    ₹466 · 45.1%
```

That layout is the argument. **A single "cost" number is what talks an import
business into a price that loses money** — here the freight, duty and clearance
add ₹147 to a ₹234 piece, and the returns provision costs half what delivery
does. Border IGST is shown in green and excluded from the stack because it is
creditable against output GST: it is funded, not spent, and counting it as a
cost prices you 18% above where you need to be.

Margin is a share of the price **net of GST**, not a multiplier on cost —
₹466 on ₹1,033 is 45.1%, not 45% of ₹538. Rates come from `data/costs.json`
and every one of them is an assumption you own.

**This is the only screen in the project where any of that appears.**
`data/sourcing.json` is gitignored, no public route reads it, and the storefront
has no word for where a piece came from — that separation is why sourcing does
not live on the product in the first place. This page does not weaken it; it is
the one side of the wall where you are allowed to look.

### Discounts

Open a piece and set a percentage. The sale starts immediately, or on a date,
and ends on a date if you give one — an ended sale needs no action; the field is
simply no longer live.

```
DISCOUNT  LIVE
% off [ 15 ]   Reason shown to buyers [ Launch week ]   Ends [ 30/09/2026 ]   [Update] [End it]
Saved. Live now — margin 35.9%.
```

The storefront then shows **₹1,036** with **₹1,219** struck through and a
`SALE` badge, and the cart charges ₹1,036 — the catalogue route and the cart
quote call the same function, so the price on the page and the price you are
charged cannot drift apart.

**There is no field for the struck-through price, and there cannot be.** It is
the list price already stored in the catalogue — the price being charged the day
before the sale and again after it. Typing a higher one to make the saving look
bigger is a misleading price representation under the **Consumer Protection Act
2019**; where a piece carries a printed MRP, overstating it also breaches the
**Legal Metrology (Packaged Commodities) Rules**; and the CCPA's **2023 dark
patterns guidelines** name the practice directly. The type has no field for it,
so the shop cannot express one.

Which means a discount comes out of margin, and the page says so before you
commit:

| | |
|---|---|
| No discount | 45.1% |
| 15% off | **35.9%** |
| 45% off | **2.2%** — under the 25% floor |
| 60% off | **−33.4%** — a loss on every one sold |

`floorMarginPct` in `data/costs.json` is what the warning compares against. It
warns rather than blocks: a loss-leader is sometimes deliberate, and what is
never fine is not knowing.

Two details that matter more than they look. A sale price **rounds down** to the
rupee, because rounding up makes the reduction smaller than the one advertised —
"20% off" has to mean at least 20% off. And `withDiscount()` is **idempotent**:
two routes apply it, and the day one is composed with the other, a second pass
would take 15% off 15% off and nobody would notice until the month's takings
came up short.

### Stock, price and taking a piece down

Stock and price are **editable in the colourway table** — they save on blur,
because this is the screen you are on with a courier on the phone and a Save
button you have to find after typing is a button that gets missed. Price is
entered in rupees and stored in paise; a price over ₹10,00,000 is refused as a
missing decimal point rather than published.

`Listing` sets **active / draft / archived**. Draft and archived both take the
page down: its URL returns a real 404 and it leaves the grid. Nothing is deleted.

> Found while building this: a product set to `draft` was **still served** on
> its public URL — the route refused `archived` and let `draft` through. Taking
> something down removed it from the grid and left its page working for everyone
> holding the link. Fixed, along with the soft 404 behind it.

Titles, taglines and descriptions are editable from here too. SKUs, images and
categories are not — those move files around, and belong in `npm run edit` where
a mistake is visible and reversible in a terminal.

### Orders

Search by **reference, name, phone, email or PIN** — the five things you have
when somebody rings up — and filter by status. Filtering happens in the browser
against the list already in hand, so it answers as you type.

**Packing slip** opens a print-ready A5 slip in its own window: address in a
box, items with SKUs, and a line reminding whoever packs it that payment is
arranged by phone and not collected on delivery. **Export CSV** downloads every
order for GST filing and courier bulk upload, with a BOM so Excel on Windows
opens rupee signs and Indian names correctly.

**What the customer sees** opens their tracking page, so you are looking at the
same screen they are while you talk to them.

Reference, customer, address, lines, and a status — `pending → paid → shipped`,
or `cancelled`. **Status is the only field that can be changed.** Everything
else on an order is what was agreed at the time, and editing that after the fact
is how a dispute becomes unanswerable.

**Cancelling does not put stock back.** What came off the shelf when the order
was placed may already be in a box; returning it is a stock adjustment you make
when the piece is physically back, with `npm run edit -- <slug> --stock`.

This is the one page that renders text a stranger typed — names, addresses,
phone numbers. Every value is escaped on the way into the DOM, with no
exceptions, and there is a test that injects a `<script>` tag into a customer
name to keep it that way.

## What each page and piece actually does

The Meta Pixel answers "did the ad work", and only while an ad is running. This
answers the question you have every day:

```bash
npm run stats               # the last 30 days
npm run stats -- --days 7
npm run stats -- --prune    # delete counter files past the retention window
```

```
  PIECES

  SLUG                                 VIEWS  COLOUR  ADDS  CART  ORDERS   ADD %   BUY %
  wedding-kada                            94      61    12     7       3     13%      3%
  gold-plated-jewellery-set               41      11     0     0       0       —       —

  49 live piece(s) nobody opened in 30 days
  1 search term(s) never found anything: kundan
```

The last two columns are the point. Views tell you what a post or an ad sent;
**add rate** tells you whether the page earned the click. A piece with a hundred
views and no adds is a photograph, price or description problem — not a traffic
problem, and buying more traffic will not fix it. Two lines under the table are
worth more than the table: pieces **nobody opened**, which are not failing to
sell but failing to be seen, and **searches that found nothing**, which is a
list of what people came for and you do not stock.

`COLOUR` counts colourway clicks. On a kada sold in nine identical-priced
patterns, that column is the only thing that says which three to reorder.

### What is collected

Counters, not a log. There is no event table, no session id on disk, no IP
address, no user-agent and no cookie. A day is `data/analytics/2026-09-13.json`
— a set of numbers that **cannot be taken apart into people**, which is a design
choice and not an oversight: an event log becomes personal data under the DPDP
Act 2023 the moment it is re-identifiable, and it is not worth holding for a
dashboard. The client honours `Global Privacy Control` and `Do Not Track` by
sending nothing at all, and `/privacy` describes the collection only while it is
switched on, driven by the same config the server runs on.

`ANALYTICS=off` stops collection entirely.

### What a browser is allowed to say

`POST /api/events` is open to the internet, so it assumes every field is
hostile — and everything that survives becomes `+1` on a counter, so there is
nowhere for an injected value to land except as a number.

| | |
|---|---|
| Event names | a fixed allow-list; anything else is dropped whole |
| Slugs | checked against the catalogue, so a probe cannot create a key |
| Paths | folded to the pages this shop has; everything else becomes `/other` |
| Strings | capped, and dropped rather than truncated when oversized |
| Batches | 20 events, 30 events a minute per address |
| Bots | obvious crawler user-agents are answered 204 and counted nowhere |

**A browser cannot report revenue.** `orders`, `units` and `revenue` are written
by the order route when an order is actually created — no client event touches
those three numbers. Views and adds are worth spoofing to nobody; sales are.

### Reading it over HTTP

```
GET /api/stats?days=30          Authorization: Bearer $ADMIN_TOKEN
GET /api/stats/daily?days=30    one row per day, for a chart
```

**Unset `ADMIN_TOKEN` means the endpoint does not exist** — 404, not open. The
failure that costs you is publishing what sells and for how much; being locked
out of a report you can also get with `npm run stats` costs you nothing.

`ANALYTICS_DRIVER` follows `REPO_DRIVER` unless set, so Firestore deployments
keep one document per day in an `analytics` collection.

## Measuring an ad campaign

Nothing third-party loads until you set a pixel id. No requests, no advertising
cookies, no consent banner on a site that is not running ads.

```bash
META_PIXEL_ID=1234567890 npm start
```

The server puts it in `/config.js`, which the static pages read — that is how
anything environment-dependent reaches the storefront without a build step.

| Event | Fires |
|---|---|
| `ViewContent` | a product page renders |
| `SelectVariant` | **a colourway is clicked** |
| `AddToCart` | added, with the variant in `content_name` |
| `InitiateCheckout` | the checkout summary loads |
| `Lead` + `OrderPlaced` | an order is submitted |

**`SelectVariant` is the one worth having.** Nine kada patterns are priced
identically because there was nothing to price them on. Which one a visitor
clicks first is the only thing that tells you which three to actually order,
and the MOQ is two pieces.

Placing an order fires `Lead`, not `Purchase`: no money has changed hands, the
order is a request confirmed by phone, and reporting it as a sale would put
revenue in Meta's dashboard that nobody has been paid. Change it to `Purchase`
on the day a gateway actually captures.

To check the wiring without a pixel, add `?debug=analytics` and watch the
console — every event is logged whether or not a pixel is configured:

```
[analytics] ViewContent   {content_name: Gold-Plated Wedding Kada, value: 1079, …}
[analytics] SelectVariant {variant_label: Fan Jaali, variant_index: 1, in_stock: true}
[analytics] AddToCart     {content_name: Gold-Plated Wedding Kada — Fan Jaali, value: 1079}
```

The usual way this goes wrong is silently: the pixel fires on `PageView`, you
assume the rest works, and three weeks of spend later there is no `AddToCart`
data at all.

### Before you spend money

The checklist is under **Deploying → Before the first ad**. The one that is not
a code change: **the ad creative is the supplier's photographs**, some with
another seller's display cards and a model's face in frame. On your own site
that is untidy; in a paid ad it is a rights problem you are publishing.

## Catalogue data

`data/products/` holds one JSON file per piece, written by `npm run onboard`.
**`npm run seed` no longer writes any products** — it creates the category list
and an empty `data/products/`, and leaves an existing `data/categories.json`
alone unless you pass `--force`. It used to seed ten sample pieces with invented
prices and invented stock; a command that can put fiction back into a live
catalogue is not worth the convenience.

Prices are in paise in the JSON. Edit `data/products/<slug>.json` directly, or go
through the repo.

## Colourways

Listings that sell one piece in many colours carry a photograph per colourway.
`scrape` collects them and `swatches` attaches them:

```bash
npm run swatches -- --slug jhumka --from intake/<id>.json --add-missing
```

`--add-missing` creates variants for colourways the product does not have yet,
priced from the cheapest existing variant and at **stock 0** — so they appear on
the page, struck through, until you set stock.

The swatches are full product photographs rather than colour chips, so the page
shows them large and `contain`ed and swaps the main image on selection. A 46px
`cover` crop of a photo shot on white shows nothing but white.

Matching is by variant label, then by any one segment of it — a variant called
`Silver / Small` still finds the `Silver` swatch. The script reports how many
**attached**, not how many downloaded, and names any swatch that matched
nothing; those two numbers came apart silently once and reported success.

The file is named after the label it was imported under, so a variant that
arrived as `FX916-2` is served from `swatch/fx916-2.webp`. `npm run edit --
<slug> --rename "FX916 2=Gold Mini Hoop Mix"` moves the file too, which is what
keeps the supplier's part numbers out of your public URLs.

## One file per product

The catalogue lives in `data/products/<slug>.json`, one file per piece:

```
data/products/jhumka.json
data/products/ethnic-retro-carved-jhumka.json
data/categories.json          small and shared — stays one file
data/orders.json              append-only — stays one file
```

A single products.json stops being editable somewhere around the fiftieth
product. Per-file means you can open one piece, diffs name the product that
changed, and two people editing different products never collide.

Writes are atomic per file, the cache re-reads a file when its mtime moves, a
slug rename moves the file, and one malformed file is skipped with a warning
rather than taking the whole catalogue down.

To migrate an older single-file catalogue: `npm run migrate:split`.

## Your label, not the supplier's

```bash
npm run debrand -- --brand "Moteeka"      # all products
npm run debrand -- --slug <slug>           # just one
npm run debrand -- --dry-run               # see what would move
```

A scraped listing arrives carrying the manufacturer's brand, model number and
sourcing detail. `debrand` moves all of it into the private sourcing record and
leaves the genuine specification — material, plating, dimensions, stones —
behind, then stamps your own brand on.

On the chandbali that took the spec table from 17 rows to 12: *Place of Origin*,
*Brand Name*, *Model Number*, *Certificate Type* and *Supplier MOQ* all moved
out of public view.

It also drops rows that are noise rather than sourcing:

| Dropped | Why |
|---|---|
| `Diamond shape: Other`, `Religious Type: Other` | a listing fills every field its category offers, so half come back saying *Other* — a row that only tells a buyer the form had a box. `None` is kept, because it answers the question |
| `provide mould making and sample making service` | wholesale plumbing, not a product spec |
| `Material Type: Zinc Alloy` when material is already *Zinc Alloy* | the page prints material and finish above the table; a row repeating either is the same answer twice |

Run it again and nothing moves twice — a `Brand` already equal to yours is read
as your own stamp from the previous run, not the manufacturer's.

**Country of origin is moved, not deleted.** It is a mandatory declaration on
Indian marketplace listings and on the package under the Legal Metrology
(Packaged Commodities) Rules. It lives in `data/sourcing.json` so you have it
when filling those in — it simply stops being part of your product copy.
Declaring imported goods as Indian-origin is a Legal Metrology and customs
matter, not a marketing choice, so the accurate value is kept.

## Fulfilling an order

Your catalogue shows **your** SKU and your brand and nothing about who makes
the piece. That is the whole point of de-branding — and it creates a problem
the first time someone actually buys something: an order says
`HOO-STU-GOLDMI`, and the supplier has never heard of it.

So the import records the other half privately, keyed by your SKU:

```bash
npm run sourcing -- --sku HOO-STU-GOLDMI
```

```
  HOO-STU-GOLDMI  —  Hoop & Stud Earring Set, Gold Mini Hoop Mix
  you sell at   ₹929.00   (10 in stock)
  order from    «supplier name»
  their code    «their part number»
  their sku id  «their listing id»
  their price   ₹153.98
  listing       «listing URL»
```

```bash
npm run sourcing -- --slug hoop-earring-set   # the whole product
npm run sourcing -- --audit                   # every product, gaps flagged
```

`--audit` exits non-zero when any variant has no supplier reference, so it
works as a pre-launch check: a variant listed there is one you could sell and
then not be able to fill.

### Renaming must not break the link

`--rename` and `--resku` change the SKU an order will carry. Both re-key the
reorder table at the same time, and say so:

```
  5 supplier reorder reference(s) followed the new SKUs
```

Without that, cleaning up `EAR-GOL-FX9161` into `GOL-PLA-RIBBED` would have
quietly orphaned the only record of what to reorder. `--resku` is refused
outright once a SKU appears in `data/orders.json`, for the same reason.

### Backfilling a product imported before this existed

```bash
npm run sourcing -- --link <slug> --from ./captured/<id>.json        # preview
npm run sourcing -- --link <slug> --from ./captured/<id>.json --yes  # write
```

It pairs each catalogue variant with a listing one **by label first**, then
fills the rest **by position**, and marks every row with which it used:

```
  = HOO-STU-GOLDMI    Gold Mini Hoop Mix        →  FX916-2
  ? BAN-GOL-STAR      Star Jaali                →  Design 1 One Piece

  11 matched by label (=), 1 guessed by position (?)
  a ? row is a guess. Wrong here means you reorder the wrong thing.
```

Nothing is written without `--yes`. That gate earned itself immediately:
pairing a hand-built product by position produced `Silver → Green`, which is
exactly the kind of error you would only find out about after shipping the
wrong piece to a customer.

## Keeping sourcing private

Who supplies you is not on the product and not in the API. It lives in
**`data/sourcing.json`**, which is gitignored and read by no route:

```
data/products/        public catalogue, one file per slug — served by the API
data/categories.json  public
data/business.json    public — who is selling, for the legal pages
data/orders.json      customer names and addresses  (private, gitignored)
data/sourcing.json    supplier, listing URL, their part number per SKU
                                                    (private, gitignored)
html/ captured/ intake/                             (private, gitignored)
```

`.dockerignore` excludes `data/orders.json` and `data/sourcing.json` from the
image as well: neither is needed to serve the shop, and neither belongs in
something you push to a registry.

`npm run product:add` and `npm run scrape` split the two automatically. Nothing
in the storefront, the API responses or the page markup names where a piece came
from.

## Editing products

`npm run edit` is how a product changes after it exists. `npm run slugs` lists
what you can target — a slug or an id.

```bash
npm run edit -- <slug|id> [changes]
```

### Publishing and placement

```bash
npm run edit -- <slug> --status active            # draft | active | archived
npm run edit -- <slug> --category jhumka          # move between categories
npm run edit -- <slug> --featured                 # or --not-featured
npm run edit -- <slug> --slug shorter-name        # rename
```

Renaming a slug moves the image folder and rewrites **every stored path** — the
gallery and each variant's swatch. It rewrites the leading path segment rather
than matching the old slug, so a path that drifted out of sync in an earlier
rename is repaired rather than left behind. Forgetting the swatches is the
version of this bug you do not see: the gallery still renders and only the
colour chips break.

### Copy and specs

```bash
npm run edit -- <slug> \
  --title "Hoop & Stud Earring Set" \
  --tagline "A card of hoops, studs and pearls — twelve sets to choose from" \
  --description "A whole card of earrings in one buy: chunky hoops, twisted …" \
  --material "Alloy" \
  --finish "Gold or silver plated, depending on the set" \
  --tags "earrings,hoops,studs,pearl,set,gifting"
```

`--material` and `--finish` are the two spec rows printed above the table.
`--tags` is comma-separated and drives search and the related-pieces rail, so
an untagged product is invisible to both.

### Price and stock

```bash
npm run edit -- <slug> --price 1079 --stock 25              # every variant
npm run edit -- <slug> --sku HOO-STU-GOLDTW --price 929 --stock 6
```

`--sku` narrows `--price` and `--stock` to one variant; without it they apply
to all of them.

### Variants

```bash
npm run edit -- <slug> --rename "Design 1=Star Jaali" --rename "A 5=Silver Checkerboard"
npm run edit -- <slug> --resku
```

**`--rename` exists because you cannot name a pattern you have not seen.** An
import happens before you look at the photographs, so it names variants
`Pattern 1`…`Pattern 9` and you fix them afterwards. It matches on the current
label *or* the SKU, and refuses with the full variant list if neither matches.

Renaming also moves the swatch **file** to match: a variant imported as
`FX916-2` had its chip served from `/images/<slug>/swatch/fx916-2.webp`, which
left the supplier's part number in a public URL long after the label was fixed.
It becomes `gold-mini-hoop-mix.webp`.

`--resku` rebuilds every SKU from the current labels — `EAR-GOL-FX9161` becomes
`HOO-STU-GOLDTW`. A SKU is what an order points at, so it is **refused outright
if any SKU on the product appears in `data/orders.json`**.

It does not, and cannot, reach a cart: a cart lives in the customer's browser
and holds SKUs. Anyone holding an old one sees that line as *no longer
available* with a Remove button, and the rest of their cart still prices — see
below.

### Every flag

| Flag | |
|---|---|
| `--status draft\|active\|archived` | publish or unpublish |
| `--slug <new>` | rename; moves images and swatches with it |
| `--category <slug>` | move between categories |
| `--title "..."` | the product name |
| `--tagline "..."` | one line under the title |
| `--description "..."` | the paragraph under the price |
| `--material "..."` | spec row |
| `--finish "..."` | spec row |
| `--tags a,b,c` | search and the related rail |
| `--rename "old=new"` | rename a variant by label or SKU; repeatable |
| `--resku` | rebuild SKUs from labels; unsold products only |
| `--price <rupees>` | all variants, or one with `--sku` |
| `--stock <n>` | all variants, or one with `--sku` |
| `--sku <SKU>` | narrow `--price`/`--stock` to one variant |
| `--featured` / `--not-featured` | home page placement |

## Every command

Every URL below assumes the default port; `PORT=3000 npm run dev` moves it.

```bash
# running
npm run dev                  # http://localhost:4000, restarts on change
npm start                    # server, no watch
npm test                     # the suite
npm run typecheck            # tsc --noEmit

# looking
npm run slugs                # every product: slug, status, images, page weight
npm run sourcing -- --audit  # every variant: can this be reordered?
npm run images:resize -- --dry-run   # page weight, before and after
npm run sourcing -- --sku <SKU>    # an order arrived — what do I order?
npm run cost -- --audit      # is anything priced below what it costs?
npm run price                # recost everything against data/costs.json

# importing — see "Adding a product from a listing URL" above
npm run onboard -- ./captured/<id>.json --category <slug> --brand <name> --activate
npm run edit -- <slug> --tagline "..." --rename "Pattern 1=..." --stock 25

# the steps onboard runs, for when one needs redoing alone
npm run scrape -- ./captured/<id>.json --category <slug> --qty 20 --markup 6
npm run product:add -- intake/onboard.json
npm run images:import -- --slug <slug> --url <a> --url <b>
npm run swatches -- --slug <slug> --from intake/onboard.json --add-missing
npm run debrand -- --brand <name>          # --dry-run to preview, --slug for one
npm run describe -- --write --specs        # page copy + tidy the spec tables
npm run stats                              # pages, pieces, searches, referrers
npm run stats -- --prune                   # drop counter files past retention
npm run firestore:sync -- --sourcing --dry-run   # push data/ into Firestore

# odds and ends
npm run extract -- ./html/page.html        # image URLs out of a saved HTML page
npm run images:resize                      # backfill responsive sizes
npm run hero -- --slugs a,b,c,d,e          # rebuild the home page hero
npm run brand                              # icons and the share card
npm run seed                               # category list into an empty data/
npm run migrate:split                      # one-off: products.json → products/
```

**`npm run <script> -- $VAR` does not work** when `$VAR` holds several flags — npm
mangles the passthrough and the arguments arrive as one string, or not at all.
Call the script directly for anything built up in a shell variable:

```bash
node scripts/import-images.ts --slug <slug> --url <a> --url <b> --url <c>
```

## Editing the catalogue by hand

`data/products/<slug>.json` can be edited while the server is running — the store
compares the file's mtime on every read, so a change is picked up on the next
request without a restart. That is how you flip a new product from `draft` to
`active`.

## Configuration

| Variable | Default | |
|---|---|---|
| | | `npm run dev` and `npm start` read these from `.env` if it exists |
| `PORT` | `4000` | |
| `REPO_DRIVER` | `json` | `firestore` for a host with no real filesystem; `postgres` once that driver is written |
| `GOOGLE_CLOUD_PROJECT` | *(unset)* | required by the Firestore driver (`FIRESTORE_PROJECT_ID` also accepted) |
| `FIRESTORE_EMULATOR_HOST` | *(unset)* | e.g. `localhost:8088` |
| `SOURCING_DRIVER` | follows `REPO_DRIVER` | split the private record from the catalogue, if you ever need to |
| `TAX_RATE` | `0.18` | Imitation jewellery is 18% GST; 3% applies to precious metal |
| `FREE_SHIPPING_OVER` | `99900` | ₹999, in paise |
| `SHIPPING_FLAT` | `7900` | ₹79, in paise |
| `META_PIXEL_ID` | *(unset)* | Unset means no third-party script loads at all |
| `ANALYTICS` | `on` | `off` stops first-party collection entirely |
| `ANALYTICS_DRIVER` | follows `REPO_DRIVER` | where the daily counters live |
| `ANALYTICS_RETENTION_DAYS` | `400` | what `npm run stats -- --prune` considers old |
| `ADMIN_TOKEN` | *(unset)* | **Unset means `/api/stats` returns 404**, not that it is open |
| `TZ_SHOP` | `Asia/Kolkata` | the day boundary — a sale at 11pm IST belongs to that day, not UTC's |
| `ORDER_WEBHOOK_URL` | *(unset)* | **Unset means nobody is told an order arrived.** One HTTPS POST per order |
| `ORDER_WEBHOOK_SECRET` | *(unset)* | sent as `X-Webhook-Secret`, so the receiver can tell it is you |

Costing assumptions are data, not environment — see `data/costs.json`.

## Selling imported jewellery in India

Two things that catch importers out, neither of them code:

- **Do not call it silver unless it is.** "Oxidised silver" in this trade almost
  always means silver-*plated* brass. Articles sold as silver attract BIS
  hallmarking obligations; imitation jewellery does not. Describe it as
  *oxidised brass* or *silver-plated*, and keep the plating spec the supplier
  gave you.
- **Imported goods need a declaration** under the Legal Metrology (Packaged
  Commodities) Rules — importer name and address, country of origin, MRP, net
  quantity and consumer-care contact, on the pack. Country of origin is also
  mandatory on Indian marketplace listings. Ask the supplier for the HS code
  (imitation jewellery is usually 7117) since it sets your customs duty.

Neither is legal advice — confirm both with your CA or customs broker.

## Tests

```bash
npm test
npm run typecheck
```

34 tests, no test framework — `node --test` and `node:assert`.

| File | |
|---|---|
| `test/api.test.ts` | the repository: filtering, sorting, paging, per-file storage, SKU lookup past the first page, the oversell guard |
| `test/analytics.test.ts` | the counters: the allow-list, slug and path bounding, that a browser cannot report revenue, the shop's day boundary |
| `test/admin.test.ts` | the admin write path: that a status change moves nothing else, that cancelling does not restore stock |
| `test/discount.test.ts` | discounts: that the struck-through price can only be the stored one, that applying twice does not discount twice, that a sale ends on its own |
| `test/reviews.test.ts` | ratings: that no reviews means no stars, that a pending review counts for nothing, that a rating outside 1–5 is clamped |
| `test/live.test.ts` | presence: that a heartbeat is not a second visitor, that it is per piece, that a visit which goes quiet drops out |
| `test/notify.test.ts` | the order webhook: that it carries what you need to act, that money crosses as rupees not paise |
| `test/share.test.ts` | share cards: absolute image URLs, out-of-stock in structured data, no aggregateRating without real reviews |
| `test/describe.test.ts` | the page copy: plurals and articles, what it refuses to claim, that cleaning the spec table is idempotent |
| `test/firestore-repo.test.ts` | the Firestore driver's writes, SKU index and stock transaction, against a stub |
| `test/naming.test.ts` | deriving a product name from listing attributes; spotting labels that are still supplier codes |
| `test/sourcing.test.ts` | a SKU rename carrying its supplier reference with it |
| `test/supplier-payload.test.ts` | parsing a captured listing: variant labels, swatches, source URL |

Several of these exist because the bug happened first. The SKU-lookup test
builds 120 products because the old code stopped finding them at 100; the
swatch tests exist because a rename once left twelve broken images on a page
whose gallery still looked fine.

## Not built yet

In rough order of what blocks selling:

| | |
|---|---|
| **Payments** | Checkout records an order and stops. You confirm and take payment by phone, which the contact page says plainly. |
| **Terms and returns** | Your decisions — the window, and who pays return shipping — not facts about the code. |
| **Your own photographs** | The supplier's carry another seller's display cards. Fine on your own site, a rights problem in a paid ad. |
| **Admin UI** | The catalogue is edited by `npm run edit`. That is fine for one person and not for two. |
| **Auth** | There are no accounts. Nothing needs one until there are payments. |
| **Real search** | `keywords` matches whole words. Prefix and typo tolerance means Algolia or Typesense. |
| **Postgres driver** | The schema is written; the driver is not. |

Each is an addition against the existing seam rather than a rewrite.
