#!/usr/bin/env node
/**
 * Derive cross-device score offsets from the reference dataset and write them to
 * data/device-offsets.json for other scripts (regression engine, summarize.mjs)
 * to apply. Entirely local — no API calls, no units.
 *
 * See src/device-offset.mjs for how the offsets are derived.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TARGET_FACE_FRACTION } from '../src/face.mjs';
import { computeDeviceOffsets } from '../src/device-offset.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ANALYSIS = join(ROOT, 'data', 'analysis');
const OUT = join(ROOT, 'data', 'device-offsets.json');

const METRICS = ['acne', 'texture', 'redness', 'age_spot', 'oiliness', 'pore', 'radiance'];
const TAG = `hd_f${String(TARGET_FACE_FRACTION).replace('.', '')}_`;

// Baseline is the most recently and heavily used device: it's what future
// captures will most likely come from, so correcting older devices *to* it
// means new data needs no correction.
const BASELINE = 'iPhone 16e';

const records = readdirSync(ANALYSIS)
  .filter((dir) => dir.startsWith(TAG))
  .map((dir) => join(ANALYSIS, dir, 'normalized.json'))
  .filter((p) => { try { readFileSync(p); return true; } catch { return false; } })
  .map((p) => JSON.parse(readFileSync(p, 'utf8')));

const result = computeDeviceOffsets(records, { baseline: BASELINE, metrics: METRICS });

console.log(`Baseline device: ${BASELINE}\n`);

console.log('CALIBRATION PAIRS (near-simultaneous, different device, gap <= 5 days)');
console.log('date A -> date B                                device A -> device B          gap');
console.log('-'.repeat(100));
for (const p of result.pairs) {
  console.log(
    `${p.dateA.slice(0, 10)} -> ${p.dateB.slice(0, 10)}   ` +
      `${p.deviceA.padEnd(14)} -> ${p.deviceB.padEnd(14)}   ${p.gapDays.toFixed(1)}d`,
  );
  console.log(
    '  ' + METRICS.map((m) => `${m.slice(0, 6)}: ${p.deltas[m] === null ? '-' : (p.deltas[m] >= 0 ? '+' : '') + p.deltas[m].toFixed(1)}`).join('  '),
  );
}

console.log('\nOFFSET TO BASELINE (add this to a device\'s raw_score to convert it to the baseline scale)');
console.log('device                          ' + METRICS.map((m) => m.slice(0, 6).padStart(8)).join(''));
console.log('-'.repeat(32 + METRICS.length * 8));
for (const [device, offsets] of Object.entries(result.offsetToBaseline)) {
  const row = METRICS.map((m) => (offsets[m] === null ? '   -    ' : ((offsets[m] >= 0 ? '+' : '') + offsets[m].toFixed(1)).padStart(8)));
  console.log(`${device.padEnd(32)}${row.join('')}`);
}

writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`\nWrote ${OUT}`);
