#!/usr/bin/env node
/**
 * Synthetic stress tests for the KF + OLS forecast engine.
 *
 * The real dataset (20 photos, 3 blocks, a 416-day gap) exercises exactly one
 * trajectory shape: a purge trough followed by recovery. This harness feeds the
 * *same* engine path that scripts/forecast.mjs uses — local-linear-trend filter,
 * OLS over the same points, inverse-variance blend, confidence-gated horizons —
 * a set of hand-built two-week series where the ground truth is known by
 * construction, so the forecast can be scored rather than just inspected.
 *
 * Nothing here touches the API or the cache. Free, offline, deterministic:
 * measurement noise comes from a seeded PRNG, so reruns reproduce exactly.
 *
 *   node scripts/test-scenarios.mjs             # all scenarios, one seeded draw each
 *   node scripts/test-scenarios.mjs --clean     # noiseless truth only
 *   node scripts/test-scenarios.mjs --repeat=200# rates over 200 noise draws, not anecdotes
 *   node scripts/test-scenarios.mjs flat up     # only scenarios matching a name
 *
 * Reading the output:
 *   - `trend` rows print the raw Kalman trend, the OLS slope, and the blend the
 *     product actually forecasts from, against the true slope of the *final*
 *     regime. The three diverging is the interesting case, not a bug — see
 *     docs/forecast-design.md, "KF + OLS inverse-variance blend".
 *   - horizon rows print the forecast, its confidence, and the error against
 *     truth extended past the last observation. An error inside the noise floor
 *     is by this project's own definition indistinguishable from correct.
 *   - Scenarios that print no horizons are the engine *declining* to forecast.
 *     That is a designed outcome and a pass, not a failure.
 */

import { fitLinear } from '../src/regression.mjs';
import { SCORE_MIN, SCORE_MAX } from '../src/concerns.mjs';
import {
  runLocalTrendFilter,
  forecast as kalmanForecast,
  defaultProcessNoise,
  observationVariance,
  predictionConfidence,
  blendTrend,
  applyBlendedTrend,
} from '../src/kalman.mjs';

// Same product rules as scripts/forecast.mjs — this harness is only useful if
// it fails where the product would fail.
const MAX_HORIZON_DAYS = 14;
const HORIZONS = [1, 3, 7, 14];
const MIN_CONFIDENCE = 0.5;

// Acne under controlled lighting: 7.5 points of same-burst spread
// (docs/measurements.md, Finding 1). The realistic floor for a well-captured
// series, and the default every scenario below inherits unless it says otherwise.
const ACNE_FLOOR = 7.5;
// Texture under *varied* lighting, same finding. The pathological case.
const VARIED_LIGHTING_FLOOR = 57.6;

const DAYS = Array.from({ length: 14 }, (_, i) => i);

/* ---------- deterministic noise ---------- */

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Box-Muller. sd defaults to floor/2, matching observationVariance()'s own
 *  range-to-sigma assumption — i.e. noise consistent with the floor we hand
 *  the filter, rather than noise the filter isn't expecting. */
function gaussian(rand, sd) {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()) * sd;
}

/* ---------- scenarios ---------- */

const RATE = 1.5;       // pts/day for an unambiguous trend: ~10 pts over a week
const SUBTLE = 0.3;     // pts/day for a real but sub-noise-floor trend
const ramp = (d, from, rate) => (d <= from ? 0 : (d - from) * rate);

