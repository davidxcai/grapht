#!/usr/bin/env node
/**
 * The search and display layer (`lib/fuzzy.ts`, `lib/format.ts`,
 * `lib/concerns.ts`, `lib/greeting.ts`). Offline, deterministic, free.
 *
 * Worth pinning rather than eyeballing in the UI: the ranker decides which
 * trial or product a typed query finds at all, and `lib/concerns.ts` is the one
 * place a display label is allowed to differ from a key — "Pores" is the label
 * for `pore` and also the *simulation* name `pores`, which is exactly the
 * confusion `src/concerns.mjs` exists to prevent.
 *
 *   node scripts/test-search.mjs
 *   node scripts/test-search.mjs label   # only matching cases
 *
 * Node <23.6 needs `--experimental-strip-types` to import the `.ts` modules
 * under test, exactly as `scripts/test-capture-guide.mjs` does.
 */

import { register } from 'node:module';

// `lib/concerns.ts` reaches the pipeline vocabulary through the `@/` alias.
register('./alias-hook.mjs', import.meta.url);

const { fuzzyRank, fuzzyScore } = await import('../lib/fuzzy.ts');
const { formatCount } = await import('../lib/format.ts');
const { timeGreeting } = await import('../lib/greeting.ts');
const { CONCERNS, concernLabel, orderConcerns, validateConcerns } = await import('../lib/concerns.ts');

/* ---------- tiny harness, same shape as test-attribution.mjs ---------- */

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

function ok(condition, what) {
  if (!condition) throw new Error(what);
}

function throws(fn, match, what) {
  let err = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`${what}\n  expected a throw, got none`);
  if (match && !err.message.includes(match)) {
    throw new Error(`${what}\n  expected message containing: ${match}\n  actual: ${err.message}`);
  }
}

/* ---------- fuzzy matching ---------- */

console.log('\nfuzzy score — every query token has to land somewhere');

test('an empty query matches nothing', () => {
  eq(fuzzyScore('', 'The Ordinary Niacinamide'), 0, 'zero, so nothing is ranked in');
  eq(fuzzyScore('   ', 'The Ordinary Niacinamide'), 0, 'whitespace is empty too');
});

test('a substring beats a per-token match, and the tighter fit beats the looser', () => {
  const exact = fuzzyScore('niacinamide', 'Niacinamide');
  const inside = fuzzyScore('niacinamide', 'The Ordinary Niacinamide 10% + Zinc 1%');
  ok(exact === 100, `an exact substring with no slack scores 100, got ${exact}`);
  ok(inside > 0 && inside < exact, `the longer haystack scores lower (${inside} vs ${exact})`);
});

test('case and accents are normalised away', () => {
  eq(fuzzyScore('CERAVE', 'CeraVe'), 100, 'case-insensitive');
  eq(fuzzyScore('creme', 'Crème'), 100, 'the accent is stripped before comparing');
});

test('a word prefix matches, and scores below a whole word', () => {
  const whole = fuzzyScore('acid', 'salicylic acid serum');
  const prefix = fuzzyScore('sal', 'salicylic acid serum');
  ok(whole > prefix, `a whole word outranks a prefix (${whole} vs ${prefix})`);
  ok(prefix > 0, 'but a prefix still matches');
});

test('one typo in a long enough token is forgiven', () => {
  ok(fuzzyScore('niacinamde', 'The Ordinary Niacinamide') > 0, 'a dropped letter still finds it');
  ok(fuzzyScore('retnol serum', 'Retinol serum') > 0, 'in a multi-token query too');
});

test('a typo in a short token is not forgiven — three letters is too little to guess', () => {
  eq(fuzzyScore('rtn', 'Retinol'), 0, 'edit distance only applies from four characters');
});

test('two typos need a long token; a short one gets a single edit', () => {
  ok(fuzzyScore('niacinamibe', 'Niacinamide') > 0, 'seven-plus characters allow two edits');
  eq(fuzzyScore('crem', 'balm'), 0, 'two edits on a four-letter token is not a match');
});

test('every token must land, so an extra word rules a row out', () => {
  eq(fuzzyScore('ordinary tretinoin', 'The Ordinary Niacinamide'), 0, 'one unmatched token is a rejection');
});

