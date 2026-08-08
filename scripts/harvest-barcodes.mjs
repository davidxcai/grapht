#!/usr/bin/env node
/**
 * Phase 1: brands -> candidate barcodes, via Gemini recall.
 *
 * Reads `skincare-data/skincare-brands.md`, asks Gemini for the barcodes it
 * recalls per brand a batch at a time, and writes every raw response to disk
 * before parsing any of it.
 *
 * **The raw cache is the source of truth; `barcodes.json` is derived.** Every
 * run re-parses all cached batches and rewrites the merged file, so tightening
 * a validation rule costs nothing — re-run and the whole corpus is re-filtered
 * with no network and no quota. Only batches with no cached response are sent.
 *
 * Costs Gemini quota only. Cannot touch the YouCam unit budget.
 *
 * Usage:
 *   node --env-file=.env scripts/harvest-barcodes.mjs --dry-run
 *   node --env-file=.env scripts/harvest-barcodes.mjs
 *   node --env-file=.env scripts/harvest-barcodes.mjs --batch 5 --per-brand 30
 *   node --env-file=.env scripts/harvest-barcodes.mjs --reparse   # no network at all
 */

import crypto from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseBrandList, chunk } from '../src/brand-list.mjs';
import {
  harvestBatch,
  parseHarvest,
  HARVESTER,
  TruncatedError,
} from '../src/barcode-harvest.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
};

const BRANDS_FILE = 'skincare-data/skincare-brands.md';
const RAW_DIR = 'skincare-data/raw/gemini';
const OUT_FILE = 'skincare-data/barcodes.json';