const scenarios = [
  {
    name: 'flat-then-up',
    what: '1 week flat, then 1 week improving',
    truth: (d) => 60 + ramp(d, 6, RATE),
    trueSlope: RATE,
    note: 'The routine starts working mid-window. Can the filter see the elbow?',
  },
  {
    name: 'flat-then-down',
    what: '1 week flat, then 1 week worsening',
    truth: (d) => 60 - ramp(d, 6, RATE),
    trueSlope: -RATE,
    note: 'A flare-up starting mid-window. Must not be smoothed away.',
  },
  {
    name: 'up-then-flat',
    what: '1 week improving, then 1 week plateaued',
    truth: (d) => 60 + Math.min(d, 6) * RATE,
    trueSlope: 0,
    note: 'Improvement stalls. Forecasting continued gains here is the classic overpromise.',
  },
  {
    name: 'down-then-flat',
    what: '1 week worsening, then 1 week plateaued',
    truth: (d) => 60 - Math.min(d, 6) * RATE,
    trueSlope: 0,
    note: 'Damage done, now stable. Forecasting continued decline is the mirror overpromise.',
  },
  {
    name: 'up-then-down',
    what: '1 week improving, then 1 week worsening (peak mid-window)',
    truth: (d) => 60 + Math.min(d, 6) * RATE - ramp(d, 6, RATE),
    trueSlope: -RATE,
    note: 'Reversal at a peak. The KF should follow it; OLS over the whole window sees ~0.',
  },
  {
    name: 'down-then-up',
    what: '1 week worsening, then 1 week recovering (trough mid-window)',
    truth: (d) => 60 - Math.min(d, 6) * RATE + ramp(d, 6, RATE),
    trueSlope: RATE,
    note: 'The purge shape, compressed into 14 days. This is the case the KF exists for.',
  },
  {
    name: 'outlier-midweek',
    what: 'flat, with one badly-lit day at d7 (-25 pts)',
    truth: () => 60,
    trueSlope: 0,
    spike: { day: 7, delta: -25 },
    note: 'One bad capture in the middle. Should be absorbed, not extrapolated.',
  },
  {
    name: 'outlier-last-day',
    what: 'flat, with one badly-lit day at d13 (-25 pts)',
    truth: () => 60,
    trueSlope: 0,
    spike: { day: 13, delta: -25 },
    note: 'The worst case for a recency-weighted filter: the bad photo is the newest one.',
  },
  {
    name: 'outlier-last-day-uptrend',
    what: 'steady improvement, with one badly-lit day at d13 (-25 pts)',
    truth: (d) => 60 + d * RATE,
    trueSlope: RATE,
    spike: { day: 13, delta: -25 },
    note: 'Can one bad final photo flip a genuine improvement into a forecast decline?',
  },
  {
    name: 'flat',
    what: 'no trend at all, noise only',
    truth: () => 60,
    trueSlope: 0,
    note: 'Control. Any confident trend here is invented.',
  },
  {
    name: 'steady-up',
    what: `unambiguous linear improvement (+${RATE}/day)`,
    truth: (d) => 60 + d * RATE,
    trueSlope: RATE,
    note: 'Control. The engine should be both right and confident.',
  },
  {
    name: 'steady-down',
    what: `unambiguous linear decline (-${RATE}/day)`,
    truth: (d) => 60 - d * RATE,
    trueSlope: -RATE,
    note: 'Control, worsening direction. Must be reported, not softened.',
  },
  {
    name: 'subtle-up',
    what: `real but sub-noise improvement (+${SUBTLE}/day, ~4 pts/2wk vs a ${ACNE_FLOOR}-pt floor)`,
    truth: (d) => 60 + d * SUBTLE,
    trueSlope: SUBTLE,
    note: 'Signal smaller than the noise floor. Humility is the correct answer.',
  },
  {
    name: 'zigzag',
    what: 'alternating 74/66 every day, no real trend',
    truth: (d) => (d % 2 === 0 ? 74 : 66),
    trueSlope: 0,
    truthContinuation: () => 70,
    noiseSd: 0,
    note: 'The regression test from docs/forecast-design.md, daily instead of weekly.',
  },
  {
    name: 'step-change',
    what: 'flat at 60 for a week, one-day jump to 72, flat after',
    truth: (d) => (d <= 6 ? 60 : 72),
    trueSlope: 0,
    note: 'A discontinuity, not a trend: new product, or an uncorrected device switch.',
  },
  {
    name: 'plateau',
    what: 'fast early gains flattening out (diminishing returns)',
    truth: (d) => 60 + 18 * (1 - Math.exp(-d / 4)),
    trueSlope: (18 / 4) * Math.exp(-13 / 4),
    note: 'The realistic shape of a working routine. Linear extrapolation overshoots.',
  },
  {
    name: 'sparse-5',
    what: `improvement (+${RATE}/day) sampled only 5 times in 14 days`,
    truth: (d) => 60 + d * RATE,
    trueSlope: RATE,
    days: [0, 3, 7, 10, 13],
    note: 'Exactly at blendTrend()\'s 5-point minimum — the blend should just barely engage.',
  },
  {
    name: 'sparse-3',
    what: `improvement (+${RATE}/day) sampled only 3 times in 14 days`,
    truth: (d) => 60 + d * RATE,
    trueSlope: RATE,
    days: [0, 7, 13],
    note: 'Below the guard: KF-only, no OLS. Confirms the small-sample fallback fires.',
  },
  {
    name: 'varied-lighting',
    what: 'flat truth, but captured under the varied lighting of Finding 1',
    truth: () => 60,
    trueSlope: 0,
    floor: VARIED_LIGHTING_FLOOR,
    note: `Noise floor ${VARIED_LIGHTING_FLOOR}. Nothing is measurable here; the engine should say so.`,
  },
  {
    name: 'near-ceiling',
    what: 'already excellent skin (starts at 92) still improving',
    truth: (d) => Math.min(SCORE_MAX, 92 + d * RATE),
    trueSlope: 0,
    note: 'The scale runs out. An unclamped line forecasts 110, which the API cannot report.',
  },
  {
    name: 'near-floor',
    what: 'very poor skin (starts at 8) still worsening',
    truth: (d) => Math.max(SCORE_MIN, 8 - d * RATE),
    trueSlope: 0,
    note: 'Mirror case at the bottom of the scale.',
  },
  {
    name: 'gap',
    what: 'a week of data, a 30-day silence, then one more photo',
    truth: (d) => 60 + Math.min(d, 6) * RATE,
    trueSlope: 0,
    days: [0, 1, 2, 3, 4, 5, 6, 36],
    note: 'Trend earned over a week, then a month of nothing. Old confidence must decay.',
  },
];

