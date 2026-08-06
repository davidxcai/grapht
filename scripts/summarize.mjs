#!/usr/bin/env node
/**
 * Read the cached analyses and print the series plus a measurement noise floor.
 * Entirely local — no API calls, no units.
 *
 * The noise floor comes from photos taken seconds apart: skin cannot change in
 * that time, so the spread across a burst is pure capture-and-model noise. Any
 * day-to-day movement smaller than that is not a real trend, and the app should
 * refuse to report it as one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TARGET_FACE_FRACTION } from '../src/face.mjs';
import { computeDeviceOffsets, correctForDevice } from '../src/device-offset.mjs';
import { computeNoiseFloor } from '../src/noise-floor.mjs';
import { groupSessions } from '../src/sessions.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ANALYSIS = join(ROOT, 'data', 'analysis');

const METRICS = ['acne', 'texture', 'redness', 'age_spot', 'oiliness', 'pore', 'radiance'];
const SESSION_GAP_SECONDS = 300;
const BASELINE_DEVICE = 'iPhone 16e';

// Only results captured at the current face fraction. Scores from a different
// crop scale are not comparable, so mixing them would fabricate trends.
const TAG = `hd_f${String(TARGET_FACE_FRACTION).replace('.', '')}_`;

const records = readdirSync(ANALYSIS)
  .filter((dir) => dir.startsWith(TAG))
  .map((dir) => join(ANALYSIS, dir, 'normalized.json'))
  .filter((p) => { try { readFileSync(p); return true; } catch { return false; } })
  .map((p) => JSON.parse(readFileSync(p, 'utf8')))
  .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));

const val = (r, m) => r.concerns?.[m]?.raw ?? null;
const fmt = (v, w = 6) => (v === null || v === undefined ? '  -   ' : v.toFixed(1).padStart(w));

console.log(`${records.length} analysed photos.  Scores are raw_score 0-100, HIGHER = HEALTHIER.\n`);

console.log('date        dev  ' + METRICS.map((m) => m.slice(0, 6).padStart(7)).join('') + '   age');
console.log('-'.repeat(12 + 5 + METRICS.length * 7 + 6));

const deviceTag = (d) => (d?.includes('iPad') ? 'PAD' : d?.includes('XS') ? ' XS' : d?.includes('16e') ? '16e' : '  ?');

for (const r of records) {
  const date = r.capturedAt?.slice(0, 10) ?? '?';
  const row = METRICS.map((m) => fmt(val(r, m), 7)).join('');
  console.log(`${date}  ${deviceTag(r.device)} ${row}   ${String(r.skinAge ?? '-').padStart(3)}`);
}

// --- device-corrected series -------------------------------------------------
// Camera hardware changes raw_score directly (docs/measurements.md, Finding 2).
// Offsets are derived from the three near-simultaneous cross-device captures in
// this dataset — see src/device-offset.mjs. Corrected values are what matters
// for any cross-device comparison (trend lines, first-vs-last deltas); the raw
// table above is kept for transparency about what the API actually returned.
const offsets = computeDeviceOffsets(records, { baseline: BASELINE_DEVICE, metrics: METRICS });
const corrected = (r, m) => correctForDevice(val(r, m), m, r.device, offsets);

console.log(`\n\nDEVICE-CORRECTED SERIES (all raw_score normalised to ${BASELINE_DEVICE})`);
console.log('date        dev  ' + METRICS.map((m) => m.slice(0, 6).padStart(7)).join('') + '   age');
console.log('-'.repeat(12 + 5 + METRICS.length * 7 + 6));
for (const r of records) {
  const date = r.capturedAt?.slice(0, 10) ?? '?';
  const row = METRICS.map((m) => fmt(corrected(r, m), 7)).join('');
  console.log(`${date}  ${deviceTag(r.device)} ${row}   ${String(r.skinAge ?? '-').padStart(3)}`);
}

// --- noise floor ------------------------------------------------------------
console.log('\n\nMEASUREMENT NOISE FLOOR');
console.log('Photos seconds apart — all spread here is noise, not biology.');
console.log('Bursts are split by whether lighting was held constant, since that is');
console.log('the variable the capture UI can actually control.\n');

const noiseFloor = computeNoiseFloor(records, METRICS, { gapSeconds: SESSION_GAP_SECONDS });

console.log('session                    n  ' + METRICS.map((m) => m.slice(0, 6).padStart(7)).join(''));
console.log('-'.repeat(31 + METRICS.length * 7));

for (const b of noiseFloor.bursts) {
  const label = `${b.capturedAt.slice(0, 10)} ${deviceTag(b.device)} ISO${b.isoMin}-${b.isoMax}`;
  const cells = METRICS.map((m) => fmt(b.ranges[m], 7));
  console.log(
    `${label.padEnd(27)}${String(b.n).padStart(2)}  ${cells.join('')}${b.lightingVaried ? '  <- lighting varied' : ''}`,
  );
}

console.log('-'.repeat(31 + METRICS.length * 7));
console.log('noise, lighting held'.padEnd(31) + METRICS.map((m) => fmt(noiseFloor.controlled[m], 7)).join(''));
console.log('noise, lighting varied'.padEnd(31) + METRICS.map((m) => fmt(noiseFloor.varied[m], 7)).join(''));

// The controlled figure is the one a standardised capture flow can deliver, so
// it is the threshold the product should hold itself to.
const worst = METRICS.map((m) => noiseFloor.worst[m]);

// --- signal vs noise --------------------------------------------------------
console.log('\n\nSIGNAL vs NOISE (device-corrected)');
console.log('Total change across the whole series, against the worst noise spread.');
console.log('First and last endpoints are on different devices, so this compares');
console.log(`corrected values (normalised to ${BASELINE_DEVICE}) — otherwise the device\n` +
  'offset from Finding 2 would masquerade as biological change.\n');

const first = records[0];
const last = records.at(-1);
console.log(`${first.capturedAt.slice(0, 10)}  ->  ${last.capturedAt.slice(0, 10)}\n`);
console.log('metric       first    last   change   noise   verdict');
console.log('-'.repeat(58));

const groups = groupSessions(records, { gapSeconds: SESSION_GAP_SECONDS });

METRICS.forEach((m, i) => {
  // Compare burst means rather than single frames so the endpoints are not
  // themselves single noisy samples.
  const firstGroup = groups[0].map((r) => corrected(r, m)).filter((v) => v !== null);
  const lastGroup = groups.at(-1).map((r) => corrected(r, m)).filter((v) => v !== null);
  if (!firstGroup.length || !lastGroup.length) return;

  const a = firstGroup.reduce((x, y) => x + y, 0) / firstGroup.length;
  const b = lastGroup.reduce((x, y) => x + y, 0) / lastGroup.length;
  const change = b - a;
  const noise = worst[i];
  const verdict =
    noise === null ? '?' : Math.abs(change) > noise * 1.5 ? 'REAL' : Math.abs(change) > noise ? 'marginal' : 'below noise';

  console.log(
    `${m.padEnd(11)}${fmt(a)} ${fmt(b)}  ${(change >= 0 ? '+' : '') + change.toFixed(1).padStart(6)}  ${fmt(noise)}   ${verdict}`,
  );
});
