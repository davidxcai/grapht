#!/usr/bin/env node
/**
 * Analyse every prepared photo once, in HD, and cache the results permanently.
 *
 * At 16 units per HD call this is the single largest spend in the project, so:
 *   - anything already cached is skipped, always
 *   - results are unpacked to disk the moment they arrive (urls expire in ~2h)
 *   - --limit lets you spend a few units and check the balance before committing
 *
 * Usage:
 *   node scripts/analyze-all.mjs --limit 1     # one image, verify cost
 *   node scripts/analyze-all.mjs               # the rest
 *   node scripts/analyze-all.mjs --dry-run     # show the plan, spend nothing
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientFromEnv } from '../src/youcam.mjs';
import { toHd } from '../src/concerns.mjs';
import { TARGET_FACE_FRACTION } from '../src/face.mjs';
import { downloadResult, normalizeScores, readScoreInfo } from '../src/results.mjs';

process.loadEnvFile();

const ROOT = new URL('..', import.meta.url).pathname;
// Face-normalised crops, not the raw prepared images: the API rejects photos
// where the face is small relative to the frame, and consistent face scale is
// required for texture/pore scores to be comparable across devices.
const NORMALIZED = join(ROOT, 'data', 'normalized');
const ANALYSIS = join(ROOT, 'data', 'analysis');
const MANIFEST = join(ROOT, 'data', 'manifest.json');

// Seven concerns. Six are the acne-trajectory core; radiance rides along because
// SD's pricing tier runs 5-7 concerns, so the seventh is very likely free.
const CONCERNS = ['acne', 'texture', 'redness', 'age_spot', 'oiliness', 'pore', 'radiance'];
const MODE = 'hd';
const UNITS_PER_CALL = 16;

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const dryRun = args.includes('--dry-run');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
mkdirSync(ANALYSIS, { recursive: true });

// Face scale is part of the measurement, so it belongs in the cache key: a crop
// change must invalidate old results rather than silently mixing scales.
const FRACTION_TAG = `f${String(TARGET_FACE_FRACTION).replace('.', '')}`;
const cacheDirFor = (id) => join(ANALYSIS, `${MODE}_${FRACTION_TAG}_${id}`);
const isCached = (id) => existsSync(join(cacheDirFor(id), 'normalized.json'));

const pending = manifest.photos.filter((p) => !isCached(p.id));
const cached = manifest.photos.length - pending.length;

console.log(`${manifest.photos.length} photos | ${cached} cached | ${pending.length} to analyse`);
console.log(`Mode: ${MODE.toUpperCase()}, concerns: ${CONCERNS.join(', ')}`);

const todo = pending.slice(0, limit);
console.log(`Running ${todo.length} now -> ~${todo.length * UNITS_PER_CALL} units\n`);

if (dryRun) {
  for (const p of todo) console.log(`  would analyse ${p.id}  (${p.capturedAt?.slice(0, 10)})`);
  process.exit(0);
}

const client = clientFromEnv();
const actions = CONCERNS.map(toHd);
let spent = 0;
let failed = 0;

for (const photo of todo) {
  const imagePath = join(NORMALIZED, photo.normalizedFile ?? photo.preparedFile);
  const dir = cacheDirFor(photo.id);
  process.stdout.write(`  ${photo.id} (${photo.capturedAt?.slice(0, 10)}) ... `);

  try {
    const result = await client.analyzeImage(imagePath, actions);
    const url = result?.results?.url ?? result?.url;
    if (!url) throw new Error(`no result url: ${JSON.stringify(result).slice(0, 200)}`);

    await downloadResult(url, dir);
    const normalized = normalizeScores(readScoreInfo(dir));

    writeFileSync(
      join(dir, 'normalized.json'),
      JSON.stringify(
        {
          id: photo.id,
          set: photo.set,
          capturedAt: photo.capturedAt,
          device: photo.device,
          iso: photo.iso,
          mode: MODE,
          concerns: CONCERNS,
          ...normalized,
        },
        null,
        2,
      ),
    );

    spent += UNITS_PER_CALL;
    const acne = normalized.concerns.acne?.raw?.toFixed(1) ?? '-';
    console.log(`ok  acne ${acne}  skin_age ${normalized.skinAge}`);
  } catch (err) {
    failed++;
    console.log(`FAILED: ${err.message}`);
  }
}

console.log(`\nDone. ~${spent} units spent, ${failed} failed.`);
console.log(`${manifest.photos.filter((p) => isCached(p.id)).length}/${manifest.photos.length} now cached.`);
