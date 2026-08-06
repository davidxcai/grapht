#!/usr/bin/env node
/**
 * Tests for product identity, the derived-targets cache, and the ingredient
 * signal extractor (src/products.mjs, src/inci.mjs, src/product-targets.mjs).
 *
 * Offline, deterministic, no API key. The classifier is exercised through
 * parseClassification() against fixture responses rather than the live model,
 * so the pre-tick policy is testable without spending anything or depending on
 * model output being stable.
 *
 *   node scripts/test-products.mjs
 *   node scripts/test-products.mjs barcode   # only matching cases
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PROVENANCE,
  ProductStore,
  buildRecord,
  freezeTargets,
  isStale,
  normalizeBarcode,
  normalizeInci,
  normalizeIngredient,
  productKey,
  supersedes,
} from '../src/products.mjs';
import { concernsFromText, extractSignals, unwrap } from '../src/inci.mjs';
import { parseClassification, MAX_PRETICKED } from '../src/product-targets.mjs';

/* ---------- tiny harness ---------- */

const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let passed = 0;
let failed = 0;

function test(name, fn) {
  if (filters.length && !filters.some((f) => name.toLowerCase().includes(f.toLowerCase()))) return;
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message.split('\n').join('\n       ')}`);
  }
}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}\n  expected: ${e}\n  actual:   ${a}`);
}

function ok(cond, what) {
  if (!cond) throw new Error(what);
}

function throws(fn, match, what) {
  let err = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`${what}: expected a throw, got none`);
  if (match && !err.message.includes(match)) {
    throw new Error(`${what}: expected message containing ${JSON.stringify(match)}, got:\n  ${err.message}`);
  }
}

/* ---------- ingredient normalisation ---------- */

console.log('\ningredient normalisation');

test('formatting noise is stripped from an ingredient token', () => {
  eq(normalizeIngredient('  Niacinamide  '), 'niacinamide', 'whitespace + case');
  eq(normalizeIngredient('Salicylic Acid 2%'), 'salicylic acid', 'trailing concentration');
  eq(normalizeIngredient('Niacinamide (10%)'), 'niacinamide', 'parenthesised concentration');
  eq(normalizeIngredient('Butyrospermum Parkii Butter*'), 'butyrospermum parkii butter', 'organic asterisk');
  eq(normalizeIngredient('Glycerin,'), 'glycerin', 'trailing punctuation');
});

test('the same panel written two ways hashes to one key', () => {
  const a = ['Aqua', 'Niacinamide 10%', 'Glycerin'];
  const b = ['  aqua ', 'NIACINAMIDE (10%)', 'Glycerin*'];
  eq(productKey({ inci: a }).key, productKey({ inci: b }).key, 'same key');
});

test('order is preserved — it is concentration order, not a set', () => {
  // Sorting these would merge a 10% niacinamide serum with a product that
  // contains a trace of it. Different formulations must not collide.
  const a = productKey({ inci: ['Niacinamide', 'Aqua'] }).key;
  const b = productKey({ inci: ['Aqua', 'Niacinamide'] }).key;
  ok(a !== b, 'reordered lists must not share a key');
});

test('duplicates within a panel are dropped', () => {
  eq(normalizeInci(['Aqua', 'Glycerin', 'AQUA']), ['aqua', 'glycerin'], 'deduped');
});

test('synonyms are NOT merged — a miss is safer than a false merge', () => {
  // "aqua" and "water" are the same ingredient, and this deliberately does not
  // know that. The cost is one redundant classification. The cost of getting
  // merging wrong is a product silently inheriting another product's targets.
  const a = productKey({ inci: ['Aqua', 'Glycerin'] }).key;
  const b = productKey({ inci: ['Water', 'Glycerin'] }).key;
  ok(a !== b, 'conservative by design');
});

/* ---------- barcodes ---------- */

console.log('\nbarcodes');

test('UPC-A and its EAN-13 wrapper normalise to the same GTIN-14', () => {
  eq(normalizeBarcode('012345678905'), '00012345678905', '12-digit UPC-A');
  eq(normalizeBarcode('0012345678905'), '00012345678905', '13-digit EAN-13');
  eq(normalizeBarcode('012345678905'), normalizeBarcode('0012345678905'), 'equal');
});

test('separators in a scanned barcode are tolerated', () => {
  eq(normalizeBarcode('0 12345 67890 5'), '00012345678905', 'spaces');
});

test('a non-barcode is rejected rather than padded into a plausible one', () => {
  eq(normalizeBarcode('abc'), null, 'letters');
  eq(normalizeBarcode('123'), null, 'too short');
  eq(normalizeBarcode(''), null, 'empty');
  eq(normalizeBarcode(null), null, 'null');
});

