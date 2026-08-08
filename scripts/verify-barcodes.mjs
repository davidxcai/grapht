#!/usr/bin/env node
/**
 * Phase 2: candidate barcodes -> verified products, via the INCI API.
 *
 * The check digit in phase 1 proves a code is well-formed. Only this step can
 * say it corresponds to a product that exists, and only this step can catch the
 * failure that matters: a fabricated code that is checksum-valid *and* belongs
 * to some real, unrelated article. That one is invisible without a second
 * opinion, which is why phase 1 records the brand and name the model asserted.
 *
 * Four outcomes, and `mismatch` is the interesting one:
 *
 *   verified   INCI knows the code and its brand agrees with the asserted brand
 *   mismatch   INCI knows the code and it belongs to something else — DISCARD
 *   unknown    404. Says nothing either way; the database's coverage of
 *              cosmetics is poor, so this is the common case. Kept for review
 *   uncached   only in --offline, where there is no fixture to replay
 *
 * `unknown` is deliberately not treated as failure. `docs/product-identity.md`
 * measures INCI's coverage gap directly, and a real product missing from a thin
 * database is expected rather than surprising.
 *
 * Costs INCI quota only — free tier is 20,000 req/month and 404s are free. It
 * cannot touch the YouCam unit budget. Everything, including misses, is cached
 * to `data/inci/` by InciClient, so a re-run is free and the app's own runtime
 * lookups hit the same cache.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-barcodes.mjs --dry-run
 *   node --env-file=.env scripts/verify-barcodes.mjs --limit 200
 *   node --env-file=.env scripts/verify-barcodes.mjs
 *   node scripts/verify-barcodes.mjs --offline    # replay cache, no key needed
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { InciClient, unwrap } from '../src/inci.mjs';
import { foldName as fold } from '../src/products.mjs';

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

// `--in` so a hand-curated candidate list can be checked on the same path as a
// harvested one. Same shape either way: `{ candidates: [{brand,name,barcode}] }`.
const IN_FILE = str('--in', 'skincare-data/barcodes.json');
const OUT_FILE = str('--out', 'skincare-data/verified.json');
const REVIEW_FILE = str('--review', 'skincare-data/needs-review.json');

const LIMIT = num('--limit', Infinity);
// INCI rate-limits per IP and asks for ~25s when tripped, so pacing beats
// getting throttled. InciClient obeys `retryAfter` on top of this.
const DELAY_MS = num('--delay', 1200);
const DRY = has('--dry-run');
const OFFLINE = has('--offline');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Does INCI's record corroborate the asserted brand?
 *
 * Returns `{ agree, matchedOn }`, where `agree: null` means no opinion — INCI
 * often has no usable strings to compare against at all.
 *
 * **The brand field alone is not enough, measured rather than assumed.** On the
 * first 18 real codes checked, `3606000537668` came back branded
 * "FRANKEL & FRANKEL" — a distributor — with `name` reading "CeraVe Moisturizing
 * Cream". A brand-to-brand comparison calls that a mismatch and discards a
 * perfectly good product. Whoever registered the GTIN owns the brand field, and
 * for resold stock that is the reseller, so the actual brand lands in the name.
 *
 * Matching against brand and name together fixes it without loosening much:
 * the same run's genuine miss (`3606000537538` -> "Unknown / Mixed Berry
 * Prebiotic Soda") still fails, because neither field mentions the brand.
 *
 * Containment rather than equality, because formatting disagrees predictably:
 * "La Roche-Posay" vs "LA ROCHE POSAY". Deliberately no alias table — a parent
 * company like DECIEM answering for The Ordinary should surface once for a
 * human to look at, not be pre-forgiven by a guess about corporate structure.
 */
function brandsAgree(asserted, returnedBrand, returnedName) {
  const a = fold(asserted);
  if (!a) return { agree: null, matchedOn: null };

  const b = fold(returnedBrand);
  if (b && (a === b || a.includes(b) || b.includes(a))) return { agree: true, matchedOn: 'brand' };

  // Only containment one way here: the asserted brand must appear in the
  // returned name. The reverse would let a one-word name swallow anything.
  const n = fold(returnedName);
  if (n && n.includes(a)) return { agree: true, matchedOn: 'name' };

  if (!b && !n) return { agree: null, matchedOn: null };
  return { agree: false, matchedOn: null };
}

