#!/usr/bin/env node
// Builds fixtures/trials.json from data/manifest.json + data/analysis/.
//
// data/ is gitignored (it holds faces); fixtures/ is committed. The fixture now
// carries the *scores* as well as the timestamps — a {raw, ui} map publishes
// nothing about a face, and without it the detail page has no numbers to render
// on a clone with no data/ directory. Photos are referenced by a public path
// that is itself gitignored; a clone without them falls back to no image.
//
// This is the pre-seeded dataset BRIEF.md requires: the app runs with no API
// key, no network, and no database.
//
// Run: node scripts/seed-trials.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANALYSIS_CONCERNS } from '../src/concerns.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'data/manifest.json'), 'utf8'));

const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ scores */

function analysisFor(id) {
  const path = resolve(root, `data/analysis/hd_f055_${id}/normalized.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

/**
 * The measured raw→ui curve, recovered from every cached pair.
 *
 * `ui` is Perfect Corp's consumer-facing compression and it is markedly
 * non-linear — d(ui)/d(raw) runs ~0.39 mid-range and ~1.26 above raw 85, so the
 * same real change displays up to 3× differently depending on where the score
 * sits. Nothing in the app computes a *change* from it (CLAUDE.md rule 2); it is
 * carried only so a synthesised concern is shaped like a measured one.
 */
function buildUiCurve() {
  const pairs = [];
  for (const photo of manifest.photos) {
    const a = analysisFor(photo.id);
    if (!a) continue;
    for (const v of Object.values(a.concerns)) {
      if (v.ui !== null && v.ui !== undefined) pairs.push([v.raw, v.ui]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return (raw) => {
    if (!pairs.length) return null;
    if (raw <= pairs[0][0]) return pairs[0][1];
    if (raw >= pairs[pairs.length - 1][0]) return pairs[pairs.length - 1][1];
    for (let i = 1; i < pairs.length; i++) {
      const [x0, y0] = pairs[i - 1];
      const [x1, y1] = pairs[i];
      if (raw <= x1) {
        const t = x1 === x0 ? 0 : (raw - x0) / (x1 - x0);
        return Math.round(y0 + t * (y1 - y0));
      }
    }
    return pairs[pairs.length - 1][1];
  };
}

const toUi = buildUiCurve();

/**
 * The eight concerns the reference series never captured.
 *
 * `measurements.md` explains why they are absent and why backfilling them is not
 * happening: at ~20 units per photo, re-analysing 20 photos costs ~400 of the
 * ~468 remaining, for a demo asset that already works.
 *
 * **These numbers are invented.** They exist so the detail page has fifteen
 * metrics to lay out instead of seven. Every synthesised value carries
 * `synthetic: true` so nothing downstream can mistake it for a measurement —
 * that flag is the only thing standing between test data and a fabricated
 * result, so do not strip it.
 *
 * Slopes are per day and deliberately small; on a five-day window the jitter
 * dominates, which is the correct outcome. Moisture is the one with a real
 * story — isotretinoin dries skin, so it declines across the long trial.
 *
 * `tear_trough` was added to `ANALYSIS_CONCERNS` on 2026-08-09 after the
 * `hd_dark_circle_v2` naming bug turned up a live sample payload showing it was
 * a real, request-valid concern the app had never collected. It has no
 * reference-series measurement either, so it gets the same eye-area treatment
 * as `eye_bag` and `dark_circle_v2`.
 */
const SYNTHETIC = {
  moisture: { at0: 74, perDay: -0.09, jitter: 3.0 },
  wrinkle: { at0: 83, perDay: 0.011, jitter: 1.5 },
  dark_circle_v2: { at0: 61, perDay: 0.034, jitter: 2.5 },
  eye_bag: { at0: 66, perDay: 0.029, jitter: 2.0 },
  firmness: { at0: 80, perDay: -0.006, jitter: 1.5 },
  droopy_upper_eyelid: { at0: 86, perDay: 0.0, jitter: 1.0 },
  droopy_lower_eyelid: { at0: 83, perDay: 0.006, jitter: 1.0 },
  tear_trough: { at0: 64, perDay: 0.03, jitter: 2.0 },
};

/** Deterministic, so reseeding never silently changes the demo. */
function hashUnit(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function synthesise(metric, captureId, dayOffset) {
  const spec = SYNTHETIC[metric];
  const drift = spec.at0 + spec.perDay * dayOffset;
  const wobble = (hashUnit(metric, captureId) - 0.5) * 2 * spec.jitter;
  const raw = Math.min(100, Math.max(0, drift + wobble));
  return { raw: Number(raw.toFixed(2)), ui: toUi(raw), synthetic: true };
}

/* ---------------------------------------------------------------- captures */

const byId = new Map(manifest.photos.map((p) => [p.id, p]));

function parseStamp(value) {
  return new Date(value.replace(' +0000', 'Z').replace(' ', 'T'));
}

/**
 * One fixture capture: real scores where they exist, synthesised where they
 * don't, and a photo path under `public/captures/`.
 *
 * `at` overrides the real timestamp. The active trial reuses genuine captures on
 * relabelled dates so it reads as an in-flight trial rather than one that
 * started in 2025 — the scores are real and the dates are staging.
 */
function buildCapture(id, { at = null, dayOffset = 0 } = {}) {
  const photo = byId.get(id);
  if (!photo) throw new Error(`no manifest entry for ${id}`);
  const analysis = analysisFor(id);

  const concerns = {};
  for (const metric of ANALYSIS_CONCERNS) {
    const measured = analysis?.concerns?.[metric];
    concerns[metric] = measured
      ? { raw: Number(measured.raw.toFixed(2)), ui: measured.ui }
      : synthesise(metric, id, dayOffset);
  }

  return {
    id,
    capturedAt: (at ? new Date(at) : parseStamp(photo.capturedAt)).toISOString(),
    device: photo.device,
    photoUrl: `/captures/${id}.jpg`,
    concerns,
    skinAge: analysis?.skinAge ?? null,
  };
}

/* ------------------------------------------------------------------ trials */

const historical = manifest.photos
  .filter((p) => p.set === 'historical')
  .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

const historicalStart = parseStamp(historical[0].capturedAt);

const completedCaptures = historical.map((p) =>
  buildCapture(p.id, {
    dayOffset: Math.round((parseStamp(p.capturedAt) - historicalStart) / MS_PER_DAY),
  }),
);

/**
 * The active trial: five captures on five consecutive days, ending today.
 *
 * **All five are iPhone 16e.** That is the whole reason this particular set was
 * chosen over the five oldest photos. Rule 6 — camera hardware shifts every
 * metric except acne by 5–90 points, and the iPad↔iPhone XS pore offset alone is
 * 87 points. A five-day series spanning two devices measures the phones, not the
 * face, whether or not `correctForDevice()` is applied. Single-device is also
 * what a real live trial looks like.
 *
 * The day-to-day scatter that remains is genuine session noise — different
 * lighting, different framing, on the same camera. It is the argument for guided
 * capture, not something to smooth away.
 */
const ACTIVE_IDS = ['IMG_5768', 'IMG_5892', 'IMG_5971', 'IMG_5990', 'IMG_7340'];
const ACTIVE_START = '2026-08-01';

const activeCaptures = ACTIVE_IDS.map((id, i) => {
  const at = new Date(`${ACTIVE_START}T08:30:00Z`);
  at.setUTCDate(at.getUTCDate() + i);
  return buildCapture(id, { at, dayOffset: i });
});

const trials = [
  {
    id: 'accutane-2024',
    name: 'Acne medication',
    status: 'completed',
    window: {
      startDate: '2024-12-20',
      endDate: '2025-06-13',
      endDateSource: 'clinician',
    },
    frequency: { kind: 'none' },
    routine: {
      baseline: ['Cleanser', 'Moisturiser', 'SPF 50'],
      interventions: [
        { direction: 'add', name: 'Acne medication', startedOn: '2024-12-20', targets: ['acne'] },
      ],
    },
    captures: completedCaptures,
  },
  {
    id: 'did-it-hold-2026',
    name: 'Did it hold?',
    status: 'active',
    window: {
      startDate: ACTIVE_START,
      // Day 5 of 8 as of 2026-08-05 — mid-flight, so the detail page has a
      // "3 more days" state to render rather than an already-finished one.
      endDate: '2026-08-08',
      endDateSource: 'user-chosen',
    },
    frequency: { kind: 'daily' },
    routine: {
      baseline: ['Cleanser', 'Moisturiser', 'SPF 50'],
      interventions: [
        { direction: 'remove', name: 'Acne medication', startedOn: ACTIVE_START, targets: ['acne'] },
      ],
    },
    captures: activeCaptures,
  },
];

mkdirSync(resolve(root, 'fixtures'), { recursive: true });
writeFileSync(resolve(root, 'fixtures/trials.json'), JSON.stringify(trials, null, 2) + '\n');

/**
 * The device offset table, copied out of gitignored `data/`.
 *
 * The completed trial spans an iPad Pro, an iPhone XS and an iPhone 16e, and the
 * offsets between them reach 87 points on pore — several times any real change
 * (rule 6). Comparing its first capture to its last without this table produces
 * a confident, entirely false answer, so the table has to travel with the
 * fixture or the demo silently lies.
 *
 * Only the seven measured concerns have offsets. `correctForDevice()` passes
 * anything else through untouched, which is the right behaviour for the
 * synthesised seven.
 */
const offsets = JSON.parse(readFileSync(resolve(root, 'data/device-offsets.json'), 'utf8'));
writeFileSync(
  resolve(root, 'fixtures/device-offsets.json'),
  JSON.stringify({ baseline: offsets.baseline, offsetToBaseline: offsets.offsetToBaseline }, null, 2) + '\n',
);

const synthetic = ANALYSIS_CONCERNS.filter((c) => c in SYNTHETIC);
for (const t of trials) {
  const devices = new Set(t.captures.map((c) => c.device));
  console.log(
    `${t.id.padEnd(20)} ${t.status.padEnd(10)} ${String(t.captures.length).padStart(2)} captures  ` +
      `${devices.size} device${devices.size === 1 ? '' : 's'}`,
  );
}
console.log(`\n${synthetic.length} concerns synthesised per capture: ${synthetic.join(', ')}`);
console.log('wrote fixtures/trials.json');