/* ---------- engine (mirrors scripts/forecast.mjs) ---------- */

function runEngine(points, floor) {
  const r = observationVariance(floor);
  const q = defaultProcessNoise(floor);
  const { states, final } = runLocalTrendFilter(points, { q, r });
  const last = states.at(-1);

  const ols = fitLinear(points);
  const blend = blendTrend({ trend: last.trend, trendVar: last.trendVar }, ols);
  const blendedFinal = applyBlendedTrend(final, blend);

  const horizons = [];
  for (const h of HORIZONS) {
    if (h > MAX_HORIZON_DAYS) break;
    const fc = kalmanForecast(blendedFinal, h, { q, r, bounds: { min: SCORE_MIN, max: SCORE_MAX } });
    const confidence = predictionConfidence(fc.sd, floor);
    if (confidence < MIN_CONFIDENCE) break;
    horizons.push({ h, value: fc.value, raw: fc.raw, clamped: fc.clamped, sd: fc.sd, confidence });
  }

  return { kfTrend: last.trend, kfLevel: last.level, ols, blend, horizons };
}

/* ---------- reporting ---------- */

const clean = process.argv.includes('--clean');
const repeatArg = process.argv.find((a) => a.startsWith('--repeat'));
const repeat = repeatArg ? Number(repeatArg.split('=')[1] ?? 200) : 0;
const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sign = (v, digits = 3) => (v >= 0 ? '+' : '') + v.toFixed(digits);
const pad = (s, w) => String(s).padStart(w);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Build one realisation of a scenario's observations.
 *
 * Observations are clamped to 0-100 because that is what the instrument can
 * report — a synthetic series with a 111 in it isn't testing the near-ceiling
 * case, it's testing a reading the API cannot produce. This is the opposite of
 * the rule for *device-corrected* real data, which stays unclamped on purpose
 * (CLAUDE.md rule 6); here we're simulating the raw instrument, not a
 * correction applied on top of it.
 */