const BATCH = num('--batch', 10);
const PER_BRAND = num('--per-brand', 50);
// The free tier is 5–15 RPM depending on model, so ~5 RPM is the safe floor.
// withRetry() handles a 429 anyway; this just avoids provoking one every call.
const DELAY_MS = num('--delay', 12000);
const DRY = has('--dry-run');
const REPARSE = has('--reparse');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function save(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Cache key for a batch. Covers the brands, the prompt version and the ceiling,
 * so changing any of them is a miss rather than a silent replay of an answer to
 * a different question.
 */
function batchKey(brands) {
  const material = JSON.stringify([brands, HARVESTER.promptVersion, PER_BRAND]);
  const hash = crypto.createHash('sha256').update(material).digest('hex').slice(0, 10);
  return `${String(brands.length).padStart(2, '0')}-${hash}`;
}

/**
 * Persist only the fields `parseHarvest` reads. The SDK's response object
 * exposes `.text` as a getter, which `JSON.stringify` would drop — storing it
 * explicitly is what makes a cached batch replayable.
 */
const persistable = (response, brands) => ({
  brands,
  harvester: HARVESTER,
  perBrand: PER_BRAND,
  fetchedAt: new Date().toISOString(),
  promptFeedback: response.promptFeedback ?? null,
  candidates: response.candidates ?? null,
  text: response.text ?? null,
});

async function main() {
  if (!existsSync(BRANDS_FILE)) {
    console.error(`no brand list at ${BRANDS_FILE}`);
    process.exit(1);
  }

  const { brands, dropped } = parseBrandList(readFileSync(BRANDS_FILE, 'utf8'));
  const batches = chunk(brands, BATCH);

  console.log(`\n${brands.length} brands, ${dropped.length} lines dropped as citations/duplicates`);
  console.log(`${batches.length} batches of ${BATCH}, up to ${PER_BRAND} products per brand\n`);

  const pending = batches.filter((b) => !existsSync(join(RAW_DIR, `${batchKey(b)}.json`)));
  console.log(`${batches.length - pending.length} batches already cached, ${pending.length} to fetch`);

  if (DRY) {
    console.log('\n--dry-run: nothing sent. Batches that would be fetched:\n');
    for (const b of pending) console.log(`  ${batchKey(b)}  ${b.join(', ')}`);
    console.log(
      `\n${pending.length} Gemini requests. Free tier is 100–1000 requests/day, ` +
        `so this is ${pending.length <= 100 ? 'comfortably within' : 'possibly over'} a day's quota.`,
    );
    return;
  }

  /* ---------- fetch what is missing ---------- */

  /**
   * Fetch one batch and cache it. On truncation, halve and recurse — the same
   * request truncates identically, so retrying it is pointless and splitting is
   * the only fix. A single brand that still truncates has nothing left to split
   * and is reported rather than retried forever.
   *
   * Any other failure costs that batch alone: everything already cached stays
   * cached, and a re-run picks up only the gap.
   */
  async function fetchBatch(batch, indent = '  ') {
    const key = batchKey(batch);
    if (existsSync(join(RAW_DIR, `${key}.json`))) return;

    try {
      const response = await harvestBatch(batch, {
        perBrand: PER_BRAND,
        onRetry: ({ attempt, delayMs, status }) =>
          process.stdout.write(`\n${indent}    ${status}, retry ${attempt} in ${delayMs / 1000}s  `),
      });
      const record = persistable(response, batch);
      save(join(RAW_DIR, `${key}.json`), record);

      // Parsed here only to report progress and to surface truncation while the
      // batch is still in hand. The authoritative parse is the merge pass below.
      const { candidates, rejected } = parseHarvest(record, { requested: batch });
      console.log(`${candidates.length} valid, ${rejected.length} rejected`);
    } catch (err) {
      if (!(err instanceof TruncatedError)) {
        console.log(`FAILED: ${err.message}`);
        return;
      }
      if (batch.length === 1) {
        console.log(`truncated on a single brand (${batch[0]}) — lower --per-brand`);
        return;
      }
      const halves = chunk(batch, Math.ceil(batch.length / 2));
      console.log(`truncated, splitting into ${halves.length}`);
      for (const half of halves) {
        await sleep(DELAY_MS);
        process.stdout.write(`${indent}    ${batchKey(half)}  ${half[0]}…  `);
        await fetchBatch(half, `${indent}  `);
      }
      // A marker at the parent key, so the next run skips straight to the
      // halves instead of re-provoking the same truncation. It carries no
      // `text`, which is how the merge pass knows to step over it.
      save(join(RAW_DIR, `${key}.json`), {
        brands: batch,
        harvester: HARVESTER,
        perBrand: PER_BRAND,
        splitInto: halves.map(batchKey),
      });
    }
  }

  if (!REPARSE) {
    for (const [i, batch] of pending.entries()) {
      process.stdout.write(`  [${i + 1}/${pending.length}] ${batchKey(batch)}  ${batch[0]}…  `);
      await fetchBatch(batch);
      if (i < pending.length - 1) await sleep(DELAY_MS);
    }
  }

  /* ---------- merge every cached batch ---------- */

  const candidates = [];
  const rejected = [];
  const perBrand = new Map(brands.map((b) => [b, { valid: 0, rejected: 0 }]));
  const seen = new Set();
  let batchesRead = 0;

  // Read the directory rather than reconstructing keys from the current
  // batching. A truncated batch was split under different keys, and --batch may
  // have changed between runs; either way the files on disk are the record, and
  // each one carries the brand list it was asked with.
  const files = existsSync(RAW_DIR)
    ? readdirSync(RAW_DIR).filter((f) => f.endsWith('.json')).sort()
    : [];

  const bump = (brand, field) => {
    const row = perBrand.get(brand);
    if (row) row[field] += 1;
  };

  for (const file of files) {
    const record = JSON.parse(readFileSync(join(RAW_DIR, file), 'utf8'));
    // Split markers carry no response text, and a batch harvested under an
    // older prompt answers a different question than the current one.
    if (!record.text) continue;
    if (record.harvester?.promptVersion !== HARVESTER.promptVersion) continue;
    batchesRead += 1;

    const parsed = parseHarvest(record, { requested: record.brands ?? brands });
    for (const row of parsed.candidates) {
      // Dedupe across batches as well as within one. One code can only belong
      // to one article, so a repeat means at least one of the two is wrong.
      if (seen.has(row.barcode)) {
        rejected.push({ ...row, reason: 'duplicate barcode across batches' });
        bump(row.brand, 'rejected');
        continue;
      }
      seen.add(row.barcode);
      candidates.push(row);
      bump(row.brand, 'valid');
    }
    for (const row of parsed.rejected) {
      rejected.push(row);
      bump(row.brand, 'rejected');
    }
  }

  const withNone = [...perBrand].filter(([, s]) => s.valid === 0 && s.rejected === 0);

  save(OUT_FILE, {
    generatedAt: new Date().toISOString(),
    harvester: HARVESTER,
    perBrand: PER_BRAND,
    source: BRANDS_FILE,
    stats: {
      brands: brands.length,
      batchesRead,
      candidates: candidates.length,
      rejected: rejected.length,
      brandsWithNoCandidates: withNone.length,
    },
    // Candidates only. Nothing here is a verified identity until phase 2 runs.
    candidates,
    rejected,
  });

  const total = candidates.length + rejected.length;
  console.log(`\n  batches read      ${batchesRead}/${batches.length}`);
  console.log(`  candidates        ${candidates.length}`);
  console.log(
    `  rejected          ${rejected.length}` +
      (total ? `  (${Math.round((100 * rejected.length) / total)}% of everything returned)` : ''),
  );
  const byReason = {};
  for (const r of rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(5)}  ${reason}`);
  }
  if (withNone.length) {
    console.log(`\n  ${withNone.length} brands returned nothing: ${withNone.map(([b]) => b).slice(0, 12).join(', ')}${withNone.length > 12 ? '…' : ''}`);
  }
  console.log(`\n  -> ${OUT_FILE}`);
  console.log(`  raw responses in ${RAW_DIR}/ (re-parse for free with --reparse)`);
  console.log(`\n  Next: node --env-file=.env scripts/verify-barcodes.mjs\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
