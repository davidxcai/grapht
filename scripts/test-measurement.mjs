#!/usr/bin/env node
/**
 * The measurement layer: burst grouping (`src/sessions.mjs`), the noise floor
 * (`src/noise-floor.mjs`), cross-device correction (`src/device-offset.mjs`) and
 * score normalisation (`normalizeScores` in `src/results.mjs`). Offline,
 * deterministic, free — every record below is synthetic, so no photo, API key or
 * `data/` directory is touched.
 *
 * These four are the numbers everything else is derived from, and each had no
 * test: what counts as one burst, what the instrument's own wobble is, what to
 * add to a raw score taken on another camera, and which of Perfect Corp's two
 * inconsistent payload shapes a concern arrived in. Getting any of them wrong
 * does not raise — it produces a confident wrong answer.
 *
 *   node scripts/test-measurement.mjs
 *   node scripts/test-measurement.mjs offset   # only matching cases
 */

import { groupSessions, DEFAULT_SESSION_GAP_SECONDS } from '../src/sessions.mjs';
import { computeNoiseFloor } from '../src/noise-floor.mjs';
import {
  computeDeviceOffsets,
  correctForDevice,
  findCalibrationPairs,
} from '../src/device-offset.mjs';
import { normalizeScores } from '../src/results.mjs';

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

