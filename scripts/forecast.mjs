#!/usr/bin/env node
/**
 * The bounded, confidence-scored forecast. Entirely local — reads the same
 * cache as summarize.mjs, no API calls, no units.
 *
 * Built on the local-linear-trend Kalman filter (src/kalman.mjs) rather than
 * a fixed-window OLS fit: it tracks a continuously-updated level+trend belief
 * per metric, so a reversal (a purge trough, a flare-up) just moves the state
 * instead of needing a discrete purge/no-purge decision, and its forecast
 * uncertainty grows naturally with horizon.
 *
 * Two hard limits, both product decisions rather than pure statistics:
 *
 *   1. Never forecast past 14 days. Even if the math looked confident further
 *      out, a window that long stops being attributable to "the routine" —
 *      diet, stress, weather, and product changes have room to intervene.
 *   2. Never show a horizon where confidence has dropped below 50%. Below
 *      that, the forecast is a coin toss, which is not a forecast.
 *
 * Confidence at each horizon is P(|forecast error| <= noise floor) — the
 * probability the true value lands close enough to the point forecast that
 * you couldn't tell them apart from measurement noise anyway. See
 * predictionConfidence() in src/kalman.mjs.
 *
 * The trend itself is the KF+OLS inverse-variance blend (blendTrend() in
 * src/kalman.mjs), not the raw Kalman trend: the filter alone over-reacts to
 * the most recent step on a noisy-but-flat series, and OLS's slope variance
 * — tight whenever the series really is flat — pulls that back automatically
 * whenever there are enough points to trust it (see docs/forecast-design.md).
 * Known limitation: that OLS fit covers the whole history, which reads ~zero
 * slope through a purge trough and cancels the reversal the filter got right.
 * A recent-window fit was measured to fix it, and deferred — it needs the
 * capture-quality gate first (docs/capture-quality.md), because a shorter
 * window also amplifies one bad photo. Do not re-derive this; see
 * docs/forecast-design.md, "Recent-window OLS (measured, deferred)".
 *
 * Forecast values are clamped to the 0-100 analysis scale. Observations are
 * not — device correction is allowed to land outside it (CLAUDE.md rule 6).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TARGET_FACE_FRACTION } from '../src/face.mjs';
import { computeDeviceOffsets, correctForDevice } from '../src/device-offset.mjs';
import { computeNoiseFloor } from '../src/noise-floor.mjs';
import { groupSessions } from '../src/sessions.mjs';
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

const ROOT = new URL('..', import.meta.url).pathname;
const ANALYSIS = join(ROOT, 'data', 'analysis');

const METRICS = ['acne', 'texture', 'redness', 'age_spot', 'oiliness', 'pore', 'radiance'];
const SESSION_GAP_SECONDS = 300;
const BASELINE_DEVICE = 'iPhone 16e';

const MAX_HORIZON_DAYS = 14;
const HORIZONS = [1, 2, 3, 5, 7, 10, 14];
const MIN_CONFIDENCE = 0.5;

const TAG = `hd_f${String(TARGET_FACE_FRACTION).replace('.', '')}_`;

const records = readdirSync(ANALYSIS)
  .filter((dir) => dir.startsWith(TAG))
  .map((dir) => join(ANALYSIS, dir, 'normalized.json'))
  .filter((p) => { try { readFileSync(p); return true; } catch { return false; } })
  .map((p) => JSON.parse(readFileSync(p, 'utf8')))
  .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));

const rawVal = (r, m) => r.concerns?.[m]?.raw ?? null;

const offsets = computeDeviceOffsets(records, { baseline: BASELINE_DEVICE, metrics: METRICS });
const noiseFloor = computeNoiseFloor(records, METRICS, { gapSeconds: SESSION_GAP_SECONDS });
const sessions = groupSessions(records, { gapSeconds: SESSION_GAP_SECONDS });

function toSessionPoints(valueOf) {
  const points = [];
  for (const session of sessions) {
    const vals = session.map(valueOf).filter((v) => v !== null && v !== undefined);
    if (!vals.length) continue;
    const y = vals.reduce((a, b) => a + b, 0) / vals.length;
    const ms = session.map((r) => Date.parse(r.capturedAt)).reduce((a, b) => a + b, 0) / session.length;
    points.push({ ms, y });
  }
  points.sort((a, b) => a.ms - b.ms);
  if (!points.length) return points;
  const originMs = points[0].ms;
  return points.map((p) => ({ ...p, x: (p.ms - originMs) / 86400000 }));
}

console.log(`${records.length} analysed photos, ${sessions.length} capture sessions.`);
console.log(`Forecast on device-corrected raw_score (normalised to ${BASELINE_DEVICE}), higher = healthier.`);
console.log(`Capped at ${MAX_HORIZON_DAYS} days — beyond that, "your routine" stops being the only thing that`);
console.log(`could explain a change. Cut off wherever confidence drops below ${(MIN_CONFIDENCE * 100).toFixed(0)}%.\n`);

for (const m of METRICS) {
  const valueOf = (r) => correctForDevice(rawVal(r, m), m, r.device, offsets);
  const points = toSessionPoints(valueOf);

  console.log(`${m.toUpperCase()}`);

  if (points.length < 2) {
    console.log('  not enough data\n');
    continue;
  }

  const floor = noiseFloor.worst[m] ?? 5;
  const r = observationVariance(floor);
  const q = defaultProcessNoise(floor);
  const { states, final } = runLocalTrendFilter(points, { q, r });
  const last = states.at(-1);
  const originMs = points[0].ms - points[0].x * 86400000;
  const lastDate = new Date(points.at(-1).ms).toISOString().slice(0, 10);

  const ols = fitLinear(points);
  const blend = blendTrend({ trend: last.trend, trendVar: last.trendVar }, ols);
  const blendedFinal = applyBlendedTrend(final, blend);

  const blendNote = blend.blended ? `blended with OLS (n=${ols.n})` : `KF-only, n=${ols.n} < 5`;
  console.log(
    `  last: ${last.level.toFixed(1)} on ${lastDate}   trend: ${(blend.trend >= 0 ? '+' : '') + blend.trend.toFixed(3)}/day (${blendNote})   noise floor: ${floor.toFixed(1)}`,
  );

  let shown = 0;
  for (const h of HORIZONS) {
    if (h > MAX_HORIZON_DAYS) break;
    const fc = kalmanForecast(blendedFinal, h, { q, r, bounds: { min: SCORE_MIN, max: SCORE_MAX } });
    const confidence = predictionConfidence(fc.sd, floor);
    if (confidence < MIN_CONFIDENCE) break;

    const date = new Date(originMs + (last.x + h) * 86400000).toISOString().slice(0, 10);
    const capped = fc.clamped ? `  (at scale ${fc.raw > SCORE_MAX ? 'max' : 'min'}, uncapped ${fc.raw.toFixed(1)})` : '';
    console.log(
      `    +${String(h).padStart(2)}d  ${date}  ${fc.value.toFixed(1).padStart(6)}   confidence ${(confidence * 100).toFixed(0)}%${capped}`,
    );
    shown++;
  }

  if (shown === 0) {
    console.log('    no horizon clears 50% confidence — trend is too noisy to project, even one day out');
  }
  console.log();
}