function observe(s, floor, noiseSd, seed) {
  const rand = mulberry32(seed);
  return (s.days ?? DAYS).map((d) => {
    let y = s.truth(d);
    if (s.spike && s.spike.day === d) y += s.spike.delta;
    if (noiseSd > 0) y += gaussian(rand, noiseSd);
    return { x: d, y: Math.min(SCORE_MAX, Math.max(SCORE_MIN, y)) };
  });
}

// Filter by name, but keep each scenario's original index: the index seeds the
// PRNG, so a filtered run reproduces the same numbers as the full run.
const selected = scenarios
  .map((s, i) => [i, s])
  .filter(([, s]) => !filters.length || filters.some((f) => s.name.includes(f)));

/* ---------- --repeat: rates over many noise draws ---------- */

if (repeat > 0) {
  console.log(`KF + OLS forecast engine — ${repeat} noise draws per scenario\n`);
  console.log('A single seeded draw can flatter or libel the engine. These are rates.');
  console.log('"sign wrong" is only scored where the true slope is big enough to have a sign.\n');
  console.log(
    `${'scenario'.padEnd(26)}${'med blend'.padStart(10)}${'true'.padStart(8)}` +
      `${'sign wrong'.padStart(12)}${'med|err@7d|'.padStart(12)}${'err>floor'.padStart(11)}${'no fc'.padStart(7)}`,
  );

  for (const [i, s] of selected) {
    const floor = s.floor ?? ACNE_FLOOR;
    const noiseSd = clean ? 0 : (s.noiseSd ?? floor / 2);
    const lastDay = (s.days ?? DAYS).at(-1);
    const truthAt = (d) => (s.truthContinuation ?? s.truth)(d);
    const truth7 = truthAt(lastDay + 7);

    const trends = [];
    const errs = [];
    let wrongSign = 0;
    let overFloor = 0;
    let noForecast = 0;

    for (let k = 0; k < repeat; k++) {
      const points = observe(s, floor, noiseSd, 1_000_000 + i * 9973 + k * 7919);
      const { blend, horizons } = runEngine(points, floor);
      trends.push(blend.trend);
      if (Math.abs(s.trueSlope) >= 0.1 && Math.sign(blend.trend) !== Math.sign(s.trueSlope)) wrongSign++;
      const h7 = horizons.find((x) => x.h === 7);
      if (!h7) { noForecast++; continue; }
      const err = Math.abs(h7.value - truth7);
      errs.push(err);
      if (err > floor) overFloor++;
    }

    const pct = (n) => `${((n / repeat) * 100).toFixed(0)}%`;
    console.log(
      s.name.padEnd(26) +
        pad(sign(median(trends)), 10) +
        pad(sign(s.trueSlope, 2), 8) +
        pad(Math.abs(s.trueSlope) < 0.1 ? '—' : pct(wrongSign), 12) +
        pad(errs.length ? median(errs).toFixed(1) : '—', 12) +
        pad(pct(overFloor), 11) +
        pad(pct(noForecast), 7),
    );
  }
  console.log('\n"no fc" = fraction of draws where no horizon cleared 50% confidence.');
  process.exit(0);
}

console.log('KF + OLS forecast engine — synthetic scenario tests');
console.log(`Two-week daily series unless noted. Scores 0-100, HIGHER IS HEALTHIER.`);
console.log(`Noise floor ${ACNE_FLOOR} (acne, controlled lighting) unless noted.`);
console.log(clean ? 'Measurement noise: OFF (--clean)\n' : 'Measurement noise: ON (seeded, sd = floor/2)\n');

const summary = [];

