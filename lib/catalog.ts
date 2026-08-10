import 'server-only';

import { getSql } from '@/lib/db';
import { isAnalysisConcern } from '@/src/concerns.mjs';

/**
 * The read path over the incidecoder product catalog
 * (scripts/import-catalog.mjs -> catalog_products / catalog_ingredients /
 * catalog_brands).
 *
 * Public reference data, not user-owned — unlike lib/routines.ts and
 * lib/trial-store.ts, nothing here takes an owner argument. It is also a
 * *different* "products" concept from lib/community.ts's `CommunityProduct`
 * (products someone has actually put on trial, keyed by src/products.mjs's
 * hash-based productKey): this module never touches those tables.
 *
 * Every filter (name, brand, ingredient, concern) is index-driven — see
 * scripts/migrate-catalog.mjs for the trigram/GIN/btree indexes each one
 * relies on, and its header comment for why ingredient occurrences are a
 * jsonb column + a GIN-indexed slug array on `catalog_products` rather than a
 * link table (a link table blew Neon's 512MB free-tier cap on its indexes
 * alone) — so combining filters stays fast at 183k rows without computing
 * anything at query time.
 */

export interface CatalogSearchResult {
  id: string;
  brand: string | null;
  name: string;
  image: string | null;
  concernTags: string[];
  ingredientCount: number;
}

export interface CatalogIngredientPanelRow {
  slug: string;
  /** As printed on this product's own panel — e.g. "Water/Aqua" vs "Aqua
   *  (H2O'S Fancy Name)" for the same ingredient on a different product. */
  name: string;
  functions: string[];
  irritancy: number | null;
  comedogenicity: number | null;
  take: string | null;
}

export interface CatalogProductDetail extends CatalogSearchResult {
  description: string | null;
  ingredients: CatalogIngredientPanelRow[];
}

export interface CatalogIngredientOption {
  slug: string;
  name: string;
  functions: string[];
}

export interface CatalogBrandOption {
  slug: string;
  name: string;
  productCount: number;
}

export interface CatalogPickerMatch {
  id: string;
  brand: string | null;
  name: string;
  image: string | null;
  /** Ordered INCI names, for classifyProduct — the real ingredient list is
   *  strictly stronger evidence for targets[] than a typed name alone
   *  (docs/product-identity.md). */
  inci: string[];
}

interface CatalogProductRow {
  id: string;
  brand_name: string | null;
  name: string;
  image_url: string | null;
  concern_tags: string[];
  ingredient_count: number;
  total?: number;
}

interface StoredIngredientEntry {
  slug: string;
  name: string;
  position: number;
}

function toSearchResult(row: CatalogProductRow): CatalogSearchResult {
  return {
    id: row.id,
    brand: row.brand_name,
    name: row.name,
    image: row.image_url,
    concernTags: row.concern_tags,
    ingredientCount: row.ingredient_count,
  };
}

/**
 * `relevance` only means anything alongside a text query (it falls back to
 * `az` without one — see the `az` case below). `trending` and `most-used`
 * both measure real usage across trials and routines, matched by catalog id
 * only (the same catalog-id-only join `countProductUsersByCatalogId` uses);
 * they differ in window — `trending` counts only trials with a capture or
 * check-in in the last 7 days (mirrors `listTrendingProducts()` in
 * lib/community.ts), `most-used` counts all-time distinct users. `unused` is
 * `most-used` ascending, not a filter — it surfaces the catalog's long tail
 * rather than hiding everything else.
 */
export type CatalogSort = 'relevance' | 'recent' | 'trending' | 'az' | 'za' | 'most-used' | 'unused';

const TRENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Every catalog id with at least one distinct user in a trial or routine —
 *  the join `most-used`/`unused` sort against. Catalog-id matches only, same
 *  as `countProductUsersByCatalogId`. */
const USAGE_JOIN = `
       left join (
         select id, count(distinct user_id) as n from (
           select v.catalog_product_id as id, t.user_id from trial_interventions v
             join trials t on t.id = v.trial_id
            where v.catalog_product_id is not null
           union
           select i.catalog_product_id as id, r.user_id from routine_items i
             join routines r on r.id = i.routine_id
            where i.catalog_product_id is not null
         ) matched group by id
       ) usage on usage.id = p.id`;

