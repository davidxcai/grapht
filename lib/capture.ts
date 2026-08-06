import 'server-only';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { put } from '@vercel/blob';

import { clientFromEnv } from '@/src/youcam.mjs';
import { ANALYSIS_CONCERNS, toHd } from '@/src/concerns.mjs';
import { downloadResult, normalizeScores, readScoreInfo } from '@/src/results.mjs';

/**
 * A live capture: analyse it, store it, hand back both halves.
 *
 * Two rules from CLAUDE.md are enforced here rather than left to call sites.
 *
 * **All fourteen concerns, always** (rule 8). Billing is tiered per task, not
 * per metric, so narrowing to what the trial targets saves nothing; side
 * effects turn up in metrics nobody chose; and you cannot retroactively ask a
 * question of data you never collected. What the trial targets decides what
 * gets *narrated*, never what gets collected.
 *
 * **HD, always** (rule 4). SD and HD are different models for acne, texture and
 * pore, differing by 13–18 points — several times any real biological change.
 * A series that mixes them is worthless and nothing downstream can detect it.
 */

const ACTIONS = (ANALYSIS_CONCERNS as string[]).map((c) => toHd(c) as string);

/** HD is 16 units for up to 7 concerns; the 14-concern tier is unmeasured. */
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
  const extension = file.type === 'image/png' ? 'png' : 'jpg';
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
