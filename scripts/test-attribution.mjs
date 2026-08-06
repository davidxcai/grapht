#!/usr/bin/env node
/**
 * Tests for the attribution engine (src/attribution.mjs).
 *
 * Every case here is a trial whose correct verdict is known by construction,
 * most of them lifted directly from the worked examples in
 * docs/trial-model.md. Offline, deterministic, free.
 *
 *   node scripts/test-attribution.mjs
 *   node scripts/test-attribution.mjs confound   # only matching cases
 */

import {
  VERDICTS,
  attributeMetric,
  attributeAll,
  normalizeRoutine,
} from '../src/attribution.mjs';
import { ANALYSIS_CONCERNS } from '../src/concerns.mjs';

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

/* ---------- fixtures ---------- */

/**
 * The canonical example from docs/trial-model.md: someone starts isotretinoin
 * and keeps a moisturiser they were already using. This is the trial the whole
 * baseline-routine concept exists for.
 */
const isotretinoinTrial = {
  baseline: [{ name: 'CeraVe Moisturising Cream', targets: ['moisture'] }],
  interventions: [
    { direction: 'add', name: 'Accutane 40mg', startedOn: '2026-01-01', targets: ['acne'] },
  ],
};

/** Two products added at once, both targeting moisture. */
const doubleUpTrial = {
  baseline: [],
  interventions: [
    { direction: 'add', name: 'The Ordinary HA 2%', startedOn: '2026-01-01', targets: ['moisture'] },
    { direction: 'add', name: 'Vanicream Moisturiser', startedOn: '2026-01-01', targets: ['moisture', 'redness'] },
  ],
};

/** A removal trial: stop the vitamin C, watch redness. */
const removalTrial = {
  baseline: [{ name: 'Cetaphil Cleanser', targets: [] }],
  interventions: [
    { direction: 'remove', name: 'Vitamin C serum', startedOn: '2026-03-01', targets: ['redness'] },
  ],
};

/* ---------- attribution table ---------- */

console.log('\nattribution table');

test('attributed — exactly one tracked intervention targets the metric', () => {
  const r = attributeMetric('acne', isotretinoinTrial);
  eq(r.verdict, VERDICTS.ATTRIBUTED, 'verdict');
  eq(r.contributors.map((c) => c.name), ['Accutane 40mg'], 'contributors');
  eq(r.unsplittable, false, 'unsplittable');
});

test('confounded — baseline targets it, nothing tracked does', () => {
  const r = attributeMetric('moisture', isotretinoinTrial);
  eq(r.verdict, VERDICTS.CONFOUNDED, 'verdict');
  eq(r.contributors, [], 'no tracked contributor may be named');
  eq(r.background, ['CeraVe Moisturising Cream'], 'background named');
});

test('confounded — the isotretinoin must NOT be credited for moisture', () => {
  // The whole point. Isotretinoin dries skin out; crediting it for a moisture
  // improvement is not merely unsupported, it is backwards.
  const r = attributeMetric('moisture', isotretinoinTrial);
  const named = r.contributors.map((c) => c.name);
  if (named.includes('Accutane 40mg')) {
    throw new Error('isotretinoin was credited for moisture — see docs/trial-model.md');
  }
});

test('unexplained — nothing anywhere targets it', () => {
  const r = attributeMetric('oiliness', isotretinoinTrial);
  eq(r.verdict, VERDICTS.UNEXPLAINED, 'verdict');
  eq(r.contributors, [], 'contributors');
  eq(r.background, [], 'background');
});

test('shared — two tracked interventions target it, credit unsplittable', () => {
  const r = attributeMetric('moisture', doubleUpTrial);
  eq(r.verdict, VERDICTS.SHARED, 'verdict');
  eq(r.unsplittable, true, 'unsplittable');
  eq(r.contributors.map((c) => c.name).sort(), ['The Ordinary HA 2%', 'Vanicream Moisturiser'], 'both named');
});

test('shared does not leak — a metric only one of them targets is still attributed', () => {
  const r = attributeMetric('redness', doubleUpTrial);
  eq(r.verdict, VERDICTS.ATTRIBUTED, 'verdict');
  eq(r.contributors.map((c) => c.name), ['Vanicream Moisturiser'], 'contributors');
});

/* ---------- removals ---------- */

console.log('\nremovals');

test('removal is first-class and receives credit like an addition', () => {
  const r = attributeMetric('redness', removalTrial);
  eq(r.verdict, VERDICTS.ATTRIBUTED, 'verdict');
  eq(r.contributors[0].direction, 'remove', 'direction carried through for narration');
});

test('a baseline entry targeting nothing does not confound anything', () => {
  const r = attributeMetric('acne', removalTrial);
  eq(r.verdict, VERDICTS.UNEXPLAINED, 'an empty-target baseline entry must not absorb metrics');
});

/* ---------- mid-trial starts ---------- */

console.log('\nmid-trial starts');

