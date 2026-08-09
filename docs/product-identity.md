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

**Product detail page, added 2026-08-08.** `/catalog/[id]`
(`app/catalog/[id]/page.tsx`, backed by `getCatalogProduct()` in
`lib/catalog.ts`) is a standard 2-column layout: the listing image on the
left (sticky on desktop), and brand, name, description, `concern_tags`
(labelled "What its ingredients plausibly target" — these are inferred from
the panel, never something the app measured) and the full ingredient table
stacked on the right, in that order. Every product card that carries a
`catalogProductId` now links there — `components/product-card.tsx` (the trial
detail page's product list) and the catalog listing's own card
(`app/catalog/page.tsx`). A typed-name, barcode, or ingredient-photo product
has no catalog row (`catalogProductId` is null), so `ProductCard` renders as a
plain, unclickable card in that case rather than linking to a 404.
`components/trending-product-card.tsx` and `/products` still link to the
*community* product page (`/products/[key]`), a different concept — see
"Migrating the flat-file cache into Neon" below — and are unaffected.

**Product detail page, added 2026-08-08, merged into one route the same day.**
The catalog and the community originally had separate detail pages —
`/catalog/[id]` for a catalog row, `/products/[key]` for a community product
— and it read as two near-identical "product page" concepts to anyone
clicking between them. `app/catalog/[id]/page.tsx` is gone; `/products/[key]`
(`app/products/[key]/page.tsx`) is now the single product detail route for
both.

The route is keyed by whichever id resolves the product. A UUID-shaped `key`
is looked up as a catalog id first via `getCatalogProduct()`
(`lib/catalog.ts`); anything else is treated as the community's brand+name
slug via `getCommunityProduct()` (`lib/community.ts`). Whichever side
resolves, the page also fetches the *other* side when it exists —
`getCommunityProductByCatalogId()` for a catalog-keyed page,
`community.catalogProductId` for a slug-keyed one — so a product that is both
in the catalog and has been trialled shows both: the catalog identity (image,
description, `concern_tags` — labelled "What its ingredients plausibly
target," inferred from the panel, never something the app measured — and the
full ingredient table) stacked above the community evidence (who's trialled
it, "What the community watches it for", the ongoing/completed trial cards).
A product with only one side (catalog row nobody's trialled yet, or a
typed-name/barcode/ingredient-photo product with no catalog row) renders
whichever half it has and skips the other silently.

`CommunityProduct` (`lib/community.ts`) gained a `catalogProductId` field,
tracked through `aggregateProducts()` the same way `image` already was —
first non-null `catalogProductId` among the product's contributing
interventions. A slug-keyed page whose community product turns out to carry a
`catalogProductId` `redirect()`s to the canonical `/products/{catalogId}` URL,
so a given product never renders at two different addresses. Every link that
used to point at `/catalog/[id]` or that built a `/products/[key]` URL from a
bare slug now prefers `catalogProductId ?? key` —
`components/product-card.tsx`, `components/trending-product-card.tsx`,
`app/catalog/page.tsx`, `app/products/page.tsx`, `app/search/page.tsx` — so
the common case links straight to the canonical URL rather than bouncing
through the redirect.

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
taxonomy to the 14 analysis concerns — viable specifically because that
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
