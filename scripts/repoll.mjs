#!/usr/bin/env node
/**
 * Re-poll a task by id. Polling is free, so when a task times out locally this
 * recovers the result rather than paying to run it again — the task keeps going
 * server-side and we were charged for it either way.
 *
 *   node scripts/repoll.mjs <task_id> <photo_id>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { clientFromEnv } from '../src/youcam.mjs';
import { TARGET_FACE_FRACTION } from '../src/face.mjs';
import { downloadResult, normalizeScores, readScoreInfo } from '../src/results.mjs';

process.loadEnvFile();
const ROOT = new URL('..', import.meta.url).pathname;
const [taskId, photoId] = process.argv.slice(2);

const client = clientFromEnv();
const result = await client.pollTask('skin-analysis', taskId, { timeoutMs: 120000 });
const url = result?.results?.url ?? result?.url;
if (!url) throw new Error(`no result url: ${JSON.stringify(result).slice(0, 300)}`);

const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'manifest.json'), 'utf8'));
const photo = manifest.photos.find((p) => p.id === photoId);
const tag = `f${String(TARGET_FACE_FRACTION).replace('.', '')}`;
const dir = join(ROOT, 'data', 'analysis', `hd_${tag}_${photoId}`);
mkdirSync(dir, { recursive: true });

await downloadResult(url, dir);
const normalized = normalizeScores(readScoreInfo(dir));
writeFileSync(join(dir, 'normalized.json'), JSON.stringify({
  id: photoId, set: photo.set, capturedAt: photo.capturedAt, device: photo.device,
  iso: photo.iso, mode: 'hd', recovered: true, ...normalized,
}, null, 2));

console.log(`recovered ${photoId}: acne ${normalized.concerns.acne?.raw?.toFixed(1)}  skin_age ${normalized.skinAge}`);
