#!/usr/bin/env node
// Builds fixtures/trials.json from data/manifest.json + data/analysis/.
//
// data/ is gitignored (it holds faces); fixtures/ is committed. The fixture
// carries the *scores* as well as the timestamps — a {raw, ui} map publishes
// nothing about a face, and without it the detail page has no numbers to
// render on a clone with no data/ directory. Photos are referenced by a
// public path that is itself gitignored; a clone without them falls back to
// no image.
//
// The two hardcoded reference trials ("Acne medication" / accutane-2024 and
// "Did it hold?" / did-it-hold-2026) that used to live here were removed
// 2026-08-08 at the owner's request — they were showing up on the public
// home page and the owner wanted them gone rather than merely hidden. This
// script now writes an empty fixture. If a pre-seeded demo trial is wanted
// again, define it in the `trials` array below and re-run.
//
// Run: node scripts/seed-trials.mjs

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const trials = [];

mkdirSync(resolve(root, 'fixtures'), { recursive: true });
writeFileSync(resolve(root, 'fixtures/trials.json'), JSON.stringify(trials, null, 2) + '\n');

// The device offset table still travels with the fixture — it is a general
// per-metric correction table (rule 6), not specific to any one trial — so it
// is copied out of gitignored data/ whenever that's present.
const offsetsPath = resolve(root, 'data/device-offsets.json');
if (existsSync(offsetsPath)) {
  const offsets = JSON.parse(readFileSync(offsetsPath, 'utf8'));
  writeFileSync(
    resolve(root, 'fixtures/device-offsets.json'),
    JSON.stringify({ baseline: offsets.baseline, offsetToBaseline: offsets.offsetToBaseline }, null, 2) + '\n',
  );
}

console.log(`wrote fixtures/trials.json (${trials.length} trials)`);
