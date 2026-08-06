#!/usr/bin/env node
/**
 * Narrow the skin-simulation intensity contract. Still 0 units — every request
 * here fails before a task completes.
 *
 * From the first probe we know intensities are top-level per-concern keys and
 * that 50 is "above the allowed maximum", so the scale is small. Two questions
 * matter for the product:
 *   1. what is the valid range?
 *   2. are negative values accepted? (the warning/abandonment trajectory needs
 *      the renderer to make skin look worse, not just better)
 */

import { clientFromEnv } from '../src/youcam.mjs';

process.loadEnvFile();
const client = clientFromEnv();
await client.authenticate();

const FILE = 'probe-invalid-file-id';

/** Classify a probe response so we can tell "value rejected" from "value fine, file bad". */
function classify(body) {
  const err = String(body?.error ?? '');
  if (/above the allowed maximum/.test(err)) return 'TOO HIGH';
  if (/below the allowed minimum/.test(err)) return 'TOO LOW';
  if (/cannot be all zero/.test(err)) return 'ALL ZERO';
  if (/not a valid|invalid.*type|must be/i.test(err)) return 'BAD TYPE';
  if (/file/i.test(err)) return 'VALUE OK (file rejected)';
  return `? ${err.slice(0, 70)}`;
}

async function probe(params) {
  try {
    const res = await client.probeTask('skin-simulation', { src_file_id: FILE, ...params });
    return classify(res.body);
  } catch (err) {
    return classify(err.body ?? { error: err.message });
  }
}

console.log('=== intensity range for "acne" ===');
for (const v of [-1, -0.5, -0.01, 0, 0.01, 0.1, 0.5, 0.99, 1, 1.01, 2, 5, 10, 20, 100]) {
  console.log(`  acne=${String(v).padStart(6)}  ->  ${await probe({ acne: v })}`);
}

console.log('\n=== which concerns are accepted? ===');
const candidates = [
  'acne', 'oiliness', 'radiance', 'redness', 'texture', 'pore', 'wrinkle',
  'spot', 'age_spot', 'dark_circle', 'dark_circle_v2', 'eye_bag', 'moisture',
  'firmness', 'droopy_upper_eyelid', 'droopy_lower_eyelid',
];
for (const name of candidates) {
  console.log(`  ${name.padEnd(22)} ->  ${await probe({ [name]: 0.5 })}`);
}

console.log('\nDone. 0 units consumed.');