test('multi-token queries add up across the text', () => {
  const both = fuzzyScore('ordinary niacinamide', 'The Ordinary Niacinamide 10%');
  const one = fuzzyScore('ordinary', 'The Ordinary Niacinamide 10%');
  ok(both > one, `two landed tokens beat one (${both} vs ${one})`);
});

console.log('\nfuzzy rank — filter and order, no index');

const rows = [
  { name: 'Retinol 0.5%' },
  { name: 'The Ordinary Niacinamide 10% + Zinc 1%' },
  { name: 'Niacinamide' },
  { name: 'CeraVe Moisturising Cream' },
];

test('an empty query returns everything untouched', () => {
  eq(fuzzyRank('  ', rows, (r) => r.name), rows, 'the list is passed straight through');
});

test('non-matches are dropped and the best fit comes first', () => {
  const ranked = fuzzyRank('niacinamide', rows, (r) => r.name).map((r) => r.name);
  eq(ranked, ['Niacinamide', 'The Ordinary Niacinamide 10% + Zinc 1%'], 'tightest match first');
});

test('a query that matches nothing returns an empty list', () => {
  eq(fuzzyRank('tretinoin', rows, (r) => r.name), [], 'no row is invented to fill the page');
});

/* ---------- counts ---------- */

console.log('\ncounts — 999, 5.4k, 1.2m');

test('under a thousand is written out', () => {
  eq(formatCount(0), '0', 'zero');
  eq(formatCount(999), '999', 'the last plain number');
});

test('thousands carry one decimal until three digits', () => {
  eq(formatCount(1000), '1k', 'the boundary');
  eq(formatCount(5400), '5.4k', 'one decimal');
  eq(formatCount(5450), '5.5k', 'rounded, not truncated');
  eq(formatCount(150_000), '150k', 'no decimal once it would be noise');
});

test('millions follow the same shape', () => {
  eq(formatCount(1_200_000), '1.2m', 'one decimal');
  eq(formatCount(150_000_000), '150m', 'and none at three digits');
});

/* ---------- the concern vocabulary ---------- */

console.log('\nconcerns — labels are display strings and never keys');

test('the canonical list is the pipeline vocabulary, in its order', () => {
  eq(CONCERNS.length, 15, 'fifteen concerns, not fourteen');
  eq(CONCERNS[0], 'acne', 'the order is canonical and never re-sorted for display');
  eq(CONCERNS.includes('tear_trough'), true, 'the fifteenth, added 2026-08-09');
});

test('every concern has a label, and the labels do not round-trip as keys', () => {
  for (const concern of CONCERNS) {
    const label = concernLabel(concern);
    ok(/^[A-Z]/.test(label), `${concern} needs a display label, got ${JSON.stringify(label)}`);
    ok(!label.includes('_'), `${concern}'s label leaks the key shape: ${label}`);
  }
  eq(concernLabel('pore'), 'Pores', 'the label is also the simulation key — read, never write');
  eq(concernLabel('dark_circle_v2'), 'Dark circles', 'no version number reaches the screen');
});

test('an unknown key falls back to itself rather than blanking the row', () => {
  eq(concernLabel('pores'), 'pores', 'the simulation name is not a concern and gets no label');
});

test('validation rejects an unrecognised key instead of shrugging', () => {
  eq(validateConcerns(['hd_acne', ' Pore ']), ['acne', 'pore'], 'prefix and whitespace are tolerated');
  throws(() => validateConcerns(['pores']), 'pores', 'a simulation name must not quietly become `pore`');
});

test('ordering a set puts it in canonical order and drops what is not a concern', () => {
  eq(orderConcerns(['pore', 'acne', 'pore']), ['acne', 'pore'], 'deduplicated and reordered');
  eq(orderConcerns(['nonsense']), [], 'nothing unrecognised survives into a display list');
});

/* ---------- the greeting ---------- */

console.log('\ngreeting — computed on both server and client from the same rule');

test('the day splits at noon and six', () => {
  eq(timeGreeting(0), 'Good morning', 'midnight');
  eq(timeGreeting(11), 'Good morning', 'the last morning hour');
  eq(timeGreeting(12), 'Good afternoon', 'noon');
  eq(timeGreeting(17), 'Good afternoon', 'the last afternoon hour');
  eq(timeGreeting(18), 'Good evening', 'six');
  eq(timeGreeting(23), 'Good evening', 'and the rest of the night');
});

/* ---------- summary ---------- */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
