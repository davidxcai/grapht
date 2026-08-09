# Product identity and target derivation

How a product gets from "the bottle in your hand" to a set of analysis concern
keys in `Intervention.targets[]`. The attribution rules that consume those keys
are in [`trial-model.md`](trial-model.md); this doc is about how the keys get
filled in without the user typing fifteen checkboxes by hand.

Status: **designed, partially built.** `src/products.mjs`, `src/inci.mjs`, and
`src/product-targets.mjs` exist. A real lookup UI now exists for one of the
three seed sources below: the incidecoder catalog (`/catalog`, and the product
picker shared by trial creation and the routine editor,
`components/product-draft-card.tsx`) — see
["The INCIdecoder catalog"](#the-incidecoder-catalog) for the full pipeline,
now including the daily incremental update. The other two are still unwired:
`scripts/probe-catalog.mjs`
harvests a local product catalog to `data/catalog/`, and `harvest-barcodes.mjs`
+ `verify-barcodes.mjs` seed a name→barcode table to `skincare-data/`.
**Nothing reads from either of those two yet.**

---

## Two problems that look like one

The instinct is to build "product lookup." That's actually two independent
problems with different failure modes, and conflating them produces a design
where neither works without the other.

- **Identification** — *which product is this?* Needed for the display name, for
  deduplication, for the cache key, and for sharing a trial where the reader
  needs to know what was tested.
- **Enrichment** — *what does it plausibly affect?* Needed only to pre-fill
  `targets[]`.

**Enrichment does not require identification.** An ingredient list is enough to
derive targets, and an ingredient list can be read off the back of the bottle
without knowing what the product is called or whether any database has heard of
it. Only the cache needs a stable identity, and the cache can key on the
ingredient list itself.

This matters because identification is the hard half. Cosmetics barcode coverage
is poor, name search is fuzzy, and the long tail of indie brands is enormous.
Enrichment, by contrast, is a solved problem the moment you have the INCI panel.

---

## The four input paths

All four converge on the same confirmation screen. None of them is a
prerequisite for starting a trial.

| Path | Yields | Free tier? | Notes |
|---|---|---|---|
| Photo of the ingredient panel | INCI array → `POST /v1/analyze` | ✅ | Works on *any* product, no database involved. **The strongest path** |
| Barcode scan | barcode → INCI direct | ✅ | Cheapest and most exact; worst UX, and fails on anything not in the database |
| Typed name → search for a published INCI list | name → INCI | ❌ paid | Needs Google Search grounding — see below |
| Photo of the front label, or typed name | name string → classification | ✅ | Best UX, weakest signal — no ingredient data behind it |
| Manual entry + checkboxes | nothing derived | ✅ | **Must always work.** The floor, not a fallback |

The confirmation screen is the actual feature. The other paths are conveniences
that pre-fill it.

### Google Search grounding is paid-tier only

Measured 2026-08-04, and it is not obvious from the error: on a free Gemini key,
plain `generateContent` succeeds while the *same key, same model*, with
`tools: [{ googleSearch: {} }]` returns `429 RESOURCE_EXHAUSTED`. Retrying with
backoff does not help — it is a tier limit, not a burst limit.

So `lookupInciByName()` is unavailable without billing, and **the ingredient
panel photo becomes the only automatic enrichment path on free tier.** Vision is
not restricted, so `readInciFromPhoto()` works fine. This is a good outcome
architecturally — the panel photo was already the strongest signal and the only
one that works on products no database contains — but it does mean the "just
type the name" path degrades to name-only classification rather than fetching
real ingredients.

### Why manual entry is load-bearing

A user who cannot identify their product must still be able to run a trial.
Every enrichment path is an accelerator on a form that has to be completable
without it. If product lookup ever becomes a gate on trial creation, the failure
mode is a user who can't log the thing they're actually testing — which is worse
than a slightly wrong `targets[]`.

---

## The INCI API

[inciapi.com](https://inciapi.com) — ingredient-level cosmetics data. Verified
2026-08-04.

Auth is `X-API-Key`. Free tier is 20,000 requests/month, and **404s are free**,
which makes coverage probing cheap. Unlike the YouCam quota, this does not draw
on the hackathon unit budget at all.

### Endpoints that matter to us

| Endpoint | Use |
|---|---|
| `GET /v1/products/:barcode` | Barcode → product + INCI list |
| `POST /v1/analyze` | Raw INCI array → the same analysis, **no barcode needed** |
| `GET /v1/ingredients/:inciName/incompatibilities` | Ingredient conflicts. Not for targets — for trial-creation warnings |
| `POST /v1/products/submit` | Contribute a missing product |

`POST /v1/analyze` is the one that changes the design. It accepts
`{"inci": ["Ingredient1", ...]}`, returns `{ analysis: {...} }` with no product
identity involved, and is what makes the ingredient-panel photo a first-class
input rather than a degraded one.

**Tier note.** Their docs list `efficacy`, `incompatibilities`, and
`skinTypeRecommendations` as Pro+ ($39/mo). On the current key all three return
real data — the aggregates arrive inside the `/v1/analyze` response, and the
per-ingredient `incompatibilities` endpoint answers directly. Their pricing page
says everything is free until August 2026, so **do not build on the assumption
that this stays true**; `extractSignals()` degrades to comedogenicity and
irritancy alone if `efficacySummary` disappears, and the client treats a 403 as
"tier-limited, carry on" rather than an error.

### Fields worth reading

Most of the response is a different product's feature set — this app is not a
safety checker and should not start acting like one.

| Field | Verdict |
|---|---|
| `efficacySummary.topEffects[]` | **Most useful.** Evidence-graded effects, with the ingredients responsible |
| `comedogenicityScore` (0–5) | Useful, but frequently `0` — see the trap below |
| `parsedIngredients[].comedogenicityRating` | Per-ingredient, and where the acne signal usually actually is |
| `parsedIngredients[].irritancyPotential` | Weak signal toward `redness` |
| `compatibilityConflicts` / `incompatibilities` | Trial-creation warnings, not targets |
| `flags.lowConfidence`, `coverage`, `evidenceCoverage.ratio` | How much of the panel they actually recognised. Thin coverage should weaken everything above |
| `skinTypeCompatibility`, `skinTypeRecommendations` | Marginal — skin *type* is not one of the 15 concerns, and confirmed categorical (not a score) on the analysis side too — see `docs/youcam-api.md`, "Concerns" |
| `overallSafetyScore`, `cleanBeautyScore`, `allergenFlags`, `pregnancySafe`, `pfasIngredients` | **Ignore.** Real information, wrong product |

### Two shape traps, both found by running it

Neither is visible from the documentation, and both fail silently — the payload
parses, nothing throws, and you simply get no signals.

- **`topEffects` entries are objects, not strings.** The concern name is on
  `target`, alongside `compositeStrength`, `bestEvidenceLevel`, and
  `contributingIngredients[]`. Reading `.effect` or `.name` extracts nothing
  from a perfectly good response.
- **`target` is a snake_case slug** — `barrier_repair`, `anti_hyperpigmentation`,
  `anti_acne`, `exfoliating`. Any keyword matching has to flatten underscores
  first, or `barrier_repair` misses a `barrier repair` rule and a real
  RCT-backed moisture signal vanishes.

Also: **`comedogenicityScore` is often `0` while an individual ingredient rates
4.** Read `parsedIngredients[].comedogenicityRating` as well, and weight it
lower — one comedogenic ingredient in a long panel is weaker evidence than a
whole-formula score.

### The two response shapes are not the same

Undocumented, and it fails silently — 200, populated body, zero signals:

```
POST /v1/analyze        -> { analysis: {...} }
GET  /v1/products/:code -> { product: { name, brand, country, qualityScore,
                                        ingredients: "<string>",
                                        details: { inci: [...], analysis: {...} } } }
```

`unwrap()` in `src/inci.mjs` flattens both. The barcode form is the richer one:
it carries the product's name, brand, country, and a `qualityScore` that
`/v1/analyze` has no way to know, so **prefer the barcode when you have one**,
even though the ingredient list is the better cache key.

Evidence grades also rank `meta_analysis` and `systematic_review` **above**
`rct`, not below. Testing `bestEvidenceLevel === 'rct'` demotes the strongest
evidence in the payload to a weak signal — which is what happened on the first
real product tried.

### There is no product-name search

`GET /v1/ingredients/search` searches *ingredients*, not products. Every product
endpoint is barcode-keyed. If a name→barcode bridge is ever needed:

- **Brand DTC storefronts** — the best free source, and the one that took
  longest to find. Most K-beauty and indie brands run Shopify, which serves
  `/products.json?limit=250` with no auth and no HTML parsing: official name,
  vendor, official CDN image, and description. **Measured below.**
- **[UPCitemdb](https://devs.upcitemdb.com/)** — has a real keyword/name search
  endpoint, free tier of 100 combined requests/day with no auth. Adequate for a
  demo, $99/mo beyond that. Understand what it is before leaning on it: the
  `elid` field and the Walmart/eBay `offers[]` give it away as an aggregator
  over North American *retail listings*, not a GTIN registry. That predicts its
  coverage — a Korean SKU with no NA listing is absent, and paying does not fix
  it. Its titles conflate sets with singles (a "6-Piece Set" title over a
  single-toner offer) and its descriptions are keyword-stuffed marketplace
  text. Never let either near `targets[]`.
- **[eBay Browse API](https://developer.ebay.com/api-docs/buy/browse/overview.html)**
  — free production keys, OAuth client-credentials, ~5,000 calls/day. This is
  UPCitemdb's own upstream, so use it directly and skip the 100/day cap. Note
  the shape: `item_summary/search?q=` does **not** return a GTIN, so name→barcode
  costs `1 + N` calls, the second being `GET /buy/browse/v1/item/{item_id}`.
  Good as a barcode oracle, bad for everything else — seller titles and seller
  photos have the same defects as UPCitemdb's, because they are the same data.
- **[Open Beauty Facts](https://world.openbeautyfacts.org/data)** — open data,
  free. **Effectively unusable here, and for a subtler reason than "thin".**
  Measured below: it is a *coverage* failure, not a quality failure, which
  matters because no amount of completeness gating can fix it.
- **An LLM with web-search grounding** — this is the mechanism behind "I googled
  it and the answer just appeared", and it is what `lookupInciByName()` in
  `src/product-targets.mjs` does. A search-grounded model resolves a brand +
  product name to a published INCI list directly, skipping the barcode hop
  entirely, because brands publish ingredient lists on their own product pages.
  It returns the retrieved URLs alongside the list, and a list with **no**
  retrieved page behind it is downgraded to `confident: false` regardless of
  what the model claims — that case is a memory reconstruction, not a lookup,
  and a fabricated ingredient list would get cached and then used to attribute
  real measured skin changes.

That last option is worth weighing seriously, because **name → INCI is one hop
and name → barcode → INCI is two.** The barcode is only a key into ingredient
data; if the ingredient data can be reached directly, the barcode is optional
metadata rather than a required identifier. Keep the barcode when it's available
— it is the most stable identity we can get — but do not build the flow so that
it stalls without one.

### The bridge gap, measured

Worked through end-to-end on one real product — Anua Azelaic Acid 10 Hyaluron
Redness Soothing Serum, EAN `8809640737190` (2026-08-04):

| Source | Result |
|---|---|
| Open Beauty Facts, full product name | **0 results** |
| Open Beauty Facts, brand `"Anua"` | 3 products, none this one, **none with ingredients** |
| Open Beauty Facts, **by barcode** | ✅ record exists — and is a bare stub. See below |
| UPCitemdb keyword search | `NOT_FOUND` (and `TOO_FAST` on the third query — the free tier rate-limits hard) |
| UPCitemdb, **by barcode** | `404` |
| INCI API, **by barcode** | ✅ full record: name, brand, 14 ingredients, graded efficacy |

So the data exists and is good; only the name→barcode hop is missing.

**Search Open Beauty Facts by barcode, not by name, before concluding it has
nothing.** The first two rows above were the original measurement and they are
misleading on their own: `GET /api/v2/product/8809640737190.json` *does* return
this product. The record is just empty — `completeness: 0.075`, no name, no
brand, no ingredients, only a front photo, auto-created by a scanning app
(`creator: smoothie-app`). Also note their own API disagrees with itself:
`/api/v2/search` reported `count: 1` for a query the legacy `cgi/search.pl`
answered with 16, so prefer the legacy endpoint for counts.

That stub is the exception rather than the rule, and the distinction decides
what to do about it. Sampled across the OBF beauty database:

| | |
|---|---|
| Serums in the **entire** database | **16** |
| Of those: `image_front_url` | 100% |
| Of those: `product_name` / `brands` | 88% |
| Of those: `ingredients_text` | 75% |

**It is a coverage failure, not a quality failure.** The records that exist are
mostly complete; there are almost none of them. If it were a quality problem
you would fix it with completeness gating — you cannot gate your way to data
that is not there. Do not spend time on OBF as a read source. Its one asset,
the front image, should come from the user's own capture anyway: they are
already photographing the panel, a crowdsourced photo has nothing verifying it
matches the barcode, and showing the wrong bottle on a trial card is exactly
the confidently-wrong surface this product avoids elsewhere.

### Brand storefronts close most of the gap

Measured 2026-08-04 by `scripts/probe-catalog.mjs`, which harvests to
`data/catalog/shopify/<host>.json`. **24 brands probed, 10 reachable, 846
products.** The failures are 403/404/410, not partial data.

| Field, over 846 products | Fill |
|---|---|
| `title`, `images[0].src` (official brand CDN) | ~100% |
| `body_html` description | 74–100% |
| `variants[].barcode` | **0%** |

The barcode being uniformly null is not sampling noise — **Shopify redacts it
from the public endpoint**; it is Admin-API-only. But it is still recoverable,
because the storefront's *product pages* carry JSON-LD at 100% and a third of
brands populate a GTIN there:

| Brand | gtin rate | Brand | gtin rate |
|---|---|---|---|
| axis-y.com | 85% | skin1004.com | 43% |
| roundlab.com | 85% | byoma.com | 25% |
| theinkeylist.com | 20% | glowrecipe / kravebeauty / versedskin | 0% |

**52 checksum-valid GTINs from 194 pages (27%), 7 of 10 brands.** Two traps
worth knowing: 42 of those 52 came from the loose-text regex fallback rather
than structured JSON-LD, so treat them as candidates behind the confirmation
screen, not as verified identity; and *every* extracted code must pass an
EAN-13 check digit before being stored, which is what `validGtin()` is for.

Crawling **retailer** sitemaps for the same JSON-LD failed outright — 0 of 8
sites, every one 403 or 404 at `/sitemap.xml`. That is bot-blocking, so
retailer GTIN coverage is *unmeasured rather than disproven*. Re-run with
`--retailers` before assuming it is a dead end.

Korea's [data.go.kr](https://data.go.kr) MFDS cosmetic endpoints respond `400`
rather than `404` without a service key, so they exist and signup is free — but
coverage is unverified, and it is a *registration* registry, which may well not
carry retail barcodes at all. Check that before investing.

Ways to close the gap, in increasing order of effort:

1. **Scan the barcode.** It is physically on the box. This is not a
   database problem at all for a user holding the product — it is only a problem
   for a name typed from memory.
2. **Read the digits off a photo.** Every EAN-13 prints its 13 digits in
   human-readable form. Vision is not tier-restricted, so this rides the same
   free path as `readInciFromPhoto()`, and the check digit validates the OCR —
   a transposed digit fails arithmetic rather than silently querying the wrong
   product.
3. **Harvest brand storefronts**, as measured above. This is the only option
   that yields official *images* and canonical names as well as barcodes.
4. **Paid search grounding.** A search-grounded model resolved this barcode
   immediately. That is exactly what `lookupInciByName()` does, and exactly what
   the free tier withholds.
5. **Our own name→barcode table**, accumulated from scans. Every barcode scan
   already yields `(brand, name, barcode)` — writing that association down makes
   the *next* user's typed name resolve for free. The table is a by-product of
   normal use rather than something to seed up front.

Option 5 is the one that compounds, and it is why `ProductStore` records `brand`
and `name` alongside the barcode even though neither is the cache key. Option 3
is the one that seeds it in bulk without waiting for users.

### Seeding the table from model recall

Option 5's table is worthless until it has rows in it, and waiting for users to
scan their way to coverage is a cold start with no end. `scripts/harvest-barcodes.mjs`
seeds it up front: for each of the 120 brands in `skincare-data/skincare-brands.md`,
ask Gemini for the barcodes it recalls, then check every code that comes back.

This is **plainly a lower-grade source than anything above it**, and it is
allowed only because of where the output lands. Nothing here touches the
measurement path, and no harvested row may pre-fill `targets[]` — the harvest
resolves a typed name to a *candidate identity*, and enrichment still runs from
the ingredient list as it always did. A wrong row costs a wrong display name on
a confirmation screen the user is already looking at.

Two filters run over it, in cost order:

1. **The GS1 check digit** (`validGtin` in `src/products.mjs`), free and
   offline. It rejects ~90% of arbitrary digit strings, and a fabricated code is
   usually fabricated digit by digit.
2. **The INCI lookup** (`scripts/verify-barcodes.mjs`). The only thing that can
   say a well-formed code corresponds to a product that exists.

The failure that survives both is the one the design is actually aimed at: an
invented code that is checksum-valid *and* is a real article from some other
brand. Nothing about the code itself reveals that, so every candidate carries
the brand and product name the model asserted, and phase 2 checks them against
what INCI returns. That is why the harvest schema asks for a name at all.

**Match on brand and name together, not brand alone.** Measured on the first 18
real codes: `3606000537668` returns branded "FRANKEL & FRANKEL" — a distributor
— with `name` reading "CeraVe Moisturizing Cream". Whoever registers the GTIN
owns the brand field, and for resold stock that is the reseller, so the real
brand lands in the name. Comparing brand-to-brand alone discarded 2 of 16 good
products. The looser rule does not cost much: the same run's genuine miss
(`3606000537538` → "Unknown / Mixed Berry Prebiotic Soda") still fails, because
neither field mentions CeraVe.

### Measured, 120 brands, 2026-08-07

12 Gemini requests at a ceiling of 50 products per brand, then 115 INCI lookups.

| Stage | Products | Brands covered |
|---|---|---|
| Barcodes returned by the model | 327 | — |
| Survived the check digit → `barcodes.json` | **115 (35%)** | 41 / 120 |
| INCI corroborated the brand → `verified.json` | **36** | 18 |
| INCI had no record → `needs-review.json` | 78 | 34 |
| INCI had a *different* product → discard | 1 | — |

**The 65% check-digit failure rate is the headline.** Two thirds of what the
model called recall does not survive arithmetic that needs no network and no
database, which is the clearest available statement of how much of this is
reconstruction. Yield also splits hard by brand: mass-market lines (CeraVe,
Vaseline, Garnier) returned usable codes, while prestige and clinical brands
(ZO Skin Health, Jan Marini, Alastin, Biologique Recherche) returned nothing
usable at all. Retail web presence is what the model has memorised, not
catalogues.

**79 of the 120 brands ended with nothing at all.** Only 8 of those were brands
the model declined outright; for the rest it produced codes that failed the
checksum. A brand asked about is not a brand covered, and the gap is most of the
list.

Net: **36 corroborated products across 18 brands.** That is a thin seed and it
should be read as one — worth having because it costs 12 requests and compounds
with every user scan, not because it is a catalogue. The 78 unverified rows are
not disproven; INCI's cosmetics coverage is thin enough that a 404 says nothing
either way, which is why they are kept for review rather than dropped.
`probe-catalog.mjs --gtin` remains the better source for the brands it can
reach, because a GTIN lifted from a brand's own JSON-LD is observed rather than
recalled; the two are complementary and neither covers the other's brands.

Two things worth keeping in mind about the numbers:

- **`unknown` is not failure.** INCI's cosmetics coverage is thin, as measured
  above, so a 404 says nothing about whether the product is real. Those rows go
  to `needs-review.json` rather than being discarded.
- **Ask for a ceiling, never a quota.** A model told to return exactly 50 codes
  for a brand it recalls eleven of will pad the other thirty-nine, and padding
  is generated digit by digit. The prompt says "up to N" and states that
  returning zero is correct; the observed yield is far below N, which is the
  instruction working rather than failing.

Raw responses are cached under `skincare-data/raw/gemini/` and `barcodes.json`
is derived from them on every run, so tightening a filter is a free re-parse
(`--reparse`) rather than a re-spend.

---

## The INCIdecoder catalog

A second bulk ingredient source, independent of the INCI API and free:
[incidecoder.com](https://incidecoder.com) publishes a name → full INCI panel
for its own catalog, ~183k products as of 2026-08-07 (read from its sitemap,
not extrapolated). No API exists — `scripts/scrape-incidecoder.mjs` crawls the
sitemap for the slug index, then `/products/<slug>` per product, parsed by
`src/incidecoder.mjs`. Self-throttled (1 req/s default, shared circuit breaker
on any 429), resumable, and every page lands in `skincare-data/raw/incidecoder/`
(gitignored — this is a cache, not seed data, and at this scale committing it
would bloat the repo far past what a hackathon submission should carry).

Each record carries more than the ingredient list: per-ingredient function
tags, irritancy and comedogenicity ratings, and a community "our take" — data
that lines up directly with what [the local ingredient dictionary](#a-local-ingredient-dictionary)
further below wants from CosIng, except already tied to real formulations
rather than an exhaustive regulatory list.

Status: **scrape complete, fully loaded, and kept current daily.** 183,181
products scraped from the sitemap 2026-08-07/08; 183,172 of them (9
duplicate-slug files, see `import-catalog.mjs`'s header) are in Neon as of the
full import 2026-08-08, alongside 20,016 unique ingredients and 25,726 unique
brands. The Neon schema and ingest pipeline are built and working
(`scripts/migrate-catalog.mjs`, `scripts/import-catalog.mjs`, the read path in
`lib/catalog.ts`, browsable at `/catalog`, wired into the product picker
shared by trial creation and the routine editor via
`components/product-draft-card.tsx` and `components/search-combobox.tsx`).
`scripts/sync-catalog.mjs`,
scheduled by `.github/workflows/sync-catalog.yml`, keeps it current without a
full re-crawl — see "Daily incremental update" below. See "Storage, measured"
for what closed the loading question out, and "Open question" for what's
still unresolved despite the full load.

### Migrating the flat-file cache into Neon

Three tables, `catalog_brands` and `catalog_ingredients` as small deduped
dictionaries and `catalog_products` as one row per scraped product —
deliberately namespaced `catalog_*` and kept separate from the *other*
"products" concept (`lib/community.ts`'s `CommunityProduct`, keyed by
`src/products.mjs`'s hash-based `productKey`): that one is products someone
has actually put on trial; this is a reference catalog nobody has necessarily
used. Every write is `on conflict ... do update`, so a re-run or an
interrupted run is always safe to redo from scratch.

**Ingredient occurrences are denormalized onto the product row, not a link
table — measured, not a style choice.** The first schema had a
`catalog_product_ingredients` table, one row per (product, ingredient)
occurrence, ~4.9M rows for the full catalog. It hit Neon's free-tier 512MB
project cap 45% of the way through a real import: at 2.17M rows it was
already 377MB, and its two B-tree indexes (223MB) cost *more* than the row
data itself (154MB) — many narrow rows is close to a worst case for Postgres
storage overhead. The fix: `catalog_products.ingredients` (jsonb, one blob per
product — slug/name/position per occurrence, in panel order) plus
`catalog_products.ingredient_slugs` (text[], deduped, GIN-indexed). "Which
products contain niacinamide" becomes `ingredient_slugs @> array['niacinamide']`
— the same indexed-array-containment pattern `concern_tags` already uses for
search-by-concern, not a join. Nothing about what's searchable changed, only
how the per-occurrence detail is stored. `catalog_ingredients` still holds
each ingredient's functions/irritancy/comedogenicity/take once (verified
stable per ingredient slug across every product that lists it), looked up by
slug when a product's panel renders.

### Search-by-concern, deterministically

`src/ingredient-concerns.mjs` hand-maps incidecoder's ingredient-function
taxonomy to the 15 analysis concerns — viable specifically because that
taxonomy is only **21 tags** across the entire 20,016-ingredient corpus
(measured on the full scrape, not a sample), e.g. `emollient` → `moisture`,
`anti-acne` → `acne`, `sunscreen` → `age_spot`. No LLM, no per-ingredient
classification cost. `deriveConcernTags()` runs at ingest time and the result
is stored on `catalog_products.concern_tags`, indexed. Deliberately
one-directional: comedogenicity/irritancy ratings are real per-ingredient
caution signals but are intentionally not folded in — mixing "helps X" and
"may worsen X" into one tag set would make the tag meaningless. Concerns with
no ingredient-function signal in this taxonomy (`pore`, `firmness`, `eye_bag`,
`dark_circle_v2`, both eyelid concerns) are honestly left unreachable by this
path rather than force-mapped to something tenuous.

### Storage, measured

The redesign (denormalized `jsonb`, no per-occurrence link table) was what
made the full catalog viable at all — but it was the Neon plan upgrade, not
the redesign, that actually closed this out. The projection below (from a
29,994-product sample) said the full catalog would land ~15% over the
free tier's 512MB project cap; upgrading to Launch replaced that hard cap
with pay-as-you-go storage ($0.35/GB-month, no allocation limit), so the
projection stopped being a blocker before it was ever tested against the cap
directly.

| Piece | Projected @ 183,181 (29,994-row sample) | Measured @ 183,172 (full load, 2026-08-08) |
|---|---|---|
| `catalog_products` (heap + TOAST + all indexes) | ~439MB | 516MB |
| `catalog_ingredients` | ~15MB | 14MB |
| `catalog_brands` | ~11MB | 10MB |
| **database total** | ~587MB | **549MB** |

Full import (`node --env-file=.env.local scripts/import-catalog.mjs`) took
1.5 minutes end to end. All 183,172 products, 20,016 ingredients, and 25,726
brands are loaded and searchable by name, brand, ingredient, and concern. At
549MB, monthly storage cost on Launch is roughly $0.19 — the byte-shaving
levers noted in the prior version of this section (dropping `brand_name` from
the trigram index, minifying jsonb keys, shrinking the unique index) were
never needed and remain available if storage cost ever becomes worth
optimizing for its own sake.

### Open question: is "all of it" even the right target?

Raised 2026-08-08, **still unresolved** — the full catalog is now loaded, but
that answers the storage question, not this one. It is community-uploaded and
unmoderated; some fraction of 183k products are plausibly discontinued,
mislabeled, or otherwise stale, and brand coverage was never curated for
relevance to begin with — it's "every product incidecoder's users happened to
submit," not "skincare products people currently buy." Loading everything was
the right call once storage stopped being a forcing function for the decision
either way, but a smaller, brand-curated, verified-current subset could still
be more useful to *search* — result quality, not byte count, is now the
argument for revisiting this, if it's revisited at all.

### Daily incremental update

Built 2026-08-08, deliberately without waiting for the loading question above
to resolve — appending new products the same way the full import already
loaded 183k of them doesn't foreclose revisiting curation later, and the
catalog gaining new products daily was the more pressing gap.

`scripts/sync-catalog.mjs` fetches `https://incidecoder.com/products/new`
(~200 newest slugs, one page, no pagination, no auth — parsed by
`parseNewProductsPage()` in `src/incidecoder.mjs`), diffs those slugs against
`catalog_products` by `(source, source_slug)`, and fetches + upserts only
what isn't already there. It shares its write path with the bulk importer
(`src/catalog-ingest.mjs` — `buildProductRow()` and the three `upsert*()`
helpers, both scripts now call the same functions instead of each carrying
its own copy of the insert SQL) and its fetch/backoff/self-throttle contract
with the bulk crawler (`src/incidecoder-fetch.mjs`, extracted out of
`scripts/scrape-incidecoder.mjs` for the same reason). One difference from
the bulk path: a newly-seen brand increments `catalog_brands.product_count`
rather than overwriting it (`upsertBrands(sql, rows, { increment: true })`),
since the daily job only ever sees today's handful of new products, never the
full count the bulk import scans for.

`.github/workflows/sync-catalog.yml` runs it daily — `DATABASE_URL` as a
repo secret, a fixed cron time plus a random 0-59 minute sleep at job start so
requests don't land at the same second every day, `concurrency: cancel-in-progress: false`
so a manual `workflow_dispatch` run never overlaps the scheduled one.

---

## Deriving targets

The chain, unchanged in spirit from [`trial-model.md`](trial-model.md):

1. The user enters, scans, or photographs the product.
2. A classifier maps it to a **ranked** subset of the 15 analysis concerns.
3. **The user confirms or edits.** Always.

This is constrained classification into a fixed vocabulary with a human in the
loop. It is not open generation: the model picks from a schema `enum`, so it
cannot emit a concern name that isn't one of the 15, and anything that somehow
escapes is dropped by `src/concerns.mjs` on the way out.

The classifier is **Gemini 3.6 Flash** (`gemini-3.6-flash`), via `@google/genai`,
with `responseJsonSchema` + `responseMimeType: 'application/json'` and
`thinkingLevel: 'LOW'`. Low thinking is deliberate — this is a lookup against a
fixed vocabulary, and higher levels give the model more room to talk itself into
justifying a longer list, which is the exact failure this section is about.

### Bias narrow, deliberately

The failure is asymmetric, and getting this backwards quietly destroys the
attribution table.

| Failure | Consequence |
|---|---|
| **Targets too narrow** | Real effects land in the `unexplained` row. Visible, honest, and the user can correct it. `trial-model.md` calls that row the most valuable output |
| **Targets too broad** | Everything is "explained." Side effects get absorbed into interventions that plausibly targeted them, and `\|T\| > 1` fires on every metric, so nothing is ever attributable to one thing |

Ingredient data pushes hard toward broad. A serum with niacinamide, hyaluronic
acid, and a BHA has a defensible ingredient-level story for eight of the
fifteen concerns. If the classifier's output drives checkboxes directly, most
of the list gets pre-ticked, the user accepts the default, and every metric
comes back "shared, unsplittable" — which carries the same information as having
no attribution at all.

So the classifier returns a ranked list with confidence, and **only the top few
are pre-ticked.** The rest are offered as suggestions the user can add. A short
`targets[]` that misses something is recoverable; a long one that absorbs
everything is not.

### Measured behaviour

Live results, `gemini-3.6-flash`, 2026-08-04. The instruction to err toward too
few is holding:

| Product | Pre-ticked | Suggested |
|---|---|---|
| Paula's Choice 2% BHA (name only) | texture, pore, acne | oiliness, radiance, redness |
| Paula's Choice 2% BHA (**with INCI**) | acne, texture | pore, oiliness, redness |
| CeraVe Moisturizing Cream | moisture | texture |
| CeraVe Hydrating Cleanser | **none** | moisture, redness |
| The Ordinary Multi-Peptide + HA Serum | wrinkle | firmness, moisture |
| Anua Azelaic Acid 10 (front-label photo only) | redness, acne | age_spot, moisture |
| Anua Azelaic Acid 10 (**with barcode + INCI**) | redness, acne | age_spot, texture, moisture |

Two things worth noting. The bland cleanser pre-ticks **nothing** — the model
declines to reach rather than padding, which is the behaviour that keeps a
routine's worth of background products from absorbing every metric. And the
multi-active peptide serum takes **one**, not three; an over-broad classifier
would have grabbed wrinkle, firmness, and moisture and made all three
unsplittable the moment a second product entered the trial.

The BHA is the interesting row: supplying the real ingredient list made the
answer *narrower*, not broader (3 → 2, with `pore` demoted to medium). Evidence
displaced speculation rather than adding to it.

The Anua rows show the two signals are genuinely complementary. The classifier
pre-ticked `redness` — which the ingredient database gave **no signal for at
all** — because the product is named "Redness Soothing Serum" and purpose is
visible on a label in a way it isn't in a molecule list. Meanwhile it demoted
`moisture` to low despite a strong RCT-backed hydration signal, correctly
reading the hyaluronic acid as a supporting ingredient rather than the point of
the product. Neither source alone gets that pair right, which is the argument
for passing the lexicon in as "one weak opinion" rather than as instruction.

(The missing redness signal was a lexicon gap, not an API one: the effect was
filed under `wound_healing`, which nothing mapped to. Fixed — but it is a good
illustration of why the deterministic pass should never be the only voice.)

### What the classifier is not for

Ingredients are an input to *attribution*, never to *measurement*. No ingredient
list may adjust, weight, or explain a score — scores come from photographs.
Ingredient data decides which intervention gets *named* next to an observed
change, and nothing else.

---

## The cache

Deriving targets for the same product twice is waste, and worse, two derivations
can disagree. The cache is what makes the second scan of a product instant and
consistent — but four constraints make it safe.

### 1. Key on normalized INCI, not barcode

The same formulation ships under different regional barcodes and different
product names. A barcode-keyed cache stores that product three times and lets
the three entries drift apart. Normalize the ingredient list (lowercase, trim,
strip punctuation and parentheticals, preserve order — order is concentration
order and is meaningful) and hash it. Barcode and display name become
attributes of the record, not its identity.

Products with no ingredient data available fall back to a name-keyed entry,
flagged as such, and with lower precedence than any INCI-keyed record.

### 2. Store provenance

| Provenance | Meaning |
|---|---|
| `llm-derived` | The classifier's output, unreviewed |
| `user-confirmed` | A user saw the derived targets and accepted them |
| `user-edited` | A user changed them |

A user edit is a much stronger signal than a classifier default and must outrank
it on the next lookup. Aggregating confirmations across users is a genuinely
valuable asset later; it is not a day-one concern and carries its own privacy
questions.

### 3. Version the classifier

Record the model ID and prompt version on every entry — the same discipline as
the `hd_f055_*` analysis cache key, and for the same reason. When the classifier
improves, entries derived by the old one are stale, and you need to be able to
tell which. Without this, a prompt change silently leaves a mix of two
vocabularies in the cache with no way to distinguish them.

### 4. Never mutate targets on a running trial

`targets[]` is **frozen at trial creation.** A cache refresh, a classifier
upgrade, or another user's edit must never reach into a trial that is already
logging captures.

Changing targets mid-trial retroactively rewrites the attribution table — a metric that
was `unexplained` on day 1 becomes `attributed` on day 40 without any new
measurement, which is exactly the kind of after-the-fact reinterpretation the
product exists to prevent.

---

## Trial-creation warnings

`GET /v1/ingredients/:inciName/incompatibilities` returns ingredient conflicts
with `severity` and a substantive `reason` — the retinol/benzoyl-peroxide entry
cites measured degradation rates rather than hand-waving. This is not a targets
signal, but it is a good *warning* at trial creation:

> Your baseline routine includes an AHA and you're adding a retinoid. Expect
> redness and texture to get worse before they get better.

That is the purge-trough narrative arriving *before* the data does, which makes
the trough legible when it shows up rather than alarming. It costs nothing at
capture time and the endpoint answers on the current key, so it is a cheap
addition whenever the trial-creation UI exists.

---

## A local ingredient dictionary

The obvious next step, and the one that reduces external dependency rather than
adding to it: a local `ingredient → concern` table, so a known panel resolves
deterministically with no INCI call and no model call.

The pieces already exist in embryo. `EFFECT_LEXICON` in `src/inci.mjs` is a
small deterministic effect→concern table, and the product cache in
`src/products.mjs` is the beginning of the personal database — every scan adds a
normalized ingredient list with human-reviewed targets attached. The step from
"cache of products" to "dictionary of ingredients" is inverting that index.

Why it is worth doing:

- **Deterministic.** The same panel gives the same targets forever. No prompt
  version, no staleness, no re-derivation. Most of `src/products.mjs` exists to
  manage non-determinism that would simply not arise.
- **Fast and free.** No network on the common path, which matters because
  ingredient overlap between skincare products is enormous — a few hundred
  actives cover most of the market's meaningful effects.
- **Survives tier changes.** Neither the INCI Pro+ question nor Gemini's
  grounding paywall can break it.

The honest limits: it only helps for ingredients someone has already curated,
the long tail of botanical extracts is effectively unbounded, and concentration
matters in ways an ingredient name does not capture (2% salicylic acid and a
trace preservative amount are the same string). So the realistic shape is a
dictionary for the ~200 actives that actually drive the 15 metrics, with the
INCI API and the classifier as the fallback for everything else — not a
replacement for either.

### Where to get the ingredient list

**[CosIng](https://single-market-economy.ec.europa.eu/sectors/cosmetics/cosmetic-ingredient-database_en)**
is the canonical answer — the EU's official cosmetic ingredient database, free,
and the thing INCI names are *defined* by. Crucially it records each
ingredient's **function** (humectant, keratolytic, antioxidant, skin-conditioning
…), which is one mapping step away from a concern and is exactly the column a
dictionary needs. It's a regulatory inventory rather than an efficacy database,
so it will tell you salicylic acid is a keratolytic but not how much texture
moves — that part still comes from `efficacySummary` or from our own trials.

Two caveats worth knowing before leaning on it: it is explicitly non-binding
reference data, and it is *exhaustive* (tens of thousands of entries, most of
them fragrance components and colourants that will never touch the 15 metrics).
The useful subset is small.

A pragmatic seeding order:

1. Take CosIng as the **name authority** — canonical INCI spellings and
   synonyms, which also fixes the "aqua vs water" normalisation gap that
   `src/products.mjs` currently refuses to guess at.
2. Harvest **function → concern** mappings for the few hundred actives that
   actually drive the metrics, rather than all 30k.
3. Let `efficacySummary` responses accumulate evidence grades on top, since
   those already arrive with `contributingIngredients[]` naming exactly which
   ingredient earned the effect — that field is a ready-made training set for
   this table.
4. Freeze anything a human confirms, and treat the classifier as the fallback
   for what the table doesn't cover.

Step 3 is the appealing part: we are already being handed
`ingredient → effect → evidence grade` on every lookup and currently throw it
away after computing signals. Persisting it builds the dictionary as a
by-product of normal use, the same way the name→barcode table would.

---

## Open questions

- **Whether to require an ingredient list at all.** A name-only product gets
  weaker targets. Requiring the panel photo improves attribution quality at the
  cost of a harder onboarding step. Currently leaning optional-but-encouraged.
- **Crowd-sourced target corrections.** Aggregating `user-edited` records across
  users would beat any classifier, but it needs a moderation story and a privacy
  story before it needs code.
- **Pro+ tier.** `efficacySummary` and `incompatibilities` are the two most
  valuable pieces of the payload, documented as $39/mo but currently answering
  on the free key. Everything is free until August 2026 — which is *now* — so
  the bill may land at any point. `extractSignals()` already degrades without
  them; what is undecided is whether they are worth paying for.
- **Multi-product interventions.** "I started a 5-step routine" is one
  intervention or five? Five gives honest unsplittable-credit output; one is
  what the user thinks they did.
- **Whether 18 brands of barcode coverage is worth wiring in at all.** A name
  lookup that resolves one typed product in ten may read as more broken than
  having no lookup. The alternative is to leave the table accumulating from user
  scans and ship only the paths that always work.
- **Wiring the harvested catalog in.** `data/catalog/` holds 846 products with
  official names and images and nothing reads it. The lookup path still goes
  straight to INCI by barcode. Deferred behind the MVP deliberately — it is an
  onboarding accelerator, not a measurement dependency, and per the rule above
  the confirmation screen has to work without it regardless. Wiring it in needs
  a name-search index over the harvest and a decision on whether a catalog hit
  may pre-fill `targets[]` or only the display fields.
- **Storage and refresh cadence.** The harvest is flat JSON on disk, pending a
  real database. Whatever replaces it needs per-field provenance, not
  per-record, so a brand-official name can outrank a marketplace title on
  conflict — that is the entire reason the sources are kept in layers.
