'use server';

import { revalidatePath } from 'next/cache';

import { analyzeAndStore, checkImage, RESOLUTION } from '@/lib/capture';
import {
  addCapture,
  closeTrial,
  createTrial,
  getTrialHeader,
  isFixtureTrial,
  type InterventionInput,
} from '@/lib/trial-store';
import { getRoutine, snapshotRoutine } from '@/lib/routines';
import type { BaselineEntry, Frequency, Trial } from '@/lib/trials';
import type { ActionResult } from '@/app/routines/actions';

export interface NewTrialInput {
  name: string;
  interventions: InterventionInput[];
  routineId: string | null;
  endDate: string | null;
  endDateSource: Trial['window']['endDateSource'];
  frequency: Frequency;
  device: string | null;
}

/** Local calendar day. The trial starts today; there is no other option. */
function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trial';
}

/**
 * Create a trial from the form, with its baseline capture.
 *
 * Order matters and is deliberate: validate, freeze the baseline, analyse the
 * photo, then write. The analysis is the only step that spends YouCam units and
 * the only one that can fail for a reason the user can act on, so nothing is
 * persisted until it succeeds — and because failed tasks are free, a rejected
 * photo costs nothing but a retry.
 */
export async function startTrial(
  input: NewTrialInput,
  photo: File,
): Promise<ActionResult<{ id: string }>> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'Give the trial a name.' };

  const interventions = (input.interventions ?? []).filter((i) => i.name?.trim());

  // An empty tracked list is legitimate — that is how a removal is filed
  // (docs/trial-model.md) — but only against a saved routine, which is what it
  // is a removal *from*. With neither, there is nothing to measure against.
  if (interventions.length === 0 && !input.routineId) {
    return {
      ok: false,
      error: 'Add a product to track, or pick the routine this trial sits on.',
    };
  }

  if (!photo || photo.size === 0) {
    return { ok: false, error: 'Add a photo to start from.' };
  }
  const imageError = checkImage(photo);
  if (imageError) return { ok: false, error: imageError };

  // Frozen now, by value. Editing or deleting the routine later must not reach
  // into this trial and move a metric between `confounded` and `unexplained`
  // with no new measurement (lib/routines.ts, `snapshotRoutine`).
  let baseline: BaselineEntry[] = [];
  if (input.routineId) {
    try {
      const routine = await getRoutine(input.routineId);
      if (!routine) return { ok: false, error: 'That routine no longer exists.' };
      baseline = [snapshotRoutine(routine)];
    } catch (error) {
      return { ok: false, error: `Could not read that routine — ${(error as Error).message}` };
    }
  }

  let capture;
  try {
    capture = await analyzeAndStore(photo, slugify(name));
  } catch (error) {
    return { ok: false, error: describeCaptureFailure(error as Error) };
  }

  try {
    const id = await createTrial({
      name,
      startDate: today(),
      endDate: input.endDate,
      endDateSource: input.endDate ? (input.endDateSource ?? 'user-chosen') : null,
      frequency: input.frequency,
      baseline,
      interventions,
      capture: {
        device: input.device,
        resolution: RESOLUTION,
        blobUrl: capture.blobUrl,
        blobPathname: capture.blobPathname,
        concerns: capture.concerns,
        zones: capture.zones,
        skinAge: capture.skinAge,
      },
    });

    revalidatePath('/');
    return { ok: true, data: { id } };
  } catch (error) {
    // The units are already spent at this point, so say so rather than letting
    // it read as a failed photo the user should retake.
    return {
      ok: false,
      error: `Your photo was analysed but the trial could not be saved — ${(error as Error).message}`,
    };
  }
}

/**
 * Log today's photo against a running trial — the daily loop the product is for.
 *
 * Same order as `startTrial()`, for the same reason: everything that can be
 * refused for free is refused before the analysis, because the analysis is the
 * only step that spends YouCam units. A fixture id, an ended trial and an
 * unusable file are all caught here, at no cost. Failed tasks are free, so even
 * a photo the API rejects costs nothing but a retake.
 */
