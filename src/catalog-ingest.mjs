/**
 * Shared write path into the `catalog_*` Neon tables (see
 * scripts/migrate-catalog.mjs for the schema), used by both the one-time
 * bulk loader (scripts/import-catalog.mjs) and the daily incremental sync
 * (scripts/sync-catalog.mjs) — one implementation of the upsert SQL rather
 * than two that could silently diverge on a column or a cast.
 *
 * Every write here is `on conflict ... do update`, keyed on natural identity
 * (ingredient slug, brand slug, (source, source_slug) for products), so
 * calling any of these twice with the same input is always safe.
 */

import { deriveConcernTags } from './ingredient-concerns.mjs';

/**
 * `casts[c]` (e.g. `'::text[]'`) is applied to every placeholder in column
 * `c`, for every row — the neon serverless driver needs the explicit cast to
 * know how to bind a JS array/jsonb into a typed column (confirmed against
 * the working pattern in scripts/seed-dev-trial.mjs).
 */
function valuesClause(rowCount, casts) {
  const rows = [];
  let p = 1;
  for (let r = 0; r < rowCount; r++) {
    const cols = casts.map((cast) => `$${p++}${cast}`);
    rows.push(`(${cols.join(', ')})`);
  }
  return rows.join(',\n    ');
}

const INGREDIENT_CASTS = ['', '', '::text[]', '', '', ''];

/** rows: `{ slug, name, functions, irritancy, comedogenicity, take }[]`. */
export async function upsertIngredients(sql, rows) {
  if (!rows.length) return;
  const text = `
    insert into catalog_ingredients (slug, name, functions, irritancy, comedogenicity, take)
    values
    ${valuesClause(rows.length, INGREDIENT_CASTS)}
    on conflict (slug) do update set
      name = excluded.name,
      functions = excluded.functions,
      irritancy = excluded.irritancy,
      comedogenicity = excluded.comedogenicity,
      take = excluded.take`;
  const params = rows.flatMap((r) => [r.slug, r.name, r.functions, r.irritancy, r.comedogenicity, r.take]);
  await sql.query(text, params);
}

const BRAND_CASTS = ['', '', ''];

/**
 * rows: `{ slug, name, count }[]`. `count` is written as-is by default (the
 * bulk import already scanned every file and knows the true total), but the
 * daily sync only ever sees the handful of brand-new products in one run —
 * for that caller, `increment: true` adds to whatever's already stored
 * instead of overwriting it with that small number.
 */
export async function upsertBrands(sql, rows, { increment = false } = {}) {
  if (!rows.length) return;
  const text = `
    insert into catalog_brands (slug, name, product_count)
    values
    ${valuesClause(rows.length, BRAND_CASTS)}
    on conflict (slug) do update set
      name = excluded.name,
      product_count = ${increment ? 'catalog_brands.product_count + excluded.product_count' : 'excluded.product_count'}`;
  const params = rows.flatMap((r) => [r.slug, r.name, r.count]);
  await sql.query(text, params);
}

const PRODUCT_CASTS = [
  '', '', '', '', '', '', '', '', '::jsonb', '::text[]', '::analysis_concern[]', '', '::date',
];

/** rows: the shape `buildProductRow()` below returns. */
export async function upsertProducts(sql, rows) {
  if (!rows.length) return;
  const text = `
    insert into catalog_products
      (source, source_slug, brand_slug, brand_name, name, description, image_url,
       ingredient_count, ingredients, ingredient_slugs, concern_tags,
       source_uploaded_by, source_uploaded_at)
    values
    ${valuesClause(rows.length, PRODUCT_CASTS)}
    on conflict (source, source_slug) do update set
      brand_slug = excluded.brand_slug,
      brand_name = excluded.brand_name,
      name = excluded.name,
      description = excluded.description,
      image_url = excluded.image_url,
      ingredient_count = excluded.ingredient_count,
      ingredients = excluded.ingredients,
      ingredient_slugs = excluded.ingredient_slugs,
      concern_tags = excluded.concern_tags,
      source_uploaded_by = excluded.source_uploaded_by,
      source_uploaded_at = excluded.source_uploaded_at,
      updated_at = now()`;
  const params = rows.flatMap((r) => [
    r.source, r.sourceSlug, r.brandSlug, r.brandName, r.name, r.description,
    r.imageUrl, r.ingredientCount, r.ingredients, r.ingredientSlugs, r.concernTags,
    r.uploadedBy, r.uploadedAt,
  ]);
  await sql.query(text, params);
}

/**
 * One `parseProductPage()` record (src/incidecoder.mjs) -> the row shape
 * `upsertProducts()` expects, including the precomputed concern tags
 * (src/ingredient-concerns.mjs) and the deduped ingredient-slug search index.
 */
export function buildProductRow(p) {
  const ings = p.ingredients ?? [];
  const panel = ings.map((i) => ({ slug: i.slug, name: i.name, position: i.position }));
  return {
    source: 'incidecoder',
    sourceSlug: p.slug,
    brandSlug: p.brand?.slug ?? null,
    brandName: p.brand?.name ?? null,
    name: p.name,
    description: p.description ?? null,
    imageUrl: p.image ?? null,
    ingredientCount: ings.length,
    ingredients: JSON.stringify(panel),
    ingredientSlugs: [...new Set(ings.map((i) => i.slug))],
    concernTags: deriveConcernTags(ings),
    uploadedBy: p.uploadedBy ?? null,
    uploadedAt: p.uploadedAt ?? null,
  };
}

/**
 * One product's ingredients -> the row shape `upsertIngredients()` expects.
 * `functions` comes in as `[{ slug, name }]` from the parser; only the slug
 * is stored, matching what `catalog_ingredients.functions` already holds.
 * Deduplicates by slug since the same ingredient may appear multiple times
 * in a product's ingredient list.
 */
export function collectIngredientRows(ingredients) {
  const seen = new Set();
  const rows = [];
  for (const i of ingredients ?? []) {
    if (seen.has(i.slug)) continue;
    seen.add(i.slug);
    rows.push({
      slug: i.slug,
      name: i.name,
      functions: (i.functions ?? []).map((f) => f.slug),
      irritancy: i.irritancy ?? null,
      comedogenicity: i.comedogenicity ?? null,
      take: i.take ?? null,
    });
  }
  return rows;
}
