#!/usr/bin/env node
/**
 * Daily incremental catalog update. incidecoder gains new products roughly
 * daily, and a full sitemap re-crawl (scripts/scrape-incidecoder.mjs) to find
 * them would be wasteful — this instead polls `/products/new` (~200 newest
 * slugs, one page, no pagination, no auth), diffs against what's already in
 * Neon, and fetches only the slugs that are actually new. See
 * docs/product-identity.md, "The INCIdecoder catalog", for the full design
 * and why this waited on the bulk migration finishing first.
 *
 * Meant to run unattended on a schedule with no persistent disk (see
 * .github/workflows/sync-catalog.yml) — unlike the bulk crawler, this never
 * touches skincare-data/raw/; it writes straight to Neon via the same
 * upsert helpers scripts/import-catalog.mjs uses (src/catalog-ingest.mjs),
 * and reuses scripts/scrape-incidecoder.mjs's fetch/backoff/self-throttle
 * contract (src/incidecoder-fetch.mjs) rather than a second implementation.
 *
 * Concurrency is fixed at 1: at most a couple hundred candidate slugs a day,
 * nearly all of which are usually already known, so there's no volume here
 * that would justify the same politeness trade-off the bulk crawler makes.
 *
 * Usage:
 *   node --env-file=.env.local scripts/sync-catalog.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-catalog.mjs
 */

import { neon } from '@neondatabase/serverless';
import { INCIDECODER_BASE, createFetcher } from '../src/incidecoder-fetch.mjs';
import { parseNewProductsPage, parseProductPage } from '../src/incidecoder.mjs';
import { buildProductRow, collectIngredientRows, upsertBrands, upsertIngredients, upsertProducts } from '../src/catalog-ingest.mjs';

const DRY = process.argv.includes('--dry-run');
const DELAY_MS = 1000; // same pacing scrape-incidecoder.mjs defaults to

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Run: vercel env pull .env.local --yes');
    process.exit(1);
  }
  const sql = neon(url);

  const breaker = { pausedUntil: 0, concurrency: 1 };
  const fetchPage = createFetcher({
    delayMs: DELAY_MS,
    breaker,
    onRateLimited: (backoffMs) =>
      console.log(`  429 rate-limited — backing off ${Math.round(backoffMs / 1000)}s`),
  });

  console.log('fetching /products/new...');
  const listingHtml = await fetchPage(`${INCIDECODER_BASE}/products/new`);
  if (!listingHtml) throw new Error('/products/new returned 404 — unexpected');

  const slugs = parseNewProductsPage(listingHtml);
  if (slugs.length === 0) throw new Error('/products/new listed 0 slugs — parser likely broke, not an empty catalog');
  console.log(`  ${slugs.length} slug(s) on the page`);

  const [{ existing }] = await sql.query(
    `select array_agg(source_slug) as existing
       from catalog_products
      where source = 'incidecoder' and source_slug = any($1::text[])`,
    [slugs],
  );
  const known = new Set(existing ?? []);
  const todo = slugs.filter((slug) => !known.has(slug));
  console.log(`  ${slugs.length - todo.length} already in the catalog, ${todo.length} new\n`);

  if (DRY) {
    console.log('--dry-run: nothing fetched beyond the listing page, nothing written.\n');
    return;
  }
  if (todo.length === 0) {
    console.log('done: nothing new today\n');
    return;
  }

  let inserted = 0;
  let notFound = 0;

  for (const slug of todo) {
    const html = await fetchPage(`${INCIDECODER_BASE}/products/${slug}`);
    const product = html ? parseProductPage(html, slug) : null;
    if (!product) {
      notFound += 1;
      process.stdout.write(`\r  ${inserted + notFound}/${todo.length} (${inserted} inserted, ${notFound} not-found)   `);
      continue;
    }

    const ingredientRows = collectIngredientRows(product.ingredients);
    if (ingredientRows.length) await upsertIngredients(sql, ingredientRows);
    if (product.brand?.slug) {
      await upsertBrands(sql, [{ slug: product.brand.slug, name: product.brand.name, count: 1 }], { increment: true });
    }
    await upsertProducts(sql, [buildProductRow(product)]);

    inserted += 1;
    process.stdout.write(`\r  ${inserted + notFound}/${todo.length} (${inserted} inserted, ${notFound} not-found)   `);
  }

  console.log(`\n\ndone: ${inserted} new product(s) inserted, ${notFound} not-found\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
