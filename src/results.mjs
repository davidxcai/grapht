/**
 * Skin-analysis result handling.
 *
 * Results do not come back inline. The task returns a presigned ZIP url that
 * expires in ~2 hours, containing score_info.json, one mask PNG per concern, and
 * resize_image.jpg (the model's own normalised input, capped at 1920x2560).
 * Everything is unpacked to disk immediately — re-fetching after expiry means
 * paying for the analysis again.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/**
 * Normalise score_info.json into a flat {concern: {raw, ui}} map.
 *
 * Two shapes appear inconsistently within a single HD response:
 *   hd_redness: { raw_score, ui_score }                    <- flat
 *   hd_acne:    { whole: { raw_score, ui_score } }         <- nested
 *   hd_pore:    { forehead: {...}, nose: {...}, whole: {} } <- nested, multi-zone
 *
 * `whole` is the headline figure; other zones are kept separately so regional
 * trends stay available without complicating the main series.
 *
 * One name is asymmetric between request and response: the `dst_actions`
 * request must say `hd_dark_circle` (see `toRequestAction` in
 * `src/concerns.mjs` — `hd_dark_circle_v2` is rejected outright), but it is
 * unconfirmed whether the response echoes that same shortened name or the
 * documented `dark_circle_v2`. Remap defensively so either lands on the
 * canonical analysis key.
 */
export function normalizeScores(scoreInfo) {
  const concerns = {};
  const zones = {};

  for (const [key, value] of Object.entries(scoreInfo)) {
    if (key === 'all' || key === 'skin_age' || key === 'resize_image') continue;
    if (!value || typeof value !== 'object') continue;

    const stripped = key.replace(/^hd_/, '');
    const name = stripped === 'dark_circle' ? 'dark_circle_v2' : stripped;

    if ('raw_score' in value) {
      concerns[name] = { raw: value.raw_score, ui: value.ui_score ?? null };
      continue;
    }

    // Nested: pull `whole` up as the headline, keep the rest as zones.
    const sub = Object.entries(value).filter(([, v]) => v && typeof v === 'object' && 'raw_score' in v);
    if (sub.length === 0) continue;

    const whole = value.whole ?? value.all;
    if (whole) concerns[name] = { raw: whole.raw_score, ui: whole.ui_score ?? null };

    for (const [zoneName, zoneValue] of sub) {
      if (zoneName === 'whole' || zoneName === 'all') continue;
      zones[name] ??= {};
      zones[name][zoneName] = { raw: zoneValue.raw_score, ui: zoneValue.ui_score ?? null };
    }

    // Some concerns may have zones but no `whole` — fall back to the zone mean so
    // the metric still appears in the main series rather than vanishing.
    if (!concerns[name] && zones[name]) {
      const vals = Object.values(zones[name]);
      concerns[name] = {
        raw: vals.reduce((a, z) => a + z.raw, 0) / vals.length,
        ui: null,
        derived: 'zone-mean',
      };
    }
  }

  return {
    concerns,
    zones,
    skinAge: scoreInfo.skin_age ?? null,
    allScore: scoreInfo.all?.score ?? null,
  };
}

/**
 * Extract a ZIP archive's entries into `destDir`, without shelling out to the
 * system `unzip` binary — Vercel's function runtime doesn't have one, which
 * turned every live capture into `spawnSync unzip ENOENT`. Method 8 (deflate)
 * and 0 (stored) cover everything YouCam's result archives use.
 */
function extractZip(zipPath, destDir) {
  const buf = readFileSync(zipPath);

  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.subarray(i, i + 4).equals(eocdSig)) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error(`${zipPath} is not a valid zip (no end-of-central-directory)`);

  const totalEntries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`${zipPath} has a malformed central directory entry`);
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (!name.endsWith('/')) {
      const localNameLength = buf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buf.subarray(dataStart, dataStart + compressedSize);
      const data = method === 0 ? compressed : inflateRawSync(compressed);

      const outPath = join(destDir, name);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, data);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }
}

/** Download the result zip and unpack it. Returns the extraction directory. */
export async function downloadResult(url, destDir) {
  mkdirSync(destDir, { recursive: true });
  const zipPath = join(destDir, 'result.zip');

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`result download failed: ${res.status} (presigned urls expire ~2h)`);
  }
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  extractZip(zipPath, destDir);
  return destDir;
}

/** Locate and parse score_info.json inside an extracted result directory. */
export function readScoreInfo(destDir) {
  for (const candidate of [
    join(destDir, 'skinanalysisResult', 'score_info.json'),
    join(destDir, 'score_info.json'),
  ]) {
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
  }
  throw new Error(`no score_info.json under ${destDir}`);
}
