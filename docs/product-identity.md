# Product identity and target derivation

How a product gets from "the bottle in your hand" to a set of analysis concern
keys in `Intervention.targets[]`. The attribution rules that consume those keys
are in [`trial-model.md`](trial-model.md); this doc is about how the keys get
filled in without the user typing fourteen checkboxes by hand.

Status: **designed, partially built.** `src/products.mjs`, `src/inci.mjs`, and
`src/product-targets.mjs` exist. No UI. `scripts/probe-catalog.mjs` harvests a
local product catalog to `data/catalog/`; nothing reads from it yet.

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
| `skinTypeCompatibility`, `skinTypeRecommendations` | Marginal — skin *type* is not one of the 14 concerns |
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

---

## Deriving targets

The chain, unchanged in spirit from [`trial-model.md`](trial-model.md):

1. The user enters, scans, or photographs the product.
2. A classifier maps it to a **ranked** subset of the 14 analysis concerns.
3. **The user confirms or edits.** Always.

This is constrained classification into a fixed vocabulary with a human in the
loop. It is not open generation: the model picks from a schema `enum`, so it
cannot emit a concern name that isn't one of the 14, and anything that somehow
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
fourteen concerns. If the classifier's output drives checkboxes directly, most
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
dictionary for the ~200 actives that actually drive the 14 metrics, with the
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
them fragrance components and colourants that will never touch the 14 metrics).
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