/* ---------- identity precedence ---------- */

console.log('\nidentity precedence');

test('ingredients outrank barcode, which outranks name', () => {
  eq(productKey({ inci: ['Aqua'], barcode: '012345678905', name: 'X' }).keyType, 'inci', 'inci wins');
  eq(productKey({ barcode: '012345678905', name: 'X' }).keyType, 'barcode', 'barcode next');
  eq(productKey({ brand: 'CeraVe', name: 'PM Lotion' }).keyType, 'name', 'name last');
});

test('one formulation under two regional barcodes collapses to one record', () => {
  const inci = ['Aqua', 'Glycerin', 'Niacinamide'];
  const eu = productKey({ inci, barcode: '5012345678900' });
  const us = productKey({ inci, barcode: '012345678905' });
  eq(eu.key, us.key, 'same product, one cache entry');
});

test('identity confidence degrades with the key type', () => {
  eq(productKey({ inci: ['Aqua'] }).confidence, 'high', 'inci');
  eq(productKey({ barcode: '012345678905' }).confidence, 'medium', 'barcode');
  eq(productKey({ name: 'moisturiser' }).confidence, 'low', 'name');
});

test('a product with no identity at all is rejected', () => {
  throws(() => productKey({}), 'cannot key a product', 'no identity');
});

/* ---------- records ---------- */

console.log('\nrecords');

test('a bad concern key cannot enter the store', () => {
  throws(
    () => buildRecord({ name: 'X', targets: ['glow'] }),
    'unrecognised concern',
    'free-text target',
  );
  throws(
    () => buildRecord({ name: 'X', targets: ['pores'] }),
    'unrecognised concern',
    'simulation vocabulary',
  );
});

test('an unknown provenance is rejected', () => {
  throws(
    () => buildRecord({ name: 'X', provenance: 'vibes' }),
    'unknown provenance',
    'bogus provenance',
  );
});

/* ---------- provenance precedence ---------- */

console.log('\nprovenance precedence');

const base = { brand: 'CeraVe', name: 'PM Lotion', inci: ['Aqua', 'Glycerin'] };

test('a user edit outranks a classifier default', () => {
  const derived = buildRecord({ ...base, targets: ['moisture'], provenance: PROVENANCE.LLM_DERIVED });
  const edited = buildRecord({ ...base, targets: ['moisture', 'redness'], provenance: PROVENANCE.USER_EDITED });
  ok(supersedes(edited, derived), 'edit wins');
  ok(!supersedes(derived, edited), 'and the classifier cannot overwrite it back');
});

test('a confirmation outranks a default but loses to an edit', () => {
  const derived = buildRecord({ ...base, provenance: PROVENANCE.LLM_DERIVED });
  const confirmed = buildRecord({ ...base, provenance: PROVENANCE.USER_CONFIRMED });
  const edited = buildRecord({ ...base, provenance: PROVENANCE.USER_EDITED });
  ok(supersedes(confirmed, derived), 'confirmed > derived');
  ok(supersedes(edited, confirmed), 'edited > confirmed');
});

test('the store keeps the stronger record and reports that it did', () => {
  const store = new ProductStore();
  const edited = buildRecord({ ...base, targets: ['moisture'], provenance: PROVENANCE.USER_EDITED });
  const derived = buildRecord({ ...base, targets: ['acne'], provenance: PROVENANCE.LLM_DERIVED });

  eq(store.put(edited).action, 'inserted', 'first write');
  const second = store.put(derived);
  eq(second.action, 'kept', 'classifier output discarded');
  eq(store.get(base).targets, ['moisture'], 'user targets survived');
  eq(store.size, 1, 'one record, not two');
});

/* ---------- classifier staleness ---------- */

console.log('\nclassifier staleness');

const v1 = { model: 'claude-opus-5', promptVersion: '2026-08-04.1' };
const v2 = { model: 'claude-opus-5', promptVersion: '2026-09-01.1' };

test('a classifier-derived record goes stale when the prompt version moves', () => {
  const rec = buildRecord({ ...base, provenance: PROVENANCE.LLM_DERIVED, classifier: v1 });
  ok(!isStale(rec, v1), 'current');
  ok(isStale(rec, v2), 'stale after a prompt change');
});

