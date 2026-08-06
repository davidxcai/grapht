#!/usr/bin/env node
/**
 * Local preprocessing pass. No API calls, no units spent.
 *
 * Reads sample-photos/ (historical series) and sample-photos/today/ (same-session
 * noise-floor set), then:
 *   1. reads capture metadata via mdls (Spotlight), which survives Photos exports
 *   2. converts HEIC -> JPEG and everything to sRGB via sips
 *   3. writes data/manifest.json sorted by capture time
 *
 * The sRGB conversion matters: every source file is DisplayP3. Feeding P3 pixel
 * values to an API that assumes sRGB inflates saturation, and redness is the
 * metric we care most about.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC_HISTORICAL = join(ROOT, 'sample-photos');
const SRC_TODAY = join(SRC_HISTORICAL, 'today');
const OUT_DIR = join(ROOT, 'data', 'prepared');
const MANIFEST = join(ROOT, 'data', 'manifest.json');
const SRGB = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';
const JPEG_QUALITY = 95;

const MDLS_FIELDS = [
  'kMDItemContentCreationDate',
  'kMDItemAcquisitionModel',
  'kMDItemISOSpeed',
  'kMDItemExposureTimeSeconds',
  'kMDItemFNumber',
  'kMDItemFocalLength',
  'kMDItemPixelWidth',
  'kMDItemPixelHeight',
];

function readMetadata(file) {
  const args = MDLS_FIELDS.flatMap((f) => ['-name', f]).concat(file);
  const out = execFileSync('mdls', args, { encoding: 'utf8' });
  const meta = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^(\w+)\s+=\s+(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = rawValue.trim().replace(/^"|"$/g, '');
    meta[key] = value === '(null)' ? null : value;
  }
  return {
    capturedAt: meta.kMDItemContentCreationDate ?? null,
    device: meta.kMDItemAcquisitionModel ?? null,
    iso: meta.kMDItemISOSpeed ? Number(meta.kMDItemISOSpeed) : null,
    exposureSeconds: meta.kMDItemExposureTimeSeconds
      ? Number(meta.kMDItemExposureTimeSeconds)
      : null,
    fNumber: meta.kMDItemFNumber ? Number(meta.kMDItemFNumber) : null,
    focalLength: meta.kMDItemFocalLength ? Number(meta.kMDItemFocalLength) : null,
    sourceWidth: meta.kMDItemPixelWidth ? Number(meta.kMDItemPixelWidth) : null,
    sourceHeight: meta.kMDItemPixelHeight ? Number(meta.kMDItemPixelHeight) : null,
  };
}

/**
 * Two-stage conversion.
 *
 * sips decodes HEIC (sharp's prebuilt binaries ship without libheif) and does the
 * DisplayP3 -> sRGB transform. sharp then applies the EXIF orientation to the pixel
 * buffer itself and strips the tag.
 *
 * That rotation step is not cosmetic: every source file is flagged portrait but
 * stored as a landscape buffer. Anything downstream that ignores the EXIF tag sees
 * a sideways face and fails to detect it.
 */
async function convert(src, dest, scratch) {
  const decoded = join(scratch, `${basename(src, extname(src))}.jpg`);
  execFileSync('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', 'best',
    '--matchTo', SRGB,
    '--out', decoded,
    src,
  ], { stdio: 'pipe' });

  // .rotate() with no argument means "apply whatever EXIF orientation says".
  const { width, height } = await sharp(decoded)
    .rotate()
    .jpeg({ quality: JPEG_QUALITY })
    .toFile(dest);

  return { width, height, bytes: statSync(dest).size };
}

function collect(dir, set) {
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => /\.(jpe?g|heic|png)$/i.test(f))
    .map((f) => ({ set, path: join(dir, f) }));
}

const inputs = [...collect(SRC_HISTORICAL, 'historical'), ...collect(SRC_TODAY, 'today')];

if (inputs.length === 0) {
  console.error(`No images found under ${SRC_HISTORICAL}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'grapht-'));

const records = [];
try {
  for (const { set, path } of inputs) {
    const meta = readMetadata(path);
    const id = basename(path, extname(path));
    const destName = `${set}_${id}.jpg`;
    const dest = join(OUT_DIR, destName);
    const { width, height, bytes } = await convert(path, dest, scratch);

    records.push({
      id,
      set,
      sourceFile: basename(path),
      preparedFile: destName,
      ...meta,
      preparedWidth: width,
      preparedHeight: height,
      preparedBytes: bytes,
      // True once the buffer is upright, regardless of what EXIF claimed.
      portrait: height > width,
    });
    process.stdout.write('.');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.stdout.write('\n');

records.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));

writeFileSync(
  MANIFEST,
  JSON.stringify({ generatedAt: new Date().toISOString(), photos: records }, null, 2),
);

// --- Summary ---------------------------------------------------------------
const byDevice = new Map();
for (const r of records) byDevice.set(r.device, (byDevice.get(r.device) ?? 0) + 1);

console.log(`\nPrepared ${records.length} images -> data/prepared/`);
console.log(`Manifest -> data/manifest.json\n`);

console.log('Devices:');
for (const [device, count] of byDevice) console.log(`  ${count}x  ${device}`);

console.log('\nTimeline:');
let prevDate = null;
for (const r of records) {
  const date = (r.capturedAt ?? 'unknown').slice(0, 19);
  const dims = `${r.preparedWidth}x${r.preparedHeight}`.padEnd(10);
  const mb = `${(r.preparedBytes / 1e6).toFixed(1)}MB`.padStart(7);
  const t = Date.parse(r.capturedAt);
  const gap = prevDate ? `+${Math.round((t - prevDate) / 86400000)}d` : '';
  prevDate = t;
  console.log(
    `  ${date}  ${dims}${mb}  ${String(gap).padStart(6)}  ${r.set.padEnd(10)} ${r.device}`,
  );
}

const sideways = records.filter((r) => !r.portrait);
if (sideways.length > 0) {
  console.log(`\nWARNING: ${sideways.length} image(s) still landscape after auto-orient:`);
  for (const r of sideways) console.log(`  ${r.preparedFile}`);
}

// Same-session pairs are free measurement-noise samples: skin cannot change in
// under a few minutes, so any metric spread across them is pure capture noise.
const SESSION_GAP_SECONDS = 300;
const pairs = [];
for (let i = 1; i < records.length; i++) {
  const prev = records[i - 1];
  const curr = records[i];
  if (prev.set !== curr.set || prev.device !== curr.device) continue;
  const gap = (Date.parse(curr.capturedAt) - Date.parse(prev.capturedAt)) / 1000;
  if (Number.isFinite(gap) && gap <= SESSION_GAP_SECONDS) {
    pairs.push({ a: prev.id, b: curr.id, gapSeconds: gap, device: curr.device });
  }
}

console.log('\nSame-session groups usable as a noise floor:');
if (pairs.length === 0) {
  console.log('  none found');
} else {
  for (const p of pairs) {
    console.log(`  ${p.a} <-> ${p.b}  ${p.gapSeconds}s apart  (${p.device})`);
  }
}
