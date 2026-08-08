#!/usr/bin/env node
/**
 * Crawl incidecoder.com for its name -> full INCI ingredient list mapping —
 * the only public source of that mapping at this scale (no API exists).
 * `skincare-data/` otherwise has 36 corroborated barcode products; this is a
 * separate, much larger source keyed by name rather than barcode.
 *
 * Two phases sharing one request budget:
 *   sitemap    fetch sitemap-index.xml, then every sitemap-products.N.xml it
 *              lists (2000 slugs/chunk) — the full slug index in ~92
 *              requests. 183,173 products as of 2026-08-07 (91 full chunks of
 *              2000 + a 1173 remainder), confirmed by reading the sitemap
 *              rather than extrapolating from a partial crawl. This replaced
 *              walking /products/all?offset=N (48 products/page): same
 *              catalog, ~40x fewer requests, and it also hands back each
 *              product's image URL and lastmod for free.
 *   products   fetch /products/<slug> for every slug the index knows about
 *              that isn't cached yet
 *
 * Self-throttled: each of `--concurrency` workers (default 1) paces its own
 * requests `--delay` ms apart (default 1000ms), so aggregate rate is roughly
 * concurrency req/s. A single hour-long run at concurrency 1 produced zero
 * 429s, so a modest concurrency has headroom — but there is no declared
 * Crawl-delay in robots.txt and this is a small team's server, so treat any
 * concurrency above 1 as an experiment, not a default.
 *
 * **429 is a one-way ratchet, not a per-worker retry.** The instant any
 * worker sees one, every worker's next request waits out the shared backoff
 * (Retry-After if sent, else 60s), AND concurrency permanently drops to 1 for
 * the rest of the run — back to the one setting already proven safe, rather
 * than probing for the actual edge. It does not climb back up once the run
 * has backed off.
 *
 * Stops itself after a wall-clock budget (`--minutes`, default 60) so a
 * single invocation never runs away.
 *
 * Fully resumable and idempotent: every fetched page is cached to disk keyed
 * by what it is (offset or slug), so a re-run only fetches what's missing —
 * same discipline as scripts/harvest-barcodes.mjs. Parsing lives in
 * src/incidecoder.mjs, separate from fetching, so a parser fix is a free
 * re-read of cached HTML rather than a re-scrape.
 *
 * robots.txt (checked 2026-08-07): `Allow: /`, only /auth/ and
 * /products/recommend/ disallowed, no Crawl-delay — this only ever reads
 * /products/all and /products/<slug>.
 *
 * Usage:
 *   node scripts/scrape-incidecoder.mjs --report               # cache stats, no network
 *   node scripts/scrape-incidecoder.mjs --dry-run               # what the next run would do
 *   node scripts/scrape-incidecoder.mjs                         # 60 min, concurrency 1: sitemap then products
 *   node scripts/scrape-incidecoder.mjs --minutes 5 --mode sitemap
 *   node scripts/scrape-incidecoder.mjs --mode products --minutes 30 --concurrency 4
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseSitemapIndex, parseSitemapChunk, parseProductPage } from '../src/incidecoder.mjs';
import { createFetcher as createSharedFetcher } from '../src/incidecoder-fetch.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
};
const str = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const BASE = 'https://incidecoder.com';
const SITEMAP_DIR = 'skincare-data/raw/incidecoder/sitemap';
const SITEMAP_INDEX_FILE = join(SITEMAP_DIR, 'sitemap-index.xml');
const PRODUCTS_DIR = 'skincare-data/raw/incidecoder/products';

const MINUTES = num('--minutes', 60);
const DELAY_MS = num('--delay', 1000);
const MODE = str('--mode', 'all'); // sitemap | products | all
const CONCURRENCY = Math.max(1, num('--concurrency', 1));
const DRY = has('--dry-run');
const REPORT = has('--report');

function save(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function saveText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Chunk filenames the cached sitemap index lists, or `null` if not fetched yet. */
function loadSitemapChunkList() {
  if (!existsSync(SITEMAP_INDEX_FILE)) return null;
  return parseSitemapIndex(readFileSync(SITEMAP_INDEX_FILE, 'utf8'));
}

/**
 * Every sitemap chunk cached so far -> deduped `Set<slug>`. A `Set` of bare
 * strings rather than a `Map` to `{ image, lastmod }`: nothing downstream
 * reads either field (the product-page fetch is the authoritative source for
 * both), and at 183k entries the wrapper objects alone cost tens of MB for
 * data nobody looks at.
 */
