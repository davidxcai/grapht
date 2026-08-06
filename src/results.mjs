/**
 * Skin-analysis result handling.
 *
 * Results do not come back inline. The task returns a presigned ZIP url that
 * expires in ~2 hours, containing score_info.json, one mask PNG per concern, and
 * resize_image.jpg (the model's own normalised input, capped at 1920x2560).
 * Everything is unpacked to disk immediately — re-fetching after expiry means
 * paying for the analysis again.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
 */
export function normalizeScores(scoreInfo) {
  const concerns = {};
  const zones = {};

  for (const [key, value] of Object.entries(scoreInfo)) {
    if (key === 'all' || key === 'skin_age' || key === 'resize_image') continue;
    if (!value || typeof value !== 'object') continue;

    const name = key.replace(/^hd_/, '');

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

/** Download the result zip and unpack it. Returns the extraction directory. */
export async function downloadResult(url, destDir) {
  mkdirSync(destDir, { recursive: true });
  const zipPath = join(destDir, 'result.zip');

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`result download failed: ${res.status} (presigned urls expire ~2h)`);
  }
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir]);
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
