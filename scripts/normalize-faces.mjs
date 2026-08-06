#!/usr/bin/env node
/**
 * Crop every prepared photo so the face sits at a consistent scale and position.
 * Local only — no API calls, no units.
 *
 * Writes data/normalized/ and records the crop geometry back into the manifest so
 * later stages can tell which photos were normalised cleanly and which hit an
 * image edge.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeFace, TARGET_FACE_FRACTION } from '../src/face.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const PREPARED = join(ROOT, 'data', 'prepared');
const OUT = join(ROOT, 'data', 'normalized');
const MANIFEST = join(ROOT, 'data', 'manifest.json');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
mkdirSync(OUT, { recursive: true });

console.log(`Normalising ${manifest.photos.length} photos (target face fraction ${TARGET_FACE_FRACTION})\n`);

let failures = 0;
const clamped = [];

for (const photo of manifest.photos) {
  const outName = photo.preparedFile;
  const result = await normalizeFace(join(PREPARED, photo.preparedFile), join(OUT, outName));

  if (!result.ok) {
    failures++;
    console.log(`  ${photo.id.padEnd(10)} FAILED: ${result.reason}`);
    photo.normalized = null;
    continue;
  }

  photo.normalizedFile = outName;
  photo.faceBox = result.box;
  photo.faceFraction = Number(result.faceFraction.toFixed(4));
  photo.faceHeightOut = result.faceHeightOut;

  // A face fraction well below target means the crop hit an image edge and the
  // photo could not be scaled up to match the others.
  const off = Math.abs(result.faceFraction - TARGET_FACE_FRACTION);
  if (off > 0.05) clamped.push(photo);

  console.log(
    `  ${photo.id.padEnd(10)} face ${String(result.faceHeightOut).padStart(4)}px  ` +
    `fraction ${result.faceFraction.toFixed(3)}${off > 0.05 ? '  <- clamped' : ''}`,
  );
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

console.log(`\n${manifest.photos.length - failures}/${manifest.photos.length} normalised -> data/normalized/`);
if (clamped.length) {
  console.log(`${clamped.length} could not reach the target face size (not enough margin around the face):`);
  for (const p of clamped) console.log(`  ${p.id}  ${p.device}  fraction ${p.faceFraction}`);
}