test('a human-reviewed record does NOT go stale on a classifier upgrade', () => {
  // The review is the only ground truth in the system. A newer classifier does
  // not get to silently overrule it.
  const confirmed = buildRecord({ ...base, provenance: PROVENANCE.USER_CONFIRMED, classifier: v1 });
  const edited = buildRecord({ ...base, provenance: PROVENANCE.USER_EDITED, classifier: v1 });
  ok(!isStale(confirmed, v2), 'confirmed survives');
  ok(!isStale(edited, v2), 'edited survives');
});

test('staleRecords lists only what is worth re-deriving', () => {
  const store = new ProductStore();
  store.put(buildRecord({ name: 'A', provenance: PROVENANCE.LLM_DERIVED, classifier: v1 }));
  store.put(buildRecord({ name: 'B', provenance: PROVENANCE.USER_CONFIRMED, classifier: v1 }));
  store.put(buildRecord({ name: 'C', provenance: PROVENANCE.LLM_DERIVED, classifier: v2 }));
  eq(store.staleRecords(v2).map((r) => r.name), ['A'], 'only the old derived one');
});

/* ---------- frozen targets ---------- */

console.log('\nfrozen targets');

test('a frozen snapshot does not follow later cache edits', () => {
  // The rule that keeps a running trial honest: changing targets mid-flight
  // would retroactively rewrite its attribution table with no new measurement.
  const record = buildRecord({ ...base, targets: ['moisture'], provenance: PROVENANCE.LLM_DERIVED });
  const frozen = freezeTargets(record);

  record.targets.push('acne');
  record.targets[0] = 'redness';

  eq(frozen.targets, ['moisture'], 'snapshot unchanged');
});

test('a frozen snapshot rejects mutation outright', () => {
  const frozen = freezeTargets(buildRecord({ ...base, targets: ['moisture'] }));
  throws(() => {
    'use strict';
    frozen.targets.push('acne');
  }, null, 'frozen array');
  ok(Object.isFrozen(frozen), 'snapshot object frozen');
});

test('a snapshot carries enough provenance to explain itself later', () => {
  const frozen = freezeTargets(
    buildRecord({ ...base, targets: ['moisture'], provenance: PROVENANCE.USER_CONFIRMED, classifier: v1 }),
  );
  eq(frozen.provenance, PROVENANCE.USER_CONFIRMED, 'provenance');
  eq(frozen.classifier, v1, 'classifier version');
  ok(frozen.productKey.startsWith('inci:'), 'traceable back to the record');
});

/* ---------- store persistence ---------- */

console.log('\nstore persistence');

