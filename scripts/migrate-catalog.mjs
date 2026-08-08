/**
 * Create the product-catalog tables. Idempotent — safe to re-run.
 *
 *   node --env-file=.env.local scripts/migrate-catalog.mjs
 *
 * Costs no YouCam units and makes no Gemini call. Neon only. Depends on the
 * `analysis_concern` enum from scripts/migrate-routines.mjs — run that first.
 *
 * This is the destination for scripts/import-catalog.mjs, which loads the
 * ~183k products scraped by scripts/scrape-incidecoder.mjs
 * (skincare-data/raw/incidecoder/, gitignored) into these tables. Deliberately
 * a separate table namespace (`catalog_*`) from the existing community
 * "products" concept (`lib/community.ts`, keyed by src/products.mjs's
 * hash-based productKey) — that is "products someone actually put on trial";
 * this is a reference catalog nobody has necessarily used. See
 * docs/product-identity.md for why the two must not be conflated.
 *
 * **Ingredient occurrences are denormalized, not a link table — measured, not
 * a style choice.** The first version of this schema had a
 * `catalog_product_ingredients` table, one row per (product, ingredient)
 * occurrence, ~4.9M rows. It blew Neon's free-tier 512MB project cap at 45%
 * loaded: at 2.17M rows it was already 377MB, and its two B-tree indexes
 * (223MB) cost MORE than the row data itself (154MB) — the classic failure
 * mode of many narrow rows. Extrapolated, the full table alone would have
 * needed ~850MB. Every other table here was cheap (catalog_ingredients 15MB
 * for 20,016 rows, catalog_brands 11MB for 25,726) — the per-occurrence shape
 * was the entire problem.
 *
 * The fix: `catalog_products.ingredients` (jsonb, one blob per product: each
 * occurrence's ingredient slug, position, and as-printed label — nothing an
 * ingredient-level table already holds) plus `catalog_products.ingredient_slugs`
 * (text[], deduped, GIN-indexed) for the search path. "Which products contain
 * niacinamide" becomes `ingredient_slugs @> array['niacinamide']` — the same
 * indexed-array-containment pattern `concern_tags` already uses, not a join.
 * Nothing about what's searchable changed; only how the per-occurrence detail
 * is stored.
 *
 * Two small dictionaries, then the one big table:
 *
 *   catalog_brands       ~25,726 rows — deduped, trigram-searchable
 *   catalog_ingredients  ~20,016 rows — deduped, trigram-searchable.
 *                         functions/irritancy/comedogenicity/take are stable
 *                         per-ingredient properties (verified identical
 *                         across every product that lists the same ingredient
 *                         slug), so they live here once, looked up by slug
 *                         when a product's ingredient panel is displayed.
 *   catalog_products      ~183,181 rows — one per scraped product.
 *                         `concern_tags` is PRECOMPUTED at ingest time
 *                         (src/ingredient-concerns.mjs), same reasoning as
 *                         `ingredient_slugs` above: search-time cost should be
 *                         an index lookup, never a computation.
 */

import { neon } from '@neondatabase/serverless';

const STATEMENTS = [
  `create extension if not exists pg_trgm`,

  // Superseded by the denormalized shape on catalog_products below — see the
  // header comment for the measured reason (512MB cap, index overhead).
  `drop table if exists catalog_product_ingredients`,

  `create table if not exists catalog_brands (
     slug           text primary key,
     name           text not null,
     product_count  integer not null default 0,
     created_at     timestamptz not null default now()
   )`,

  `create index if not exists catalog_brands_name_trgm_idx
     on catalog_brands using gin (name gin_trgm_ops)`,

  `create table if not exists catalog_ingredients (
     id             serial primary key,
     slug           text not null unique,
     name           text not null,
     functions      text[] not null default '{}',
     irritancy      smallint,
     comedogenicity smallint,
     take           text,
     created_at     timestamptz not null default now()
   )`,

  `create index if not exists catalog_ingredients_name_trgm_idx
     on catalog_ingredients using gin (name gin_trgm_ops)`,

  // `source`/`source_slug` (rather than just `slug`) leaves room for a second
  // catalog source later without a schema change; incidecoder is the only one
  // today. `concern_tags` reuses the `analysis_concern` enum so a bad value
  // can't get in at the DB level — same type `trial_interventions.targets`
  // uses. Per CLAUDE.md's documented trap, every SELECT of this column must
  // cast `concern_tags::text[]` (the Neon driver doesn't parse enum-array
  // columns), same pattern as ITEM_COLUMNS in lib/routines.ts.
  //
  // `ingredients` is display data (this product's own panel, in order,
  // exactly as printed); `ingredient_slugs` is the search index over the same
  // occurrences, deduped. They are derived from the same source list at
  // ingest time and kept as two columns rather than one because their access
  // patterns differ completely — one is read whole on a product page, the
  // other is filtered inside a WHERE clause.
  `create table if not exists catalog_products (
     id                  uuid primary key default gen_random_uuid(),
     source              text not null default 'incidecoder',
     source_slug         text not null,
     brand_slug          text references catalog_brands(slug),
     brand_name          text,
     name                text not null,
     description         text,
     image_url           text,
     ingredient_count    smallint not null default 0,
     ingredients         jsonb not null default '[]',
     ingredient_slugs    text[] not null default '{}',
     concern_tags        analysis_concern[] not null default '{}',
     source_uploaded_by  text,
     source_uploaded_at  date,
     created_at          timestamptz not null default now(),
     updated_at          timestamptz not null default now(),
     unique (source, source_slug)
   )`,

  // A table that already existed before `ingredients`/`ingredient_slugs` were
  // added needs these explicitly — `create table if not exists` above is a
  // no-op once the table exists.
  `alter table catalog_products add column if not exists ingredients jsonb not null default '[]'`,
  `alter table catalog_products add column if not exists ingredient_slugs text[] not null default '{}'`,

  // Free-text name+brand search — index-accelerated ILIKE via pg_trgm.
  `create index if not exists catalog_products_name_trgm_idx
     on catalog_products using gin ((coalesce(brand_name, '') || ' ' || name) gin_trgm_ops)`,

  `create index if not exists catalog_products_concern_tags_idx
     on catalog_products using gin (concern_tags)`,

  `create index if not exists catalog_products_ingredient_slugs_idx
     on catalog_products using gin (ingredient_slugs)`,

  `create index if not exists catalog_products_brand_idx
     on catalog_products (brand_slug)`,
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run: vercel env pull .env.local --yes');
  process.exit(1);
}

const sql = neon(url);

const [enumExists] = await sql.query(`select 1 from pg_type where typname = $1`, ['analysis_concern']);
if (!enumExists) {
  console.error(
    'analysis_concern enum type not found — run scripts/migrate-routines.mjs first (catalog_products.concern_tags depends on it)',
  );
  process.exit(1);
}

for (const statement of STATEMENTS) {
  await sql.query(statement);
  console.log(`  ok  ${statement.split('\n')[0].trim().slice(0, 68)}`);
}

const [{ count }] = await sql`select count(*)::int as count from catalog_products`;
console.log(`\ncatalog tables ready — ${count} product(s) stored`);