function loadSlugSet() {
  const slugs = new Set();
  if (!existsSync(SITEMAP_DIR)) return slugs;
  for (const file of readdirSync(SITEMAP_DIR)) {
    if (!file.endsWith('.xml') || file === 'sitemap-index.xml') continue;
    const xml = readFileSync(join(SITEMAP_DIR, file), 'utf8');
    for (const { slug } of parseSitemapChunk(xml)) slugs.add(slug);
  }
  return slugs;
}

function countCached(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith('.json')).length;
}

// Most slugs are short and this is a no-op. A handful of user-submitted
// products have a slug that's their entire marketing copy, slugified — one
// observed at 791 characters, well past the 255-byte filename limit most
// filesystems enforce. Truncate and disambiguate with a content hash rather
// than crash: the full slug is still recorded inside the JSON itself, so
// nothing about the product's identity is lost, only the filename shortens.
function productFilePath(slug) {
  const MAX_SLUG_CHARS = 150;
  if (slug.length <= MAX_SLUG_CHARS) return join(PRODUCTS_DIR, `${slug}.json`);
  const hash = createHash('sha256').update(slug).digest('hex').slice(0, 12);
  return join(PRODUCTS_DIR, `${slug.slice(0, MAX_SLUG_CHARS)}-${hash}.json`);
}

const fmtMin = (ms) => `${(ms / 60000).toFixed(1)}m`;