test('a store round-trips through disk unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'products-'));
  try {
    const path = join(dir, 'nested', 'products.json');
    const a = new ProductStore({ path });
    a.put(buildRecord({ ...base, targets: ['moisture'], provenance: PROVENANCE.USER_CONFIRMED }));
    a.save();

    const b = new ProductStore({ path });
    eq(b.size, 1, 'reloaded');
    eq(b.get(base).targets, ['moisture'], 'targets survived');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- ingredient signal extraction ---------- */

console.log('\ningredient signals');

test('the effect lexicon maps free text onto concern keys', () => {
  eq(concernsFromText('sebum control'), ['oiliness'], 'sebum');
  eq(concernsFromText('brightening and even skin tone'), ['radiance', 'age_spot'], 'two hits');
  eq(concernsFromText('anti-wrinkle'), ['wrinkle'], 'wrinkle');
  eq(concernsFromText('nothing relevant here'), [], 'no false positive');
});

test('snake_case API effect slugs match the same rules as prose', () => {
  // The API sends `barrier_repair`, not "barrier repair". Before underscores
  // were flattened this silently matched nothing and a real RCT-backed
  // moisture signal was dropped from every product — found by running the
  // live API, not by reading the docs.
  eq(concernsFromText('barrier_repair'), ['moisture'], 'barrier_repair');
  eq(concernsFromText('anti_hyperpigmentation'), ['age_spot'], 'anti_hyperpigmentation');
  eq(concernsFromText('anti_acne'), ['acne'], 'anti_acne');
});

test('comedogenicity produces an acne signal', () => {
  // Note the direction: comedogenic means it makes acne WORSE. targets[] does
  // not carry a sign, and the app is not supposed to presume one, so targeting
  // acne is the correct and complete outcome.
  const signals = extractSignals({ comedogenicityScore: 4 });
  eq(signals.map((s) => s.concern), ['acne'], 'acne targeted');
  eq(signals[0].weight, 'strong', 'strong signal');
});

test('a low comedogenicity score produces nothing', () => {
  eq(extractSignals({ comedogenicityScore: 1 }), [], 'below threshold');
});

test('a comedogenic ingredient is caught even when the overall score is 0', () => {
  // The live API frequently returns comedogenicityScore: 0 while an individual
  // ingredient rates 4 — reading only the top-level score misses it entirely.
  const signals = extractSignals({
    comedogenicityScore: 0,
    parsedIngredients: [
      { inciName: 'COCOS NUCIFERA OIL', comedogenicityRating: 4 },
      { inciName: 'AQUA', comedogenicityRating: 0 },
    ],
  });
  eq(signals.map((s) => s.concern), ['acne'], 'acne raised');
  eq(signals[0].weight, 'weak', 'weaker than a whole-formula score');
  ok(signals[0].because.includes('COCOS NUCIFERA OIL'), 'names the ingredient');
});

test('topEffects are read from the real object shape, not treated as strings', () => {
  const signals = extractSignals({
    efficacySummary: {
      topEffects: [
        {
          target: 'anti_hyperpigmentation',
          compositeStrength: 'moderate',
          bestEvidenceLevel: 'rct',
          contributingIngredients: ['NIACINAMIDE'],
        },
      ],
    },
  });
  eq(signals.map((s) => s.concern), ['age_spot'], 'concern extracted');
  eq(signals[0].weight, 'strong', 'rct + moderate composite');
  ok(signals[0].because.includes('NIACINAMIDE'), 'names the contributing ingredient');
  ok(signals[0].because.includes('rct'), 'records the evidence grade');
});

test('meta-analysis outranks RCT rather than being demoted below it', () => {
  // Reading `bestEvidenceLevel === 'rct'` as the only strong grade silently
  // demoted the single strongest piece of evidence in the payload to a weak
  // signal. Caught on a live product whose best-evidenced effect was a
  // meta-analysis.
  for (const level of ['meta_analysis', 'systematic_review', 'rct']) {
    const signals = extractSignals({
      efficacySummary: {
        topEffects: [{ target: 'anti_acne', compositeStrength: 'strong', bestEvidenceLevel: level }],
      },
    });
    eq(signals[0].weight, 'strong', level);
  }
});

test('a weakly-evidenced effect is downgraded, not treated as RCT-backed', () => {
  const signals = extractSignals({
    efficacySummary: {
      topEffects: [
        { target: 'hydration', compositeStrength: 'weak', bestEvidenceLevel: 'in_vitro' },
      ],
    },
  });
  eq(signals[0].concern, 'moisture', 'concern');
  eq(signals[0].weight, 'weak', 'not strong');
});

test('strong signals sort ahead of weak ones', () => {
  const signals = extractSignals({
    parsedIngredients: [{ inciName: 'Limonene', irritancyPotential: 'high' }],
    efficacySummary: {
      topEffects: [
        {
          target: 'exfoliating',
          compositeStrength: 'strong',
          bestEvidenceLevel: 'rct',
          contributingIngredients: ['SALICYLIC ACID'],
        },
      ],
    },
  });
  eq(signals[0].concern, 'texture', 'strong first');
  eq(signals[1].concern, 'redness', 'weak after');
});

test('high-irritancy ingredients raise a weak redness signal', () => {
  const signals = extractSignals({
    parsedIngredients: [
      { inciName: 'Limonene', irritancyPotential: 'high' },
      { inciName: 'Aqua', irritancyPotential: 'none' },
    ],
  });
  const redness = signals.find((s) => s.concern === 'redness');
  ok(redness, 'redness raised');
  ok(redness.because.includes('Limonene'), 'names the culprit');
});

test('both INCI response shapes flatten to the same view', () => {
  // The two endpoints return structurally different bodies and the mismatch
  // fails silently — 200, populated body, zero signals. Found on a real
  // barcode lookup that had everything we needed, nested one level deeper.
  const effects = {
    topEffects: [{ target: 'anti_acne', compositeStrength: 'strong', bestEvidenceLevel: 'rct' }],
  };

  const fromAnalyze = unwrap({ analysis: { efficacySummary: effects, parsedIngredients: [] } });
  const fromBarcode = unwrap({
    product: {
      barcode: '8809640737190',
      name: 'Azelaic Acid 10 Hyaluron Serum',
      brand: 'Anua',
      details: { inci: ['Water', 'Azelaic Acid'], analysis: { efficacySummary: effects } },
    },
  });

  eq(extractSignals(fromAnalyze.analysis)[0].concern, 'acne', 'analyze shape');
  eq(extractSignals(fromBarcode.analysis)[0].concern, 'acne', 'barcode shape');

  // The barcode form is the richer one — it alone carries product identity.
  eq(fromBarcode.brand, 'Anua', 'brand');
  eq(fromBarcode.name, 'Azelaic Acid 10 Hyaluron Serum', 'name');
  eq(fromBarcode.inci, ['Water', 'Azelaic Acid'], 'ingredient list');
  eq(fromAnalyze.brand, null, 'analyze has no identity to give');
});

test('safety fields are ignored — this is not a safety checker', () => {
  const signals = extractSignals({
    overallSafetyScore: 2,
    safetyLevel: 'hazardous',
    cleanBeautyScore: 5,
    pregnancySafe: false,
    allergenFlags: ['Limonene', 'Linalool'],
  });
  eq(signals, [], 'nothing leaks through');
});

/* ---------- pre-tick policy ---------- */

console.log('\npre-tick policy');

/** A minimal stand-in for a Gemini GenerateContentResponse. */
const fixture = (ranked, extra = {}) => ({
  candidates: [{ finishReason: 'STOP' }],
  text: JSON.stringify({ productType: 'test', ranked, durationClaimDays: null, ...extra }),
});

test('only high-confidence concerns are pre-ticked', () => {
  const r = parseClassification(
    fixture([
      { concern: 'texture', confidence: 'high', because: 'salicylic acid' },
      { concern: 'acne', confidence: 'medium', because: 'BHA clears pores' },
      { concern: 'moisture', confidence: 'low', because: 'contains glycerin' },
    ]),
  );
  eq(r.targets, ['texture'], 'pre-ticked');
  eq(r.suggestions, ['acne', 'moisture'], 'the rest offered, not accepted');
  eq(r.ranked.length, 3, 'everything considered is retained');
});

test('pre-ticking is capped even when the model is confident about everything', () => {
  // The over-broad failure mode. Eight high-confidence metrics would make every
  // metric in the trial "shared, unsplittable" and the output worthless.
  const greedy = [
    'acne', 'texture', 'redness', 'oiliness', 'radiance', 'pore', 'moisture', 'wrinkle',
  ].map((concern) => ({ concern, confidence: 'high', because: 'plausible' }));

  const r = parseClassification(fixture(greedy));
  eq(r.targets.length, MAX_PRETICKED, `capped at ${MAX_PRETICKED}`);
  eq(r.targets, ['acne', 'texture', 'redness'], 'top of the ranking');
  eq(r.suggestions.length, 5, 'the rest stay visible as suggestions');
});

test('a product with no high-confidence metric pre-ticks nothing', () => {
  const r = parseClassification(
    fixture([{ concern: 'moisture', confidence: 'low', because: 'glycerin, like everything' }]),
  );
  eq(r.targets, [], 'nothing accepted by default');
  eq(r.suggestions, ['moisture'], 'still offered');
});

test('an empty ranking is valid, not an error', () => {
  const r = parseClassification(fixture([]));
  eq(r.targets, [], 'no targets');
  eq(r.ranked, [], 'no ranking');
});

test('an off-vocabulary concern is dropped, not fatal', () => {
  // Model output is the one place `drop` is correct: a bad suggestion should
  // cost that suggestion, not the whole product.
  const r = parseClassification(
    fixture([
      { concern: 'texture', confidence: 'high', because: 'BHA' },
      { concern: 'glow', confidence: 'high', because: 'invented' },
    ]),
  );
  eq(r.targets, ['texture'], 'good one survives');
  eq(r.rejected, ['glow'], 'bad one surfaced for inspection');
});

test('a duration claim is carried through when present', () => {
  const r = parseClassification(
    fixture([{ concern: 'texture', confidence: 'high', because: 'BHA' }], { durationClaimDays: 28 }),
  );
  eq(r.durationClaimDays, 28, 'label claim preserved');
});

test('a blocked prompt is raised rather than parsed into empty targets', () => {
  // A block must not look like "this product targets nothing" — that is a
  // legitimate answer for a bland cleanser, and conflating the two would put
  // silent empty targets into the cache.
  throws(
    () => parseClassification({ promptFeedback: { blockReason: 'SAFETY' } }),
    'classification blocked',
    'prompt-level block',
  );
});

test('a truncated or filtered candidate is raised, not partially parsed', () => {
  throws(
    () => parseClassification({ candidates: [{ finishReason: 'MAX_TOKENS' }], text: '{"ranked":[' }),
    'did not complete',
    'MAX_TOKENS',
  );
  throws(
    () => parseClassification({ candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] }),
    'did not complete',
    'content filter',
  );
});

test('a non-JSON response is raised with the payload visible', () => {
  throws(
    () => parseClassification({ candidates: [{ finishReason: 'STOP' }], text: 'I cannot help.' }),
    'was not JSON',
    'non-JSON',
  );
});

/* ---------- summary ---------- */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