for (const [i, s] of selected) {
  const floor = s.floor ?? ACNE_FLOOR;
  const days = s.days ?? DAYS;
  const noiseSd = clean ? 0 : (s.noiseSd ?? floor / 2);

  const points = observe(s, floor, noiseSd, 1000 + i * 7);
  const { kfTrend, kfLevel, ols, blend, horizons } = runEngine(points, floor);

  console.log(`── ${s.name} ${'─'.repeat(Math.max(0, 58 - s.name.length))}`);
  console.log(`   ${s.what}`);
  console.log(`   ${s.note}`);
  console.log(`   obs: ${points.map((p) => `d${p.x}:${p.y.toFixed(0)}`).join('  ')}`);

  const blendNote = blend.blended ? `blended (n=${ols.n})` : `KF-only, n=${ols.n} < 5`;
  console.log(
    `   trend/day   KF ${sign(kfTrend)}   OLS ${sign(ols.slope)} (r²=${ols.r2.toFixed(2)})` +
      `   →  ${sign(blend.trend)} ${blendNote}   [true ${sign(s.trueSlope)}]`,
  );
  console.log(`   filtered level at last obs: ${kfLevel.toFixed(1)}   noise floor: ${floor.toFixed(1)}`);

  const lastDay = days.at(-1);
  const truthAt = (d) => (s.truthContinuation ?? s.truth)(d);

  if (!horizons.length) {
    console.log(`   NO FORECAST — no horizon clears ${MIN_CONFIDENCE * 100}% confidence`);
  }
  for (const { h, value, raw, clamped, confidence } of horizons) {
    const truth = truthAt(lastDay + h);
    const err = value - truth;
    const flag = Math.abs(err) <= floor ? 'within floor' : `OFF by ${(Math.abs(err) / floor).toFixed(1)}x floor`;
    console.log(
      `   +${pad(h, 2)}d  forecast ${pad(value.toFixed(1), 6)}   conf ${pad((confidence * 100).toFixed(0), 3)}%` +
        `   truth ${pad(truth.toFixed(1), 6)}   err ${pad(sign(err, 1), 6)}   ${flag}` +
        (clamped ? `   CAPPED (uncapped ${raw.toFixed(1)})` : ''),
    );
  }
  console.log();

  const h7 = horizons.find((x) => x.h === 7);
  summary.push({
    name: s.name,
    trend: blend.trend,
    trueSlope: s.trueSlope,
    // Direction is only meaningful when the true slope is big enough to have
    // one: a "wrong sign" on a flat truth is noise, so score those on magnitude.
    dir:
      Math.abs(s.trueSlope) < 0.1
        ? Math.abs(blend.trend) <= 0.2
          ? 'flat ok'
          : 'drifting'
        : Math.sign(blend.trend) === Math.sign(s.trueSlope)
          ? 'ok'
          : 'WRONG SIGN',
    maxH: horizons.length ? horizons.at(-1).h : null,
    conf7: h7 ? h7.confidence : null,
    err7: h7 ? h7.value - truthAt(lastDay + 7) : null,
    floor,
  });
}

console.log('─'.repeat(92));
console.log('SUMMARY   (err@7d inside the noise floor is indistinguishable from correct)\n');
console.log(
  `${'scenario'.padEnd(26)}${'blend'.padStart(8)}${'true'.padStart(8)}` +
    `${'direction'.padStart(12)}${'max h'.padStart(7)}${'conf@7d'.padStart(9)}${'err@7d'.padStart(9)}`,
);
for (const s of summary) {
  const err =
    s.err7 === null ? '—' : `${sign(s.err7, 1)}${Math.abs(s.err7) <= s.floor ? '' : ' !'}`;
  console.log(
    s.name.padEnd(26) +
      pad(sign(s.trend), 8) +
      pad(sign(s.trueSlope, 2), 8) +
      pad(s.dir, 12) +
      pad(s.maxH === null ? 'none' : `${s.maxH}d`, 7) +
      pad(s.conf7 === null ? '—' : `${(s.conf7 * 100).toFixed(0)}%`, 9) +
      pad(err, 9),
  );
}
console.log('\n"none" under max h = the engine declined to forecast. That is a designed outcome.');
console.log('"!" marks a +7d error larger than the metric\'s own noise floor.');
