#!/usr/bin/env node
/**
 * Diagnostic companion to forecast.mjs: prints the Kalman filter's internal
 * level/trend state at every observation, so you can see it track a reversal
 * (the acne purge trough, in this dataset) without any discrete purge/no-purge
 * decision. forecast.mjs owns the actual bounded, confidence-scored forecast
 * output — this script is for looking under the hood, so it intentionally
 * does NOT show forecasts past what forecast.mjs would show; the reliable
 * horizon column is the model's own math, unclamped, precisely so it can be
 * compared against the product's 14-day ceiling.
 *
 * Entirely local — reads the same cache as summarize.mjs/forecast.mjs, no API
 * calls, no units.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TARGET_FACE_FRACTION } from '../src/face.mjs';
import { computeDeviceOffsets, correctForDevice } from '../src/device-offset.mjs';
import { computeNoiseFloor } from '../src/noise-floor.mjs';
import { groupSessions } from '../src/sessions.mjs';
import {
  runLocalTrendFilter,
  reliableHorizon,
  defaultProcessNoise,
  observationVariance,
} from '../src/kalman.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ANALYSIS = join(ROOT, 'data', 'analysis');

const METRICS = ['acne', 'texture', 'redness', 'age_spot', 'oiliness', 'pore', 'radiance'];
const SESSION_GAP_SECONDS = 300;
const BASELINE_DEVICE = 'iPhone 16e';

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

const dateAt = (originMs, x) => new Date(originMs + x * 86400000).toISOString().slice(0, 10);

// --- acne walkthrough: show the state track through the purge without a
// discrete switch, since that's the case we already have ground truth for. ---
console.log('ACNE — level/trend track through the purge (no purge detection involved)\n');
{
  const valueOf = (r) => correctForDevice(rawVal(r, 'acne'), 'acne', r.device, offsets);
  const points = toSessionPoints(valueOf);
  const originMs = points[0].ms;
  const r = observationVariance(noiseFloor.worst.acne ?? 5);
  const q = defaultProcessNoise(noiseFloor.worst.acne);
  const { states } = runLocalTrendFilter(points, { q, r });

  console.log('date        raw     level   trend/day');
  console.log('-'.repeat(42));
  states.forEach((s, i) => {
    console.log(
      `${dateAt(originMs, s.x)}  ${points[i].y.toFixed(1).padStart(6)}  ${s.level.toFixed(1).padStart(6)}   ` +
      `${(s.trend >= 0 ? '+' : '') + s.trend.toFixed(2)}`,
    );
  });
}

// --- all metrics: final state + the model's own (unclamped) reliable horizon ---
console.log('\n\nALL METRICS — final state\n');
console.log('metric      last   trend/day    model reliable horizon (unclamped, compare to the 14d product cap)');
console.log('-'.repeat(90));

for (const m of METRICS) {
  const valueOf = (r) => correctForDevice(rawVal(r, m), m, r.device, offsets);
  const points = toSessionPoints(valueOf);
  if (points.length < 2) { console.log(`${m.padEnd(12)}not enough data`); continue; }

  const floor = noiseFloor.worst[m] ?? 5;
  const r = observationVariance(floor);
  const q = defaultProcessNoise(floor);
  const { states, final } = runLocalTrendFilter(points, { q, r });
  const last = states.at(-1);
  const horizon = reliableHorizon(final, { q, r, noiseFloor: floor });

  console.log(
    m.padEnd(12) +
    last.level.toFixed(1).padStart(6) + '   ' +
    ((last.trend >= 0 ? '+' : '') + last.trend.toFixed(3)).padStart(8) + '     ' +
    horizon.toFixed(0) + 'd',
  );
}

console.log('\nRun scripts/forecast.mjs for the actual bounded, confidence-scored forecast.');