export async function searchCatalog({
  q = null,
  brand = null,
  concerns = [],
  ingredientSlug = null,
  productIds = null,
  sort = 'relevance',
  limit = 24,
  offset = 0,
}: {
  q?: string | null;
  brand?: string | null;
  /** AND semantics: a result must carry every concern in the list, via a
   *  single `@>` containment check against the whole array. */
  concerns?: string[];
  ingredientSlug?: string | null;
  /** Restricts results to this id set — the "trialled by community" toggle
   *  on /search, which can only ever match products with a catalog row. */
  productIds?: string[] | null;
  sort?: CatalogSort;
  limit?: number;
  offset?: number;
}): Promise<{ results: CatalogSearchResult[]; total: number }> {
  const sql = getSql();
  const conditions: string[] = [];
  const params: unknown[] = [];
  let qRawIndex: number | null = null;

  const trimmedQ = q?.trim();
  if (trimmedQ) {
    params.push(`%${trimmedQ}%`);
    conditions.push(`(coalesce(p.brand_name, '') || ' ' || p.name) ilike $${params.length}`);
    params.push(trimmedQ);
    qRawIndex = params.length;
  }
  if (brand) {
    params.push(brand);
    conditions.push(`p.brand_slug = $${params.length}`);
  }
  // Silently drop an unrecognised concern rather than let a bad `?concern=`
  // query param reach the `analysis_concern[]` cast and 500.
  const validConcerns = concerns.filter(isAnalysisConcern);
  if (validConcerns.length > 0) {
    params.push(validConcerns);
    conditions.push(`p.concern_tags @> $${params.length}::analysis_concern[]`);
  }
  if (ingredientSlug) {
    params.push([ingredientSlug]);
    conditions.push(`p.ingredient_slugs @> $${params.length}::text[]`);
  }
  if (productIds) {
    if (productIds.length === 0) return { results: [], total: 0 }; // nothing to match
    params.push(productIds);
    conditions.push(`p.id = any($${params.length}::uuid[])`);
  }

  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  let joins = '';
  let orderBy: string;
  switch (sort) {
    case 'recent':
      orderBy = `order by p.created_at desc`;
      break;
    case 'trending': {
      params.push(new Date(Date.now() - TRENDING_WINDOW_MS));
      const sinceIndex = params.length;
      joins = `
       left join (
         select v.catalog_product_id as id, count(distinct v.trial_id) as n
           from trial_interventions v
           join trials t on t.id = v.trial_id
          where v.catalog_product_id is not null
            and v.trial_id in (
              select trial_id from trial_captures where captured_at >= $${sinceIndex}
              union
              select trial_id from trial_applications where applied_at >= $${sinceIndex}
            )
          group by v.catalog_product_id
       ) trending on trending.id = p.id`;
      orderBy = `order by coalesce(trending.n, 0) desc, p.name asc`;
      break;
    }
    case 'most-used':
      joins = USAGE_JOIN;
      orderBy = `order by coalesce(usage.n, 0) desc, p.name asc`;
      break;
    case 'unused':
      joins = USAGE_JOIN;
      orderBy = `order by coalesce(usage.n, 0) asc, p.name asc`;
      break;
    case 'za':
      orderBy = `order by p.name desc`;
      break;
    case 'az':
      orderBy = `order by p.name asc`;
      break;
    case 'relevance':
    default:
      orderBy = qRawIndex
        ? `order by similarity(coalesce(p.brand_name, '') || ' ' || p.name, $${qRawIndex}) desc`
        : `order by p.name asc`;
      break;
  }

  params.push(limit);
  const limitIndex = params.length;
  params.push(offset);
  const offsetIndex = params.length;

  const rows = (await sql.query(
    `select p.id, p.brand_name, p.name, p.image_url, p.concern_tags::text[] as concern_tags,
            p.ingredient_count, count(*) over()::int as total
       from catalog_products p
       ${joins}
       ${where}
       ${orderBy}
       limit $${limitIndex} offset $${offsetIndex}`,
    params,
  )) as CatalogProductRow[];

  return {
    results: rows.map(toSearchResult),
    total: rows.length ? rows[0].total! : 0,
  };
}

