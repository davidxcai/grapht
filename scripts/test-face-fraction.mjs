#!/usr/bin/env node
/**
 * Find the face fraction the analysis API will actually accept.
 *
 * At 0.45 the API rejects roughly a third of our photos with
 * `error_src_face_too_small`, deterministically but inconsistently across
 * near-identical frames — which suggests 0.45 sits right on its threshold.
 *
 * Rejections are free, so this walks a known-failing image upward and stops at
 * the first fraction that works. Cost: 16 units, once, on the first success.
 *
 *   node scripts/test-face-fraction.mjs IMG_7341 0.55 0.65 0.75
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { normalizeFace } from '../src/face.mjs';
import { clientFromEnv } from '../src/youcam.mjs';
import { toHd } from '../src/concerns.mjs';

process.loadEnvFile();

const ROOT = new URL('..', import.meta.url).pathname;
const [id, ...fractionArgs] = process.argv.slice(2);
const fractions = (fractionArgs.length ? fractionArgs : ['0.55', '0.65', '0.75']).map(Number);

const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'manifest.json'), 'utf8'));
const photo = manifest.photos.find((p) => p.id === id);
if (!photo) throw new Error(`no photo ${id} in manifest`);

const scratch = mkdtempSync(join(tmpdir(), 'facefrac-'));
const client = clientFromEnv();
const actions = ['acne', 'texture', 'redness', 'age_spot', 'oiliness', 'pore', 'radiance'].map(toHd);
const source = join(ROOT, 'data', 'prepared', photo.preparedFile);

console.log(`Testing ${id} (currently ${photo.faceFraction}, rejected by API)\n`);

for (const fraction of fractions) {
  const out = join(scratch, `${id}_${fraction}.jpg`);
  const result = await normalizeFace(source, out, { targetFraction: fraction });
  if (!result.ok) {
    console.log(`  ${fraction}  -> local crop failed: ${result.reason}`);
    continue;
  }

  const actual = result.faceFraction.toFixed(3);
  try {
    await client.analyzeImage(out, actions);
    console.log(`  ${fraction}  (actual ${actual}, face ${result.faceHeightOut}px)  -> ACCEPTED  [16 units]`);
    console.log(`\nUse targetFraction >= ${fraction}.`);
    break;
  } catch (err) {
    const tooSmall = /too_small/.test(err.message);
    console.log(`  ${fraction}  (actual ${actual}, face ${result.faceHeightOut}px)  -> ${tooSmall ? 'rejected, still too small [free]' : err.message.slice(0, 70)}`);
  }
}
