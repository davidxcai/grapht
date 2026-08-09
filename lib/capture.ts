import 'server-only';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { put, get } from '@vercel/blob';

import { clientFromEnv } from '@/src/youcam.mjs';
import { ANALYSIS_CONCERNS, toRequestAction } from '@/src/concerns.mjs';
import { downloadResult, normalizeScores, readScoreInfo } from '@/src/results.mjs';

/**
 * A live capture: analyse it, store it, hand back both halves.
 *
 * Two rules from CLAUDE.md are enforced here rather than left to call sites.
 *
 * **All fifteen concerns, on every capture that gets analysed** (rule 8).
 * Billing is tiered per task, not per metric, so narrowing to what the trial
 * targets saves nothing; side effects turn up in metrics nobody chose; and you
 * cannot retroactively ask a question of data you never collected. What the
 * trial targets decides what gets *narrated*, never what gets collected. Since
 * the daily-analysis pivot, "every capture that gets analysed" is just two per
 * trial — the initial and final photo — not every daily log; see
 * `storeCapturePhoto()` and `analyzeStoredCapture()` below.
 *
 * **HD, always** (rule 4). SD and HD are different models for acne, texture and
 * pore, differing by 13–18 points — several times any real biological change.
 * A series that mixes them is worthless and nothing downstream can detect it.
 */

const ACTIONS = (ANALYSIS_CONCERNS as string[]).map((c) => toRequestAction(c) as string);

/** HD is 16 units for up to 7 concerns; the 15-concern tier is unmeasured. */
export const ESTIMATED_UNITS_PER_CAPTURE = 20;

export const RESOLUTION = 'hd';

export interface AnalyzedCapture {
  concerns: Record<string, { raw: number; ui: number | null }>;
  zones: Record<string, unknown>;
  skinAge: number | null;
  blobUrl: string;
  blobPathname: string;
}

const ACCEPTED = new Set(['image/jpeg', 'image/png']);
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Browser file inputs on iOS hand back HEIC, which the pipeline converts with
 * `sips` — macOS-only, and absent from any deployment target. Rejecting up
 * front with a clear message beats a conversion that works on the developer's
 * laptop and nowhere else.
 */
export function checkImage(file: File): string | null {
  if (!ACCEPTED.has(file.type)) {
    return 'That file type is not supported — use a JPEG or PNG.';
  }
  if (file.size > MAX_BYTES) return 'That photo is too large. Keep it under 20 MB.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

function extensionFor(contentType: string): string {
  return contentType === 'image/png' ? 'png' : 'jpg';
}

/**
 * Store a photo with no analysis — the daily-log path since the pivot away
 * from analysing every capture. Costs no YouCam units. Mirrors the blob half
 * of `analyzeAndStore()` below, minus the API call.
 */
export async function storeCapturePhoto(
  file: File,
  trialSlug: string,
): Promise<{ blobUrl: string; blobPathname: string }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const blob = await put(`captures/${trialSlug}/${randomUUID()}.${extensionFor(file.type)}`, bytes, {
    access: 'private',
    contentType: file.type,
  });
  return { blobUrl: blob.url, blobPathname: blob.pathname };
}

export interface AnalyzedScores {
  concerns: Record<string, { raw: number; ui: number | null }>;
  zones: Record<string, unknown>;
  skinAge: number | null;
}

/**
 * Run YouCam analysis on bytes already sitting on disk and parse the result.
 * Shared by `analyzeAndStore()` (a freshly captured photo) and
 * `analyzeStoredCapture()` (a photo logged earlier, analysed retroactively as
 * a trial's final capture).
 */
async function analyzeBytes(bytes: Buffer, extension: string): Promise<AnalyzedScores> {
  const dir = await mkdtemp(join(tmpdir(), 'grapht-capture-'));
  try {
    const imagePath = join(dir, `capture.${extension}`);
    await writeFile(imagePath, bytes);

    const client = clientFromEnv();
    const result = await client.analyzeImage(imagePath, ACTIONS);
    const url = result?.results?.url ?? result?.url;
    if (!url) throw new Error('the analysis finished but returned no result to download');

    // Result URLs are presigned and expire in about two hours, so the download
    // happens now, in-band. A retry later would have to pay for the task again.
    await downloadResult(url, join(dir, 'result'));
    const scores = normalizeScores(readScoreInfo(join(dir, 'result')));
    return { concerns: scores.concerns, zones: scores.zones, skinAge: scores.skinAge };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Analyse first, store second.
 *
 * Only successful tasks are billed, so a rejected photo — `error_src_face_too_small`
 * is the common one — costs nothing and should not leave an orphaned blob
 * behind. Uploading only after the analysis lands keeps that true without
 * needing cleanup.
 */
export async function analyzeAndStore(file: File, trialSlug: string): Promise<AnalyzedCapture> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = extensionFor(file.type);

  const scores = await analyzeBytes(bytes, extension);

  const blob = await put(`captures/${trialSlug}/${randomUUID()}.${extension}`, bytes, {
    access: 'private',
    contentType: file.type,
  });

  return {
    concerns: scores.concerns,
    zones: scores.zones,
    skinAge: scores.skinAge,
    blobUrl: blob.url,
    blobPathname: blob.pathname,
  };
}

/**
 * Analyse a photo that was already logged and stored — never re-uploads it.
 *
 * This is the "use my latest photo" end-trial path: the user logged a photo
 * days ago without spending a unit on it, and only now, at trial end, does it
 * become worth analysing. The blob is private, so it's fetched server-side
 * with the store's token exactly like `app/trials/[id]/photo/[photoId]/route.ts`
 * does to render it.
 */
export async function analyzeStoredCapture(capture: { blobUrl: string }): Promise<AnalyzedScores> {
  const result = await get(capture.blobUrl, { access: 'private' });
  if (!result || result.statusCode !== 200) {
    throw new Error('that photo could no longer be found in storage');
  }
  const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
  return analyzeBytes(bytes, extensionFor(result.blob.contentType));
}
