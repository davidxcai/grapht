#!/usr/bin/env node
/**
 * Classify a product into analysis concerns, from the command line.
 *
 * The manual counterpart to the picker UI: it exercises the real Gemini call,
 * shows what would be pre-ticked versus merely suggested, and writes the result
 * to the product cache. Mostly useful for checking that the classifier is
 * actually biasing narrow rather than pre-ticking half the vocabulary.
 *
 *   node scripts/classify-product.mjs --name "Paula's Choice 2% BHA Liquid"
 *   node scripts/classify-product.mjs --brand CeraVe --name "Moisturising Cream"
 *   node scripts/classify-product.mjs --name "..." --photo ./bottle.jpg
 *   node scripts/classify-product.mjs --name "..." --lookup    # search for its INCI first
 *   node scripts/classify-product.mjs --name "..." --save      # write to the cache
 *
 * Costs a Gemini call (and, with --lookup, a grounded search). Never touches
 * YouCam and cannot spend units.
 */

import {
  classify,
  lookupInciByName,
  readInciFromPhoto,
  CLASSIFIER,
} from '../src/product-targets.mjs';
import { clientFromEnv as inciFromEnv } from '../src/inci.mjs';
import { ProductStore, buildRecord, PROVENANCE } from '../src/products.mjs';

const CACHE_PATH = 'data/products.json';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
const has = (flag) => process.argv.includes(flag);

const brand = arg('--brand');
const name = arg('--name');
const barcode = arg('--barcode');
const photo = arg('--photo');
const panel = arg('--panel');

if (!brand && !name && !barcode && !photo && !panel) {
  console.error('need at least one of --brand, --name, --barcode, --photo, --panel\n');
  console.error("  node scripts/classify-product.mjs --name \"Paula's Choice 2% BHA Liquid\"");
  console.error('  node scripts/classify-product.mjs --panel ./ingredients.jpg');
  process.exit(1);
}

const label = [brand, name].filter(Boolean).join(' — ') || barcode || panel || photo;
console.log(`\n${label}`);
console.log('─'.repeat(Math.max(label.length, 40)));

/* ---------- 1. ingredients, if we can get them ---------- */

let inci = null;
let source = null;

/** Free-tier quota is small; say so plainly instead of looking hung. */
const onRetry = ({ attempt, delayMs, status }) =>
  console.log(`\n  ${status} — waiting ${delayMs / 1000}s (attempt ${attempt})`);

/** Rate limits and quota exhaustion are expected here, not crashes. */
function fail(err) {
  console.error(`\n${err.message}`);
  if (err.status === 429) {
    console.error('Free-tier quota is per-minute AND per-day; a grounded --lookup costs more.');
  }
  process.exit(1);
}

// The ingredient panel is the strongest path, and on a free Gemini tier the
// only automatic one — --lookup needs Google Search grounding, which is paid.
if (panel) {
  process.stdout.write('reading the ingredient panel... ');
  const read = await readInciFromPhoto(panel, { onRetry }).catch(fail);
  if (read.inci.length) {
    inci = read.inci;
    source = panel;
    console.log(`${read.inci.length} ingredients${read.legible ? '' : '  [PARTIALLY LEGIBLE]'}`);
    if (read.note) console.log(`  note: ${read.note}`);
  } else {
    console.log('nothing legible');
  }
}

if (has('--lookup') && !inci && (brand || name)) {
  process.stdout.write('searching for a published ingredient list... ');
  const found = await lookupInciByName({ brand, name }, { onRetry }).catch(fail);
  if (found.inci.length) {
    inci = found.inci;
    source = found.sourceUrl ?? found.groundingUrls[0] ?? 'search';
    console.log(`${found.inci.length} ingredients${found.confident ? '' : '  [UNCONFIRMED]'}`);
    console.log(`  source: ${source}`);
    if (!found.confident) {
      // A list with no retrieved page behind it is a memory reconstruction.
      // It gets shown, it does not get cached without a human saying so.
      console.log('  ⚠ not grounded in a retrieved page — check before trusting');
    }
  } else {
    console.log('none found');
  }
}

/* ---------- 2. ingredient-database signals ---------- */

let signals = null;
if (inci || barcode) {
  const inciClient = inciFromEnv();
  try {
    const enriched = await inciClient.enrich({ inci, barcode });
    if (enriched.found) {
      signals = enriched.signals;
      inci ??= enriched.inci;
      console.log(`\nINCI database (${enriched.source}): ${signals.length} signal(s)`);
      for (const s of signals) console.log(`  ${s.concern.padEnd(20)} ${s.weight.padEnd(7)} ${s.because}`);
    } else {
      console.log('\nINCI database: no match');
    }
  } catch (err) {
    console.log(`\nINCI database: skipped (${err.message})`);
  }
}

/* ---------- 3. classify ---------- */

process.stdout.write('\nclassifying... ');
const result = await classify(
  { brand, name, inci, signals, labelImagePath: photo },
  { onRetry },
).catch(fail);
console.log(`${result.productType ?? 'unknown type'}\n`);

if (!result.ranked.length) {
  console.log('  no metrics in play at all.');
} else {
  const width = Math.max(...result.ranked.map((r) => r.concern.length));
  for (const r of result.ranked) {
    const ticked = result.targets.includes(r.concern);
    console.log(
      `  ${ticked ? '[x]' : '[ ]'} ${r.concern.padEnd(width)}  ${r.confidence.padEnd(6)}  ${r.because}`,
    );
  }
}

console.log(`\n  [x] pre-ticked (${result.targets.length}): ${result.targets.join(', ') || 'none'}`);
console.log(`  [ ] suggested  (${result.suggestions.length}): ${result.suggestions.join(', ') || 'none'}`);
if (result.rejected.length) console.log(`  rejected off-vocabulary: ${result.rejected.join(', ')}`);
if (result.durationClaimDays) console.log(`  label claims results in ${result.durationClaimDays} days`);

// The number that matters. Anything above 3 means the attribution table starts
// collapsing into "credit shared, unsplittable" the moment a second product
// enters the trial.
if (result.targets.length > 3) {
  console.log(`\n  ⚠ ${result.targets.length} pre-ticked — over the cap, check MAX_PRETICKED`);
}

/* ---------- 4. cache ---------- */

if (has('--save')) {
  if (!inci && !barcode && !name) {
    console.log('\nnot saved: nothing stable to key on');
  } else {
    const store = new ProductStore({ path: CACHE_PATH });
    const record = buildRecord({
      inci,
      barcode,
      brand,
      name,
      targets: result.targets,
      ranked: result.ranked,
      provenance: PROVENANCE.LLM_DERIVED,
      classifier: CLASSIFIER,
    });
    const { action } = store.put(record);
    store.save();
    console.log(`\n${action} ${record.key} in ${CACHE_PATH} (${store.size} record(s))`);
    if (action === 'kept') console.log('  an existing human-reviewed record outranked this one');
  }
}

console.log();
