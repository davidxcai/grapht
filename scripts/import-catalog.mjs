#!/usr/bin/env node
/**
 * Load the incidecoder scrape (skincare-data/raw/incidecoder/products/*.json,
 * gitignored, ~183,181 files as of 2026-08-08) into the Neon catalog tables
 * created by scripts/migrate-catalog.mjs. Free — no YouCam units, no Gemini
 * call, reads only what scripts/scrape-incidecoder.mjs already fetched.
 *
 * Two phases, same order the schema demands (products reference the brand
 * dictionary, and searching by ingredient needs the ingredient dictionary
 * populated first even though there's no longer a foreign key to it — see
 * below):
 *
 *   A  ingredients + brands   one pass over every file, deduped in memory
 *      (functions/irritancy/comedogenicity/take are stable per ingredient —
 *      verified in docs/product-identity.md — so first-seen wins), batched
 *      upserts.
 *   B  products                a second pass, chunked. Each product carries
 *      its own ingredient occurrences inline: `ingredients` (jsonb, display —
 *      slug/name/position, in panel order) and `ingredient_slugs` (text[],
 *      deduped, GIN-indexed — the search path).
 *
 * **Why ingredients live on the product row instead of a link table:** the
 * first version of this script wrote a `catalog_product_ingredients` table,
 * one row per (product, ingredient) occurrence (~4.9M rows), and it blew
 * Neon's free-tier 512MB project cap 45% of the way through — measured at
 * 2.17M rows, its two B-tree indexes (223MB) already cost more than the row
 * data itself (154MB). Denormalizing onto `catalog_products` removes both the
 * per-row tuple overhead and one of the two indexes; see the header comment
 * in scripts/migrate-catalog.mjs for the full measurement. Nothing about
 * ingredient identity duplicates: `catalog_ingredients` still holds the
 * functions/ratings once each, looked up by slug when a product page renders.
 *
 * Idempotent: every insert is `on conflict ... do update`, keyed on natural
 * identity (ingredient slug, brand slug, (source, source_slug) for products)
 * — a re-run or an interrupted run is always safe to redo from scratch.
 *
 * Usage:
 *   node scripts/import-catalog.mjs --dry-run              # parse + report, no DB writes
 *   node scripts/import-catalog.mjs --dry-run --limit 2000
 *   node scripts/import-catalog.mjs --limit 2000            # real, small
 *   node scripts/import-catalog.mjs                         # full run
 *   node scripts/import-catalog.mjs --concurrency 8
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { buildProductRow, upsertBrands, upsertIngredients, upsertProducts } from '../src/catalog-ingest.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
};

const DRY = has('--dry-run');
const LIMIT = num('--limit', 0);
const CONCURRENCY = Math.max(1, num('--concurrency', 4));

const PRODUCTS_DIR = 'skincare-data/raw/incidecoder/products';
const INGREDIENT_BATCH = 1000;
const BRAND_BATCH = 1000;
const PRODUCT_CHUNK = 500; // per-chunk file count for phase B

/* ---------- tiny helpers ---------- */