function save(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  if (!existsSync(IN_FILE)) {
    console.error(`no candidates at ${IN_FILE} — run scripts/harvest-barcodes.mjs first`);
    process.exit(1);
  }

  const { candidates = [] } = JSON.parse(readFileSync(IN_FILE, 'utf8'));
  const offline = OFFLINE || !process.env.INCI_API_KEY;
  if (offline && !OFFLINE) {
    console.log('\nno INCI_API_KEY — running offline, replaying cached lookups only');
  }

  const client = new InciClient({
    apiKey: process.env.INCI_API_KEY ?? null,
    offline,
  });

  const todo = candidates.slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`\n${candidates.length} candidates, checking ${todo.length}`);

  if (DRY) {
    console.log(
      `\n--dry-run: nothing sent. ${todo.length} lookups against a 20,000/month free tier ` +
        `(${Math.round((100 * todo.length) / 20000)}% of it). Cached codes cost nothing.\n`,
    );
    return;
  }

  const results = [];
  const counts = { verified: 0, mismatch: 0, unknown: 0, uncached: 0, error: 0 };

  for (const [i, row] of todo.entries()) {
    let outcome = 'unknown';
    let returned = { brand: null, name: null, inci: null };

    try {
      const res = await client.productByBarcode(row.barcode);
      if (res.found) {
        const view = unwrap(res.data);
        returned = {
          brand: view.brand ?? null,
          name: view.name ?? null,
          inci: view.inci?.length ?? 0,
        };
        const { agree, matchedOn } = brandsAgree(row.brand, view.brand, view.name);
        returned.matchedOn = matchedOn;
        // A null verdict means INCI had nothing to compare against. The record
        // is real, so it is worth keeping, but it has not been corroborated —
        // filing it as `verified` would overstate what was actually checked.
        outcome = agree === false ? 'mismatch' : agree === true ? 'verified' : 'unknown';
      }
    } catch (err) {
      // Offline with no fixture is a gap, not a failure.
      outcome = /offline/.test(err.message) ? 'uncached' : 'error';
      if (outcome === 'error') returned.error = err.message;
    }

    counts[outcome] += 1;
    results.push({ ...row, outcome, returned });

    if ((i + 1) % 100 === 0 || i === todo.length - 1) {
      process.stdout.write(
        `\r  ${i + 1}/${todo.length}  verified ${counts.verified}  mismatch ${counts.mismatch}  ` +
          `unknown ${counts.unknown}  uncached ${counts.uncached}  error ${counts.error}   `,
      );
    }
    if (!offline && DELAY_MS) await sleep(DELAY_MS);
  }
  console.log('');

  const verified = results.filter((r) => r.outcome === 'verified');
  // Everything a human should look at before it is trusted, with the reason.
  // Mismatches are the priority: they are the only outcome that indicates the
  // harvest actively invented something that collided with a real article.
  const review = results
    .filter((r) => r.outcome === 'mismatch' || r.outcome === 'unknown')
    .sort((a, b) => (a.outcome === 'mismatch' ? -1 : 1) - (b.outcome === 'mismatch' ? -1 : 1));

  const meta = {
    generatedAt: new Date().toISOString(),
    source: IN_FILE,
    offline,
    checked: todo.length,
    counts,
  };

  save(OUT_FILE, { ...meta, products: verified });
  save(REVIEW_FILE, { ...meta, products: review });

  const pct = (n) => (todo.length ? `${Math.round((100 * n) / todo.length)}%` : '—');
  console.log(`\n  verified   ${String(counts.verified).padStart(5)}  ${pct(counts.verified).padStart(4)}  brand corroborated by INCI`);
  console.log(`  mismatch   ${String(counts.mismatch).padStart(5)}  ${pct(counts.mismatch).padStart(4)}  real code, WRONG product — discard`);
  console.log(`  unknown    ${String(counts.unknown).padStart(5)}  ${pct(counts.unknown).padStart(4)}  no record / no brand to compare`);
  if (counts.uncached) console.log(`  uncached   ${String(counts.uncached).padStart(5)}  ${pct(counts.uncached).padStart(4)}  offline, no fixture`);
  if (counts.error) console.log(`  error      ${String(counts.error).padStart(5)}  ${pct(counts.error).padStart(4)}`);

  if (counts.mismatch) {
    console.log('\n  sample mismatches (asserted -> what INCI actually has):');
    for (const r of results.filter((x) => x.outcome === 'mismatch').slice(0, 8)) {
      console.log(`    ${r.barcode}  ${r.brand} ${r.name}  ->  ${r.returned.brand} ${r.returned.name}`);
    }
  }

  console.log(`\n  -> ${OUT_FILE}  (${verified.length} products)`);
  console.log(`  -> ${REVIEW_FILE}  (${review.length} for review)`);
  console.log(`  raw INCI responses cached in data/inci/ — re-runs are free\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
