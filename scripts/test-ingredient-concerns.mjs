#!/usr/bin/env node
/**
 * Tests for the deterministic ingredient-function -> concern lexicon
 * (src/ingredient-concerns.mjs). Offline, no network, no API key.
 *
 *   node scripts/test-ingredient-concerns.mjs
 */

import { ANALYSIS_CONCERNS } from '../src/concerns.mjs';
import { FUNCTION_TO_CONCERN, deriveConcernTags } from '../src/ingredient-concerns.mjs';

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

const ingredient = (...functionSlugs) => ({
  functions: functionSlugs.map((slug) => ({ slug })),
});

/* ---------- lexicon shape ---------- */

console.log('\nlexicon shape');

test('every mapped concern is a real analysis concern', () => {
  for (const [fn, concerns] of Object.entries(FUNCTION_TO_CONCERN)) {
    for (const concern of concerns) {
      ok(ANALYSIS_CONCERNS.includes(concern), `${fn} -> ${concern} is not a canonical concern`);
    }
  }
});

test('the 21 function tags observed in the full corpus are all covered', () => {
  // Measured 2026-08-08 against every file in
  // skincare-data/raw/incidecoder/products/ — the complete taxonomy, not a
  // sample. If incidecoder introduces a new tag, this test should fail loudly
  // rather than have the tag silently contribute nothing.
  const observed = [
    'emollient', 'moisturizer-humectant', 'viscosity-controlling', 'solvent',
    'perfuming', 'emulsifying', 'antioxidant', 'preservative', 'surfactant-cleansing',
    'soothing', 'skin-identical-ingredient', 'buffering', 'colorant',
    'antimicrobial-antibacterial', 'chelating', 'cell-communicating-ingredient',
    'skin-brightening', 'sunscreen', 'anti-acne', 'exfoliant', 'abrasive-scrub',
  ];
  eq(observed.length, 21, 'sanity: the observed list itself should be 21 long');
  for (const slug of observed) {
    ok(Object.hasOwn(FUNCTION_TO_CONCERN, slug), `observed tag ${slug} has no entry (mapped or explicitly empty)`);
  }
});

/* ---------- deriveConcernTags ---------- */

console.log('\nderiveConcernTags');

test('a single-function ingredient maps to its concern', () => {
  eq(deriveConcernTags([ingredient('anti-acne')]), ['acne'], 'anti-acne -> acne');
});

test('niacinamide-shaped ingredient (cell-communicating, skin-brightening, anti-acne, moisturizer-humectant) unions all four functions', () => {
  const tags = deriveConcernTags([
    ingredient('cell-communicating-ingredient', 'skin-brightening', 'anti-acne', 'moisturizer-humectant'),
  ]);
  for (const expected of ['acne', 'radiance', 'age_spot', 'wrinkle', 'moisture']) {
    ok(tags.includes(expected), `expected ${expected} in ${JSON.stringify(tags)}`);
  }
  eq(tags.length, 5, `expected exactly 5 concerns, got ${JSON.stringify(tags)}`);
});

test('formulation-only functions (solvent, preservative, emulsifying) contribute nothing', () => {
  eq(deriveConcernTags([ingredient('solvent', 'preservative', 'emulsifying')]), [], 'no concerns from formulation roles');
});

test('duplicate concerns across multiple ingredients are deduped', () => {
  const tags = deriveConcernTags([ingredient('emollient'), ingredient('moisturizer-humectant')]);
  eq(tags, ['moisture'], 'both map to moisture, only once');
});

test('output has no duplicates regardless of ingredient order (display order is orderConcerns()\'s job, not this one\'s)', () => {
  const tags = deriveConcernTags([ingredient('cell-communicating-ingredient'), ingredient('anti-acne')]);
  eq(tags.slice().sort(), ['acne', 'wrinkle'], 'both concerns present, no dupes');
});

test('a product with no ingredients yields no tags', () => {
  eq(deriveConcernTags([]), [], 'empty input');
  eq(deriveConcernTags(undefined), [], 'undefined input');
});

test('an ingredient with unknown function slugs contributes nothing rather than throwing', () => {
  eq(deriveConcernTags([ingredient('some-future-tag-not-yet-mapped')]), [], 'unknown function is silently ignored');
});

test('caution ratings (comedogenicity/irritancy) never appear as concern tags', () => {
  // deriveConcernTags only reads .functions — passing rating fields alongside
  // must not leak them in as concerns.
  const tags = deriveConcernTags([
    { functions: [{ slug: 'emollient' }], irritancy: 5, comedogenicity: 5, take: 'icky' },
  ]);
  eq(tags, ['moisture'], 'ratings are ignored by this function entirely');
});

/* ---------- summary ---------- */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