function close(actual, expected, what, tolerance = 1e-9) {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${what}\n  expected: ${expected} (±${tolerance})\n  actual:   ${actual}`);
  }
}

/* ---------- fixtures ---------- */

const METRICS = ['acne', 'pore'];

/** One analysed photo, in the shape the pipeline caches it. */
function record(capturedAt, device, values, iso = 100) {
  return {
    capturedAt,
    device,
    iso,
    concerns: Object.fromEntries(Object.entries(values).map(([m, raw]) => [m, { raw, ui: null }])),
  };
}

/* ---------- bursts ---------- */

console.log('\nsessions — a burst is one data point, not six');

test('consecutive shots on one device inside the gap are one session', () => {
  const sessions = groupSessions([
    record('2026-08-01T09:00:00Z', 'A', { acne: 50 }),
    record('2026-08-01T09:00:30Z', 'A', { acne: 52 }),
    record('2026-08-01T09:01:00Z', 'A', { acne: 51 }),
  ]);
  eq(sessions.map((s) => s.length), [3], 'one burst of three');
});

test('input need not be sorted', () => {
  const sessions = groupSessions([
    record('2026-08-01T09:01:00Z', 'A', { acne: 51 }),
    record('2026-08-01T09:00:00Z', 'A', { acne: 50 }),
  ]);
  eq(
    sessions[0].map((r) => r.capturedAt),
    ['2026-08-01T09:00:00Z', '2026-08-01T09:01:00Z'],
    'sorted into place first',
  );
});

test('a change of device splits a session however small the gap', () => {
  const sessions = groupSessions([
    record('2026-08-01T09:00:00Z', 'A', { acne: 50 }),
    record('2026-08-01T09:00:10Z', 'B', { acne: 20 }),
  ]);
  eq(sessions.map((s) => s[0].device), ['A', 'B'], 'hardware is never averaged into a burst');
});

test('the gap is the default five minutes, and it is configurable', () => {
  eq(DEFAULT_SESSION_GAP_SECONDS, 300, 'five minutes');
  const records = [
    record('2026-08-01T09:00:00Z', 'A', { acne: 50 }),
    record('2026-08-01T09:04:00Z', 'A', { acne: 51 }),
  ];
  eq(groupSessions(records).map((s) => s.length), [2], 'four minutes apart is one burst');
  eq(
    groupSessions(records, { gapSeconds: 60 }).map((s) => s.length),
    [1, 1],
    'tighten the gap and it is two',
  );
});

test('the boundary second still counts as the same burst', () => {
  const sessions = groupSessions(
    [record('2026-08-01T09:00:00Z', 'A', { acne: 50 }), record('2026-08-01T09:05:00Z', 'A', { acne: 51 })],
    { gapSeconds: 300 },
  );
  eq(sessions.map((s) => s.length), [2], 'exactly at the gap is inside it');
});

test('no records is no sessions', () => {
  eq(groupSessions([]), [], 'an empty list, not a session of nothing');
});

/* ---------- the noise floor ---------- */

console.log('\nnoise floor — spread inside a burst is the instrument, not the face');

const BURSTS = [
  // Controlled lighting: ISO steady, so any spread is capture-and-model noise.
  record('2026-08-01T09:00:00Z', 'A', { acne: 50, pore: 30 }, 100),
  record('2026-08-01T09:00:20Z', 'A', { acne: 56, pore: 40 }, 110),
  // Varied lighting: >2x ISO spread inside one burst means the light changed.
  record('2026-08-05T09:00:00Z', 'A', { acne: 50, pore: 30 }, 100),
  record('2026-08-05T09:00:20Z', 'A', { acne: 90, pore: 31 }, 400),
];

test('the worst spread within a controlled burst is the floor', () => {
  const { controlled } = computeNoiseFloor(BURSTS, METRICS);
  eq([controlled.acne, controlled.pore], [6, 10], 'max minus min, per metric');
});

test('a burst whose ISO more than doubles is filed as varied, not as the floor', () => {
  const { varied, bursts } = computeNoiseFloor(BURSTS, METRICS);
  eq(varied.acne, 40, 'the lighting change, kept separately');
  eq(bursts.map((b) => b.lightingVaried), [false, true], 'and flagged on the burst itself');
});

test('the gating figure prefers controlled and falls back to varied', () => {
  const { worst } = computeNoiseFloor(BURSTS, METRICS);
  eq(worst.acne, 6, 'controlled wins where it exists');

  const variedOnly = computeNoiseFloor(BURSTS.slice(2), METRICS);
  eq(variedOnly.worst.acne, 40, 'and varied is the fallback, never the preference');
});

test('a metric with no burst evidence is null rather than zero', () => {
  const { worst, controlled } = computeNoiseFloor(BURSTS, [...METRICS, 'tear_trough']);
  eq(controlled.tear_trough, null, 'never measured');
  eq(worst.tear_trough, null, 'and a null floor, not a permissive zero');
});

test('a single-photo session is not a burst and cannot measure noise', () => {
  const { bursts } = computeNoiseFloor(
    [record('2026-08-01T09:00:00Z', 'A', { acne: 50 }), record('2026-09-01T09:00:00Z', 'A', { acne: 70 })],
    METRICS,
  );
  eq(bursts, [], 'two photos a month apart are biology, not instrument');
});

test('each burst reports its own device, ISO range and size', () => {
  const [first] = computeNoiseFloor(BURSTS, METRICS).bursts;
  eq([first.device, first.n, first.isoMin, first.isoMax], ['A', 2, 100, 110], 'for display');
});

/* ---------- cross-device correction ---------- */

console.log('\ndevice offsets — hardware, not biology, and derived rather than hardcoded');

const CROSS_DEVICE = [
  record('2026-08-01T09:00:00Z', 'XS', { acne: 50, pore: 20 }),
  record('2026-08-01T09:00:20Z', 'XS', { acne: 52, pore: 22 }),
  // Same face, minutes later, other camera: the difference is the hardware.
  record('2026-08-01T09:30:00Z', '16e', { acne: 61, pore: 61 }),
  record('2026-08-01T09:30:20Z', '16e', { acne: 63, pore: 63 }),
];

test('consecutive sessions on different devices close together are a calibration pair', () => {
  const [pair] = findCalibrationPairs(CROSS_DEVICE, METRICS);
  eq([pair.deviceA, pair.deviceB], ['XS', '16e'], 'A then B, in time order');
  close(pair.deltas.acne, 11, 'mean(B) − mean(A) for acne');
  close(pair.deltas.pore, 41, 'and 41 points on pore, which is why this exists');
});

test('a pair too far apart is biology and is not used', () => {
  const spread = [
    ...CROSS_DEVICE.slice(0, 2),
    record('2026-08-20T09:00:00Z', '16e', { acne: 61, pore: 61 }),
  ];
  eq(findCalibrationPairs(spread, METRICS), [], 'over the five-day maximum gap');
});

test('a metric missing on one side of the pair yields a null delta, not a guess', () => {
  const partial = [
    record('2026-08-01T09:00:00Z', 'XS', { acne: 50 }),
    record('2026-08-01T09:30:00Z', '16e', { acne: 61, pore: 61 }),
  ];
  const [pair] = findCalibrationPairs(partial, METRICS);
  eq(pair.deltas.pore, null, 'nothing to difference against');
});

test('the baseline device has a zero offset and the other is signed to reach it', () => {
  const { offsetToBaseline } = computeDeviceOffsets(CROSS_DEVICE, { baseline: '16e', metrics: METRICS });
  eq(offsetToBaseline['16e'], { acne: 0, pore: 0 }, 'the baseline needs no correction');
  close(offsetToBaseline.XS.acne, 11, 'add 11 to an XS acne score to read it as a 16e one');
  close(offsetToBaseline.XS.pore, 41, 'and 41 on pore');
});

test('a device with no direct pairing is chained through an intermediate', () => {
  const chained = [
    ...CROSS_DEVICE,
    // iPad only ever overlaps with the XS, exactly as in the reference dataset.
    // The XS scores repeat that device's earlier session mean so the second
    // XS ↔ 16e transition this creates averages to the same +11/+41 edge.
    record('2026-08-03T09:00:00Z', 'XS', { acne: 51, pore: 21 }),
    record('2026-08-03T09:30:00Z', 'iPad', { acne: 46, pore: 11 }),
  ];
  const { offsetToBaseline } = computeDeviceOffsets(chained, { baseline: '16e', metrics: METRICS });
  close(offsetToBaseline.iPad.acne, 16, 'iPad → XS (+5) chained through XS → 16e (+11)');
  close(offsetToBaseline.iPad.pore, 51, 'and +10 chained through +41');
});

test('an edge observed more than once is the mean, not the latest', () => {
  const twice = [
    ...CROSS_DEVICE,
    // A second XS → 16e transition, 20 points apart instead of 11. Each pair
    // also registers its reverse, so this edge holds +11, +11 and +20.
    record('2026-08-03T09:00:00Z', 'XS', { acne: 51 }),
    record('2026-08-03T09:30:00Z', '16e', { acne: 71 }),
  ];
  const { offsetToBaseline } = computeDeviceOffsets(twice, { baseline: '16e', metrics: ['acne'] });
  close(offsetToBaseline.XS.acne, 14, 'averaged over every observed transition');
});

test('a device with no path to the baseline is uncorrectable, not approximated', () => {
  const orphan = [
    ...CROSS_DEVICE,
    record('2026-09-20T09:00:00Z', 'Pixel', { acne: 40, pore: 40 }),
  ];
  const { offsetToBaseline } = computeDeviceOffsets(orphan, { baseline: '16e', metrics: METRICS });
  eq(offsetToBaseline.Pixel, { acne: null, pore: null }, 'null — do not plot against the corrected series');
});

test('applying an offset is additive and never clamped', () => {
  const offsets = { offsetToBaseline: { iPad: { pore: -87, acne: null } } };
  close(correctForDevice(30, 'pore', 'iPad', offsets), -57, 'corrected pore may go negative');
  eq(correctForDevice(30, 'acne', 'iPad', offsets), 30, 'a null offset passes the score through');
  eq(correctForDevice(30, 'pore', 'Unknown', offsets), 30, 'so does an unknown device');
  eq(correctForDevice(null, 'pore', 'iPad', offsets), null, 'and a missing score stays missing');
});

/* ---------- score normalisation ---------- */

console.log('\nscore normalisation — two payload shapes in one response');

test('a flat concern is read straight through, prefix stripped', () => {
  const { concerns } = normalizeScores({ hd_redness: { raw_score: 61, ui_score: 70 } });
  eq(concerns.redness, { raw: 61, ui: 70 }, 'the flat shape');
});

test('a nested concern takes `whole` as the headline and keeps its zones', () => {
  const { concerns, zones } = normalizeScores({
    hd_pore: {
      whole: { raw_score: 30, ui_score: 40 },
      forehead: { raw_score: 20, ui_score: 25 },
      nose: { raw_score: 10, ui_score: 15 },
    },
  });
  eq(concerns.pore, { raw: 30, ui: 40 }, '`whole` is the headline figure');
  eq(Object.keys(zones.pore), ['forehead', 'nose'], 'regional trends stay available');
});

test('zones with no `whole` fall back to the zone mean rather than vanishing', () => {
  const { concerns } = normalizeScores({
    hd_pore: { forehead: { raw_score: 20 }, nose: { raw_score: 10 } },
  });
  eq(concerns.pore, { raw: 15, ui: null, derived: 'zone-mean' }, 'and it says it was derived');
});

test('the asymmetric dark-circle name lands on the canonical key either way', () => {
  eq(normalizeScores({ hd_dark_circle: { raw_score: 44 } }).concerns.dark_circle_v2.raw, 44, 'the request name');
  eq(normalizeScores({ hd_dark_circle_v2: { raw_score: 44 } }).concerns.dark_circle_v2.raw, 44, 'the documented one');
});

test('a missing ui_score is null, never folded into the raw measurement', () => {
  const { concerns } = normalizeScores({ hd_acne: { whole: { raw_score: 50 } } });
  eq(concerns.acne, { raw: 50, ui: null }, 'raw is the only thing the app computes with');
});

test('the envelope keys are pulled out rather than treated as concerns', () => {
  const result = normalizeScores({
    all: { score: 72 },
    skin_age: 29,
    resize_image: 'skinanalysisResult/resize_image.jpg',
    hd_acne: { raw_score: 50 },
  });
  eq(Object.keys(result.concerns), ['acne'], 'only concerns in the concern map');
  eq([result.skinAge, result.allScore], [29, 72], 'and the envelope read separately');
});

test('an unscored or malformed entry is skipped, not defaulted', () => {
  const { concerns } = normalizeScores({ hd_skin_type: { whole: 'Combination' }, hd_acne: null });
  eq(concerns, {}, 'a categorical value has no place in a numeric vocabulary');
});

/* ---------- summary ---------- */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
