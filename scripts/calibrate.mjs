#!/usr/bin/env node
/**
 * SD vs HD calibration on a single image.
 *
 * Answers three things before we commit to a full 20-image pass:
 *   - does the upload -> task -> poll chain actually work end to end?
 *   - what does each mode really cost? (read the console balance before/after)
 *   - do SD and HD disagree enough to justify HD's premium?
 *
 * Every response is written to data/cache/ so nothing is ever re-fetched.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientFromEnv } from '../src/youcam.mjs';
import { toHd } from '../src/concerns.mjs';

process.loadEnvFile();

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, 'data', 'cache');
const IMAGE = process.argv[2] ?? join(ROOT, 'data', 'prepared', 'today_IMG_7340.jpg');

// Six concerns: the ones that matter for an acne trajectory and that are also
// renderable by Simulation. Same set in both modes so the scores are comparable.
const CONCERNS = ['acne', 'texture', 'redness', 'age_spot', 'oiliness', 'pore'];

mkdirSync(CACHE, { recursive: true });
const client = clientFromEnv({ verbose: true });

/** Flatten the response into {concern: {ui, raw}} regardless of nesting depth. */
function extractScores(result) {
  const scores = {};
  const output = result?.results?.output ?? result?.output ?? result?.results ?? result;

  const walk = (node, label) => {
    if (!node || typeof node !== 'object') return;
    if ('ui_score' in node || 'raw_score' in node) {
      scores[label] = { ui: node.ui_score ?? null, raw: node.raw_score ?? null };
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'mask_urls') continue;
      walk(value, label ? `${label}.${key}` : key);
    }
  };

  if (Array.isArray(output)) {
    for (const entry of output) {
      if (entry?.type) scores[entry.type] = { ui: entry.ui_score ?? null, raw: entry.raw_score ?? null };
      else walk(entry, '');
    }
  } else {
    walk(output, '');
  }
  return scores;
}

async function run(label, actions) {
  console.log(`\n=== ${label}: ${actions.join(', ')} ===`);
  const started = Date.now();
  try {
    const result = await client.analyzeImage(IMAGE, actions);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    writeFileSync(join(CACHE, `calibrate_${label}.json`), JSON.stringify(result, null, 2));
    const scores = extractScores(result);
    console.log(`OK in ${elapsed}s, ${Object.keys(scores).length} scores`);
    return scores;
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    if (err.body) console.error(JSON.stringify(err.body, null, 2));
    return null;
  }
}

console.log(`Image: ${IMAGE}`);

const sd = await run('sd', CONCERNS);
const hd = await run('hd', CONCERNS.map(toHd));

if (sd && hd) {
  console.log('\n=== SD vs HD ===');
  const keys = [...new Set([...Object.keys(sd), ...Object.keys(hd).map((k) => k.replace(/^hd_/, ''))])].sort();
  console.log('  concern                    SD ui/raw      HD ui/raw');
  for (const k of keys) {
    const s = sd[k] ?? sd[`hd_${k}`];
    const h = hd[`hd_${k}`] ?? hd[k];
    const fmt = (v) => (v ? `${String(v.ui ?? '-').padStart(3)}/${String(v.raw ?? '-').padStart(3)}` : '   -   ');
    console.log(`  ${k.padEnd(26)} ${fmt(s)}      ${fmt(h)}`);
  }
}

console.log('\nRaw responses cached in data/cache/. Check your console balance now.');