function listProductFiles() {
  const files = readdirSync(PRODUCTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort(); // deterministic --limit slicing across runs
  return LIMIT > 0 ? files.slice(0, LIMIT) : files;
}

function loadProduct(file) {
  return JSON.parse(readFileSync(join(PRODUCTS_DIR, file), 'utf8'));
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapLimit(items, limit, fn) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ---------- phase A: ingredients + brands ---------- */

/** One pass over every file. Populates catalog_ingredients/catalog_brands and
 *  returns counts for reporting. */
async function runPhaseA(sql, files) {
  const ingredients = new Map(); // slug -> {slug, name, functions, irritancy, comedogenicity, take}
  const brands = new Map(); // slug -> {slug, name, count}
  const seenProductSlugs = new Set();
  let productsWithIngredients = 0;
  let ingredientOccurrences = 0;
  let duplicateFiles = 0;

  for (let i = 0; i < files.length; i++) {
    const p = loadProduct(files[i]);
    if (!p || p.notFound) continue;

    // A handful of products are cached under two different filenames for the
    // same underlying slug — an artifact of scripts/scrape-incidecoder.mjs's
    // long-slug filename truncation being added after some files were already
    // written (measured: 9 pairs across 183,181 files). The file, not the
    // slug, is the duplicate — skip every occurrence after the first.
    if (seenProductSlugs.has(p.slug)) {
      duplicateFiles += 1;
      continue;
    }
    seenProductSlugs.add(p.slug);

    if (p.brand?.slug) {
      const existing = brands.get(p.brand.slug);
      if (existing) existing.count += 1;
      else brands.set(p.brand.slug, { slug: p.brand.slug, name: p.brand.name, count: 1 });
    }

    const ings = p.ingredients ?? [];
    if (ings.length) productsWithIngredients += 1;
    for (const ing of ings) {
      ingredientOccurrences += 1;
      if (!ingredients.has(ing.slug)) {
        ingredients.set(ing.slug, {
          slug: ing.slug,
          name: ing.name,
          functions: (ing.functions ?? []).map((f) => f.slug),
          irritancy: ing.irritancy ?? null,
          comedogenicity: ing.comedogenicity ?? null,
          take: ing.take ?? null,
        });
      }
    }

    if ((i + 1) % 20000 === 0 || i + 1 === files.length) {
      process.stdout.write(`\r  [phase A] scanned ${i + 1}/${files.length} files   `);
    }
  }
  console.log('');

  if (!DRY) {
    const ingredientBatches = chunk([...ingredients.values()], INGREDIENT_BATCH);
    const brandBatches = chunk([...brands.values()], BRAND_BATCH);
    let done = 0;
    await mapLimit(ingredientBatches, CONCURRENCY, async (batch) => {
      await upsertIngredients(sql, batch);
      done += 1;
      process.stdout.write(`\r  [phase A] ingredient batches ${done}/${ingredientBatches.length}   `);
    });
    console.log('');
    done = 0;
    await mapLimit(brandBatches, CONCURRENCY, async (batch) => {
      await upsertBrands(sql, batch);
      done += 1;
      process.stdout.write(`\r  [phase A] brand batches ${done}/${brandBatches.length}   `);
    });
    console.log('');
  }

  return { ingredients, brands, productsWithIngredients, ingredientOccurrences, duplicateFiles };
}

/* ---------- phase B: products (ingredients denormalized inline) ---------- */

async function processChunk(sql, files) {
  const products = [];
  const seenProductSlugs = new Set();

  for (const file of files) {
    const p = loadProduct(file);
    if (!p || p.notFound) continue;
    if (seenProductSlugs.has(p.slug)) continue; // see runPhaseA's matching guard
    seenProductSlugs.add(p.slug);
    products.push(buildProductRow(p));
  }

  if (products.length === 0) return 0;
  await upsertProducts(sql, products);
  return products.length;
}

async function runPhaseB(sql, files) {
  const chunks = chunk(files, PRODUCT_CHUNK);
  let doneChunks = 0;
  let totalProducts = 0;

  await mapLimit(chunks, CONCURRENCY, async (fileChunk) => {
    // Split from `totalProducts +=` deliberately: with an await inline in a
    // compound assignment, concurrent workers race to read the pre-await
    // value and lose updates. Awaiting into `n` first, then incrementing on
    // its own synchronous line (no await inside it), makes the increment
    // atomic — measured: without this split, 4-way concurrency undercounted
    // a 30k-file run's total by two-thirds even though every row was written
    // correctly (the counter is purely cosmetic; upsertProducts is what
    // matters and was never affected).
    const n = await processChunk(sql, fileChunk);
    totalProducts += n;
    doneChunks += 1;
    process.stdout.write(`\r  [phase B] ${doneChunks}/${chunks.length} chunks — ${totalProducts} products   `);
  });
  console.log('');

  return totalProducts;
}

/* ---------- main ---------- */

async function main() {
  if (!existsSync(PRODUCTS_DIR)) {
    console.error(`${PRODUCTS_DIR} not found — run scripts/scrape-incidecoder.mjs first`);
    process.exit(1);
  }

  const files = listProductFiles();
  console.log(`\n${files.length} product file(s) to process${LIMIT ? ` (--limit ${LIMIT})` : ''}\n`);

  let sql = null;
  if (!DRY) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.error('DATABASE_URL is not set. Run: vercel env pull .env.local --yes');
      process.exit(1);
    }
    sql = neon(url);
  }

  const startedAt = Date.now();

  const { ingredients, brands, productsWithIngredients, ingredientOccurrences, duplicateFiles } = await runPhaseA(
    sql,
    files,
  );

  if (DRY) {
    console.log(`\n--dry-run: nothing written.\n`);
    console.log(`  products                 ${files.length}`);
    console.log(`  duplicate files skipped   ${duplicateFiles}`);
    console.log(`  products with ingredients ${productsWithIngredients}`);
    console.log(`  ingredient occurrences    ${ingredientOccurrences}`);
    console.log(`  unique ingredients        ${ingredients.size}`);
    console.log(`  unique brands             ${brands.size}\n`);
    return;
  }

  console.log(`  [phase A] ${ingredients.size} ingredient(s), ${brands.size} brand(s) upserted\n`);

  const totalProducts = await runPhaseB(sql, files);

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\ndone: ${totalProducts} products, ${elapsedMin}m elapsed\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