export async function logCapture(
  trialId: string,
  photo: File,
  device: string | null,
): Promise<ActionResult<{ id: string }>> {
  if (isFixtureTrial(trialId)) {
    return { ok: false, error: 'This is the built-in sample trial, so its photos are fixed.' };
  }

  if (!photo || photo.size === 0) return { ok: false, error: 'Add a photo first.' };
  const imageError = checkImage(photo);
  if (imageError) return { ok: false, error: imageError };

  let header;
  try {
    header = await getTrialHeader(trialId);
  } catch (error) {
    return { ok: false, error: `Could not read that trial — ${(error as Error).message}` };
  }
  if (!header) return { ok: false, error: 'That trial no longer exists.' };
  if (header.status !== 'active') {
    return { ok: false, error: 'This trial has ended, so no more photos can be added to it.' };
  }

  let capture;
  try {
    capture = await analyzeAndStore(photo, slugify(header.name));
  } catch (error) {
    return { ok: false, error: describeCaptureFailure(error as Error) };
  }

  try {
    const id = await addCapture(trialId, {
      device,
      resolution: RESOLUTION,
      blobUrl: capture.blobUrl,
      blobPathname: capture.blobPathname,
      concerns: capture.concerns,
      zones: capture.zones,
      skinAge: capture.skinAge,
    });

    // The write is guarded on `status = 'active'`, so no row means the trial was
    // ended between the check above and here. The units are gone either way and
    // the message says so rather than reading as a photo worth retaking.
    if (!id) {
      return {
        ok: false,
        error: 'Your photo was analysed but this trial has since ended, so it was not saved.',
      };
    }

    revalidatePath('/');
    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: { id } };
  } catch (error) {
    return {
      ok: false,
      error: `Your photo was analysed but could not be saved — ${(error as Error).message}`,
    };
  }
}

/**
 * End a trial, which is how a trial normally finishes.
 *
 * Available from day one and never framed as giving up — passing a set end date
 * prompts but does not close, and stopping before it is equally legitimate
 * (`docs/app-ui.md` §5). The end date is rewritten to today so the window
 * matches what was actually logged.
 *
 * **This cannot be undone.** An ended trial is not reopenable; picking the
 * routine back up is a new trial (`docs/trial-model.md`). The reason is that its
 * summary describes a closed window, and admitting captures afterwards would let
 * a published retrospective drift out of step with its own data.
 *
 * Fixture trials have no database row, so ending one is refused rather than
 * silently doing nothing.
 */
export async function endTrial(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const updated = await closeTrial(id);
    if (!updated) {
      return {
        ok: false,
        error: 'This is the built-in sample trial and cannot be ended.',
      };
    }
    revalidatePath('/');
    revalidatePath(`/trials/${id}`);
    return { ok: true, data: { id } };
  } catch (error) {
    return { ok: false, error: `Could not end this trial — ${(error as Error).message}` };
  }
}

/**
 * Turn the API's error codes into something a person can act on.
 *
 * `error_src_face_too_small` is by far the most common and is entirely
 * recoverable: the face has to fill at least 0.55 of the frame height. Left
 * raw, it reads as a bug in the app rather than an instruction to move closer.
 */
function describeCaptureFailure(error: Error): string {
  const message = error.message ?? '';
  if (message.includes('face_too_small')) {
    return 'Your face is too small in the frame — move closer so it fills most of the height, then try again.';
  }
  if (message.includes('no_face') || message.includes('face_not_found')) {
    return 'No face was found in that photo. Face the camera straight on and try again.';
  }
  if (message.includes('YOUCAM_API_KEY') || message.includes('apiKey and secretKey')) {
    return 'No YouCam credentials are configured, so the photo could not be analysed.';
  }
  return `The photo could not be analysed — ${message}`;
}