async function main() {
  if (REPORT) {
    const chunkFiles = loadSitemapChunkList();
    const chunksCached = existsSync(SITEMAP_DIR)
      ? readdirSync(SITEMAP_DIR).filter((f) => f.endsWith('.xml') && f !== 'sitemap-index.xml').length
      : 0;
    const slugIndex = loadSlugSet();
    const productsCached = countCached(PRODUCTS_DIR);
    const notFound = existsSync(PRODUCTS_DIR)
      ? readdirSync(PRODUCTS_DIR).filter((f) => {
          try {
            return JSON.parse(readFileSync(join(PRODUCTS_DIR, f), 'utf8')).notFound;
          } catch {
            return false;
          }
        }).length
      : 0;
    console.log(
      `\nsitemap     ${chunkFiles === null ? 'index not yet fetched' : `${chunksCached}/${chunkFiles.length} chunks cached${chunksCached >= chunkFiles.length ? ' — COMPLETE' : ''}`}`,
    );
    console.log(`slugs       ${slugIndex.size} known`);
    console.log(`products    ${productsCached} cached (${notFound} confirmed not-found), ${Math.max(0, slugIndex.size - productsCached)} remaining\n`);
    return;
  }

  const deadline = Date.now() + MINUTES * 60000;
  const startedAt = Date.now();
  let requestsThisRun = 0;

  // Shared across every worker, so one worker's 429 slows down all of them —
  // this is the whole point of a shared breaker instead of N independent
  // fetch loops that can't see each other's backoffs. Passed by reference to
  // createFetcher (src/incidecoder-fetch.mjs) below.
  const breaker = { pausedUntil: 0, concurrency: CONCURRENCY };

  /**
   * One fetcher per worker, each with its own request-pacing clock, but all
   * reading/writing the shared circuit breaker above. Wraps the shared
   * fetcher to keep this file's request counter and log lines unchanged.
   */
  function createFetcher() {
    const fetchPage = createSharedFetcher({
      delayMs: DELAY_MS,
      breaker,
      onRateLimited: (backoffMs, { concurrencyDropped }, url) => {
        process.stdout.write(
          concurrencyDropped
            ? `\n    429 rate-limited on ${url} — backing off ${Math.round(backoffMs / 1000)}s and dropping concurrency ${CONCURRENCY} -> 1\n`
            : `\n    429 rate-limited on ${url} — backing off ${Math.round(backoffMs / 1000)}s\n`,
        );
      },
    });
    return async (url) => {
      const html = await fetchPage(url);
      if (html !== null) requestsThisRun += 1;
      return html;
    };
  }

  function progress(label) {
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, deadline - Date.now());
    const rate = requestsThisRun / Math.max(1, elapsed / 60000);
    process.stdout.write(
      `\r  ${label}  requests ${requestsThisRun}  (${rate.toFixed(1)}/min, concurrency ${breaker.concurrency})  elapsed ${fmtMin(elapsed)}  remaining ${fmtMin(remaining)}   `,
    );
  }

  async function crawlSitemap() {
    if (!existsSync(SITEMAP_INDEX_FILE)) {
      const fetchPage = createFetcher();
      console.log(`\nsitemap: fetching sitemap-index.xml\n`);
      const xml = await fetchPage(`${BASE}/sitemap-index.xml`);
      if (!xml) throw new Error('sitemap-index.xml fetch failed (unexpected 404)');
      saveText(SITEMAP_INDEX_FILE, xml);
    }

    const chunkFiles = loadSitemapChunkList();
    const todo = chunkFiles.filter((f) => !existsSync(join(SITEMAP_DIR, f)));
    console.log(`sitemap: ${chunkFiles.length} chunks total, ${chunkFiles.length - todo.length} cached, ${todo.length} to fetch (concurrency ${CONCURRENCY})\n`);

    let claimed = 0;
    let fetched = 0;

    async function worker(id) {
      const fetchPage = createFetcher();
      while (Date.now() < deadline) {
        if (id >= breaker.concurrency) return;
        if (claimed >= todo.length) return;
        const file = todo[claimed++];

        const xml = await fetchPage(`${BASE}/${file}`);
        if (xml) saveText(join(SITEMAP_DIR, file), xml);
        fetched += 1;
        progress(`[sitemap] ${fetched}/${todo.length}`);
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

    const left = todo.length - fetched;
    console.log(`\n\nsitemap: fetched ${fetched} chunk(s) this run${left ? `, ${left} left for next run` : ' — complete'}\n`);
  }

  async function crawlProducts() {
    const slugIndex = loadSlugSet();
    const allSlugs = [...slugIndex].sort();
    const todo = allSlugs.filter((slug) => !existsSync(productFilePath(slug)));
    console.log(`\nproducts: ${allSlugs.length} known slugs, ${allSlugs.length - todo.length} cached, ${todo.length} to fetch (concurrency ${CONCURRENCY})\n`);

    let claimed = 0;
    let fetched = 0;
    let notFound = 0;
    let errored = 0;
    const errors = []; // { slug, message }, saved at the end for follow-up

    async function worker(id) {
      const fetchPage = createFetcher();
      while (Date.now() < deadline) {
        if (id >= breaker.concurrency) return;
        if (claimed >= todo.length) return;
        const slug = todo[claimed++];

        // A single bad slug (malformed HTML, a filesystem edge case, a parse
        // bug) must cost that one product, never take down the other 63
        // workers sharing this Promise.all.
        try {
          const html = await fetchPage(`${BASE}/products/${slug}`);
          const parsed = html ? parseProductPage(html, slug) : null;
          if (parsed) {
            save(productFilePath(slug), parsed);
          } else {
            notFound += 1;
            save(productFilePath(slug), { slug, notFound: true, fetchedAt: new Date().toISOString() });
          }
        } catch (err) {
          errored += 1;
          errors.push({ slug, message: err.message });
          process.stdout.write(`\n    error on ${slug}: ${err.message}\n`);
        }
        fetched += 1;
        progress(`[products] ${fetched}/${todo.length}  (${notFound} not-found, ${errored} errored)`);
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

    // Errored slugs were never written to PRODUCTS_DIR, so they're already
    // back in `todo` on the next run with no special handling — this file is
    // just for visibility into what's failing and why.
    if (errors.length) save('skincare-data/raw/incidecoder/errors.json', { generatedAt: new Date().toISOString(), errors });

    const left = todo.length - fetched;
    console.log(`\n\nproducts: fetched ${fetched} this run (${notFound} not-found, ${errored} errored)${left ? `, ${left} left for next run` : ''}\n`);
  }

  if (DRY) {
    const chunkFiles = loadSitemapChunkList();
    const chunksCached = existsSync(SITEMAP_DIR)
      ? readdirSync(SITEMAP_DIR).filter((f) => f.endsWith('.xml') && f !== 'sitemap-index.xml').length
      : 0;
    const slugIndex = loadSlugSet();
    const productsCached = countCached(PRODUCTS_DIR);
    console.log(`\n--dry-run: nothing sent.\n`);
    console.log(`  budget       ${MINUTES} min, concurrency ${CONCURRENCY} at ${DELAY_MS}ms/request/worker  ->  up to ~${Math.floor((MINUTES * 60000) / DELAY_MS) * CONCURRENCY} requests`);
    console.log(`  sitemap      ${chunkFiles === null ? 'index not yet fetched' : `${chunkFiles.length - chunksCached} of ${chunkFiles.length} chunks remaining`}`);
    console.log(`  products     ${slugIndex.size} known, ${Math.max(0, slugIndex.size - productsCached)} would be fetched\n`);
    return;
  }

  if (MODE === 'sitemap' || MODE === 'all') await crawlSitemap();
  if (MODE === 'products' || (MODE === 'all' && Date.now() < deadline)) await crawlProducts();

  console.log(`\ndone: ${requestsThisRun} requests this run, ${fmtMin(Date.now() - startedAt)} elapsed\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