/**
 * Which of the given catalog ids carry this ingredient — the ingredient
 * facet's cross-tab reach onto /search's Trials and Routines tabs. Those
 * items store brand/name/targets directly (no catalog lookup needed to
 * filter by brand or concern), but never an ingredient list, so an
 * ingredient filter can only match an item through its frozen
 * `catalogProductId`.
 */
export async function catalogProductIdsWithIngredient(
  ids: string[],
  ingredientSlug: string,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const sql = getSql();
  const rows = (await sql.query(
    `select id from catalog_products where id = any($1::uuid[]) and ingredient_slugs @> $2::text[]`,
    [ids, [ingredientSlug]],
  )) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

export async function getCatalogProduct(id: string): Promise<CatalogProductDetail | null> {
  const sql = getSql();
  let productRows: (CatalogProductRow & { description: string | null; ingredients: StoredIngredientEntry[] })[];
  try {
    productRows = (await sql.query(
      `select id, brand_name, name, description, image_url,
              concern_tags::text[] as concern_tags, ingredient_count, ingredients
         from catalog_products where id = $1`,
      [id],
    )) as (CatalogProductRow & { description: string | null; ingredients: StoredIngredientEntry[] })[];
  } catch {
    return null; // malformed id (not a uuid) — 404, not a 500
  }
  const product = productRows[0];
  if (!product) return null;

  const panel = [...product.ingredients].sort((a, b) => a.position - b.position);
  const slugs = panel.map((i) => i.slug);

  // catalog_ingredients is small (~20k rows, ~15MB total) — one lookup for
  // this product's handful of ingredients, not a bulk scan.
  const dictRows =
    slugs.length === 0
      ? []
      : ((await sql.query(
          `select slug, functions, irritancy, comedogenicity, take
             from catalog_ingredients where slug = any($1::text[])`,
          [slugs],
        )) as { slug: string; functions: string[]; irritancy: number | null; comedogenicity: number | null; take: string | null }[]);
  const dictBySlug = new Map(dictRows.map((d) => [d.slug, d]));

  return {
    ...toSearchResult(product),
    description: product.description,
    ingredients: panel.map((entry) => {
      const dict = dictBySlug.get(entry.slug);
      return {
        slug: entry.slug,
        name: entry.name,
        functions: dict?.functions ?? [],
        irritancy: dict?.irritancy ?? null,
        comedogenicity: dict?.comedogenicity ?? null,
        take: dict?.take ?? null,
      };
    }),
  };
}

export async function searchCatalogIngredients(q: string, limit = 8): Promise<CatalogIngredientOption[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const sql = getSql();
  const rows = await sql.query(
    `select slug, name, functions from catalog_ingredients
      where name ilike $1
      order by similarity(name, $2) desc
      limit $3`,
    [`%${trimmed}%`, trimmed, limit],
  );
  return (rows as { slug: string; name: string; functions: string[] }[]).map((r) => ({
    slug: r.slug,
    name: r.name,
    functions: r.functions,
  }));
}

export async function searchCatalogBrands(q: string, limit = 8): Promise<CatalogBrandOption[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const sql = getSql();
  const rows = await sql.query(
    `select slug, name, product_count from catalog_brands
      where name ilike $1
      order by similarity(name, $2) desc
      limit $3`,
    [`%${trimmed}%`, trimmed, limit],
  );
  return (rows as { slug: string; name: string; product_count: number }[]).map((r) => ({
    slug: r.slug,
    name: r.name,
    productCount: r.product_count,
  }));
}

/** Top name/brand matches with their full INCI list attached, for the
 *  trial-creation product picker's autocomplete. */
export async function searchCatalogForPicker(q: string, limit = 6): Promise<CatalogPickerMatch[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const sql = getSql();

  const rows = (await sql.query(
    `select id, brand_name, name, image_url, ingredients
       from catalog_products
      where (coalesce(brand_name, '') || ' ' || name) ilike $1
      order by similarity(coalesce(brand_name, '') || ' ' || name, $2) desc
      limit $3`,
    [`%${trimmed}%`, trimmed, limit],
  )) as {
    id: string;
    brand_name: string | null;
    name: string;
    image_url: string | null;
    ingredients: StoredIngredientEntry[];
  }[];

  return rows.map((r) => ({
    id: r.id,
    brand: r.brand_name,
    name: r.name,
    image: r.image_url,
    inci: [...r.ingredients].sort((a, b) => a.position - b.position).map((i) => i.name),
  }));
}