test('lateStart flags an intervention that began after the window opened', () => {
  const trial = {
    baseline: [],
    interventions: [
      { direction: 'add', name: 'Retinoid', startedOn: '2026-01-01', targets: ['texture'] },
      { direction: 'add', name: 'Azelaic acid', startedOn: '2026-02-15', targets: ['redness'] },
    ],
  };
  const onTime = attributeMetric('texture', trial, { windowStart: '2026-01-01' });
  const late = attributeMetric('redness', trial, { windowStart: '2026-01-01' });
  eq(onTime.contributors[0].lateStart, false, 'started with the window');
  eq(late.contributors[0].lateStart, true, 'started three weeks in');
});

test('lateStart does not change the verdict, only annotates it', () => {
  const trial = {
    baseline: [],
    interventions: [
      { direction: 'add', name: 'Azelaic acid', startedOn: '2026-02-15', targets: ['redness'] },
    ],
  };
  const r = attributeMetric('redness', trial, { windowStart: '2026-01-01' });
  eq(r.verdict, VERDICTS.ATTRIBUTED, 'still attributed');
});

/* ---------- vocabulary discipline ---------- */

console.log('\nvocabulary discipline');

test('hd_ prefix and casing normalize to the canonical key', () => {
  const trial = {
    baseline: [],
    interventions: [{ direction: 'add', name: 'X', targets: ['HD_Acne', ' texture '] }],
  };
  const r = attributeAll(trial);
  eq(r.byMetric.acne.verdict, VERDICTS.ATTRIBUTED, 'hd_acne -> acne');
  eq(r.byMetric.texture.verdict, VERDICTS.ATTRIBUTED, 'whitespace/case tolerated');
});

test('a simulation concern name is REJECTED, not silently coerced', () => {
  // `pores` is the simulation vocabulary; analysis says `pore`. Silently mapping
  // it is how a typo becomes a confident wrong answer.
  throws(
    () => attributeMetric('pore', { baseline: [], interventions: [{ direction: 'add', name: 'X', targets: ['pores'] }] }),
    'unrecognised concern',
    'simulation name in targets[]',
  );
});

test('a free-text target is rejected with the valid vocabulary in the message', () => {
  throws(
    () => normalizeRoutine({ interventions: [{ direction: 'add', name: 'X', targets: ['glow'] }] }),
    'unrecognised concern',
    'free text target',
  );
});

test('a missing or bogus direction is rejected', () => {
  throws(
    () => normalizeRoutine({ interventions: [{ name: 'X', targets: ['acne'] }] }),
    "direction 'add' or 'remove'",
    'missing direction',
  );
  throws(
    () => normalizeRoutine({ interventions: [{ direction: 'stopped', name: 'X', targets: ['acne'] }] }),
    "direction 'add' or 'remove'",
    'bogus direction',
  );
});

test('an unnamed routine entry is rejected', () => {
  throws(
    () => normalizeRoutine({ baseline: [{ targets: ['acne'] }] }),
    'non-empty name',
    'missing name',
  );
});

/* ---------- whole-trial pass ---------- */

console.log('\nwhole-trial pass');

test('attributeAll covers all 14 concerns by default, not just targeted ones', () => {
  const r = attributeAll(isotretinoinTrial);
  eq(Object.keys(r.byMetric).length, 14, 'metric count');
  eq(Object.keys(r.byMetric).sort(), [...ANALYSIS_CONCERNS].sort(), 'metric keys');
});

test('the untargeted majority lands in unexplained — where side effects live', () => {
  const r = attributeAll(isotretinoinTrial);
  eq(r.counts[VERDICTS.ATTRIBUTED], 1, 'acne');
  eq(r.counts[VERDICTS.CONFOUNDED], 1, 'moisture');
  eq(r.counts[VERDICTS.UNEXPLAINED], 12, 'the other twelve');
  eq(r.counts[VERDICTS.SHARED], 0, 'nothing shared');
});

test('interventions targeting nothing are surfaced, not silently ignored', () => {
  const trial = {
    baseline: [],
    interventions: [
      { direction: 'add', name: 'Unknown sample sachet', targets: [] },
      { direction: 'add', name: 'Niacinamide 10%', targets: ['redness'] },
    ],
  };
  const r = attributeAll(trial);
  eq(r.untargeted, ['Unknown sample sachet'], 'untargeted surfaced');
  eq(r.counts[VERDICTS.ATTRIBUTED], 1, 'the targeted one still works');
});

test('cleanlyResolvable names only interventions with no shared metric', () => {
  const trial = {
    baseline: [],
    interventions: [
      { direction: 'add', name: 'Clean', targets: ['acne'] },
      { direction: 'add', name: 'Overlap A', targets: ['moisture'] },
      { direction: 'add', name: 'Overlap B', targets: ['moisture'] },
    ],
  };
  const r = attributeAll(trial);
  eq(r.cleanlyResolvable, ['Clean'], 'only the non-overlapping intervention');
});

test('an empty routine is valid and reports everything unexplained', () => {
  const r = attributeAll({ baseline: [], interventions: [] });
  eq(r.counts[VERDICTS.UNEXPLAINED], 14, 'all 14');
});

/* ---------- summary ---------- */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
