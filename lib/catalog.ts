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

export async function searchCatalog({
  q = null,
  brand = null,
  concern = null,
  ingredientSlug = null,
  limit = 24,
  offset = 0,
}: {
  q?: string | null;
  brand?: string | null;
  concern?: string | null;
  ingredientSlug?: string | null;
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
  if (concern && isAnalysisConcern(concern)) {
    params.push([concern]);
    conditions.push(`p.concern_tags @> $${params.length}::analysis_concern[]`);
  }
  if (ingredientSlug) {
    params.push([ingredientSlug]);
    conditions.push(`p.ingredient_slugs @> $${params.length}::text[]`);
  }

  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const orderBy = qRawIndex
    ? `order by similarity(coalesce(p.brand_name, '') || ' ' || p.name, $${qRawIndex}) desc`
    : `order by p.name asc`;

  params.push(limit);
  const limitIndex = params.length;
  params.push(offset);
  const offsetIndex = params.length;

  const rows = (await sql.query(
    `select p.id, p.brand_name, p.name, p.image_url, p.concern_tags::text[] as concern_tags,
            p.ingredient_count, count(*) over()::int as total
       from catalog_products p
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
    `select slug, name from catalog_ingredients
      where name ilike $1
      order by similarity(name, $2) desc
      limit $3`,
    [`%${trimmed}%`, trimmed, limit],
  );
  return (rows as { slug: string; name: string }[]).map((r) => ({ slug: r.slug, name: r.name }));
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
