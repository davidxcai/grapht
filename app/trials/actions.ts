'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { del, put } from '@vercel/blob';

import {
  analyzeAndStore,
  analyzeStoredCapture,
  checkImage,
  storeCapturePhoto,
  RESOLUTION,
} from '@/lib/capture';
import {
  addCapture,
  addCapturePhoto,
  addFollowUpCapture,
  captureOwnedBy,
  closeTrial,
  createTrial,
  deleteCapturePhoto,
  deleteTrial,
  getTrialHeader,
  isFixtureTrial,
  loadTrials,
  logApplication,
  setCaptureNote,
  setSummary,
  setUserReview,
  updateCaptureAnalysis,
  updateTrialSettings,
  updateTrialVisibility,
  type InterventionInput,
} from '@/lib/trial-store';
import { getRoutine, snapshotRoutine } from '@/lib/routines';
import { writeSummary } from '@/lib/summary';
import { currentUserId } from '@/lib/auth';
import { isInconclusive, type BaselineEntry, type Frequency, type Trial } from '@/lib/trials';
import type { ActionResult } from '@/app/routines/actions';
import { searchCatalogForPicker as searchCatalog, type CatalogPickerMatch } from '@/lib/catalog';

/** Catalog matches for the product-name autocomplete in the trial editor
 *  (components/trial-editor.tsx) — each carries its INCI list so "Suggest"
 *  can classify from real ingredients instead of the typed name alone. */
export async function searchCatalogForPicker(q: string): Promise<CatalogPickerMatch[]> {
  return searchCatalog(q);
}

export interface NewTrialInput {
  name: string;
  interventions: InterventionInput[];
  routineId: string | null;
  endDate: string | null;
  endDateSource: Trial['window']['endDateSource'];
  timeOfDay: Trial['timeOfDay'];
  visibility: Trial['visibility'];
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
 * Order matters and is deliberate: check the caller, validate, freeze the
 * baseline, analyse the photo, then write. The analysis is the only step that
 * spends YouCam units and the only one that can fail for a reason the user can
 * act on, so nothing is persisted until it succeeds — and because failed tasks
 * are free, a rejected photo costs nothing but a retry.
 *
 * The sign-in test is first for the same reason everything cheap is: a trial
 * with no owner to file it under must be refused while refusing is still free.
 */
export async function startTrial(
  input: NewTrialInput,
  photo: File,
): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to start a trial.' };

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
      const routine = await getRoutine(userId, input.routineId);
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
    const id = await createTrial(userId, {
      name,
      startDate: today(),
      endDate: input.endDate,
      endDateSource: input.endDate ? (input.endDateSource ?? 'user-chosen') : null,
      timeOfDay: input.timeOfDay,
      // Anything other than an explicit 'public' is private. Publishing is the
      // one choice here that can't be taken back from whoever already read it.
      visibility: input.visibility === 'public' ? 'public' : 'private',
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
    revalidatePath('/dashboard');
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
 * Log today's photo against a running trial — the daily loop the product is
 * for. **Never analysed.** Only a trial's initial photo (`startTrial()`) and
 * final photo (`endTrial()`, or `addFinalPhoto()` on an inconclusive trial)
 * spend YouCam units — every other capture, this one included, is stored and
 * shown in the timeline but carries no scores. That's the whole fix for
 * "daily logging shouldn't cost $60/user/month."
 *
 * Guards mirror `startTrial()`'s ordering out of habit — refuse what's free to
 * refuse before doing any work — even though there's no unit spend here to
 * protect anymore.
 */
export async function logCapture(
  trialId: string,
  photo: File,
  device: string | null,
  note?: string | null,
): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to add a photo.' };

  if (isFixtureTrial(trialId)) {
    return { ok: false, error: 'This is the built-in sample trial, so its photos are fixed.' };
  }

  if (!photo || photo.size === 0) return { ok: false, error: 'Add a photo first.' };
  const imageError = checkImage(photo);
  if (imageError) return { ok: false, error: imageError };

  let header;
  try {
    header = await getTrialHeader(userId, trialId);
  } catch (error) {
    return { ok: false, error: `Could not read that trial — ${(error as Error).message}` };
  }
  if (!header) return { ok: false, error: 'That trial no longer exists.' };
  if (header.status !== 'active') {
    return { ok: false, error: 'This trial has ended, so no more photos can be added to it.' };
  }

  let stored;
  try {
    stored = await storeCapturePhoto(photo, slugify(header.name));
  } catch (error) {
    return { ok: false, error: `That photo could not be saved — ${(error as Error).message}` };
  }

  try {
    const id = await addCapture(userId, trialId, {
      device,
      resolution: RESOLUTION,
      blobUrl: stored.blobUrl,
      blobPathname: stored.blobPathname,
      concerns: null,
      zones: null,
      skinAge: null,
    });

    // The note rides along when one was written at upload.
    const trimmedNote = note?.trim();
    if (id && trimmedNote) {
      await setCaptureNote(userId, trialId, id, trimmedNote).catch(() => {});
    }

    // The write is guarded on `status = 'active'`, so no row means the trial was
    // ended between the check above and here.
    if (!id) {
      return {
        ok: false,
        error: 'This trial has since ended, so that photo was not saved.',
      };
    }

    revalidatePath('/');
    revalidatePath('/dashboard');
    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: { id } };
  } catch (error) {
    return {
      ok: false,
      error: `That photo could not be saved — ${(error as Error).message}`,
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
 * **This cannot be undone** — with one exception, `addFinalPhoto()` below, for
 * a trial that ends up inconclusive. Otherwise an ended trial is not
 * reopenable; picking the routine back up is a new trial
 * (`docs/trial-model.md`).
 *
 * This is also where the trial's **final** analysed capture comes from — the
 * second and last of the two photos a trial ever spends units on:
 *
 * - `finalPhoto` given: analysed fresh, exactly like the initial capture.
 * - No `finalPhoto`, but something was logged after day one: the most
 *   recently logged (unanalysed) photo is analysed retroactively — "otherwise
 *   it'll use the latest photo."
 * - No `finalPhoto` and nothing logged after day one: nothing to analyse.
 *   The trial still ends, but `isInconclusive()` (lib/trials.ts) reads true —
 *   only the starting photo was ever measured. `addFinalPhoto()` is the way
 *   out of that state.
 *
 * Fixture trials have no database row, so ending one is refused rather than
 * silently doing nothing.
 */
export async function endTrial(
  id: string,
  finalPhoto?: File | null,
  device?: string | null,
): Promise<ActionResult<{ id: string; inconclusive: boolean }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to end a trial.' };

  if (isFixtureTrial(id)) {
    return { ok: false, error: 'This is the built-in sample trial and cannot be ended.' };
  }

  let trial: Trial | undefined;
  try {
    const { trials } = await loadTrials(userId);
    trial = trials.find((t) => t.id === id);
  } catch (error) {
    return { ok: false, error: `Could not read that trial — ${(error as Error).message}` };
  }
  if (!trial) return { ok: false, error: 'That trial no longer exists.' };
  if (trial.status !== 'active') return { ok: false, error: 'This trial has already ended.' };

  // An active trial has exactly one analysed capture (the initial) until this
  // point — a second only ever lands here or via `addFinalPhoto()`, which
  // requires the trial to already be `completed`. So whether either branch
  // below runs is the whole answer to "is this trial conclusive."
  let finalAnalyzed = false;

  if (finalPhoto && finalPhoto.size > 0) {
    const imageError = checkImage(finalPhoto);
    if (imageError) return { ok: false, error: imageError };

    let capture;
    try {
      capture = await analyzeAndStore(finalPhoto, slugify(trial.name));
    } catch (error) {
      return { ok: false, error: describeCaptureFailure(error as Error) };
    }

    try {
      const captureId = await addCapture(userId, id, {
        device: device ?? null,
        resolution: RESOLUTION,
        blobUrl: capture.blobUrl,
        blobPathname: capture.blobPathname,
        concerns: capture.concerns,
        zones: capture.zones,
        skinAge: capture.skinAge,
      });
      if (!captureId) {
        return {
          ok: false,
          error: 'Your final photo was analysed but this trial has since ended.',
        };
      }
      finalAnalyzed = true;
    } catch (error) {
      return {
        ok: false,
        error: `Your final photo was analysed but could not be saved — ${(error as Error).message}`,
      };
    }
  } else if (trial.captures.length > 1) {
    const latest = [...trial.captures].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    if (!latest.blobUrl) {
      return { ok: false, error: 'Your latest photo could not be found in storage.' };
    }
    try {
      const scores = await analyzeStoredCapture({ blobUrl: latest.blobUrl });
      const updated = await updateCaptureAnalysis(userId, id, latest.id, scores);
      if (!updated) {
        return { ok: false, error: 'Your latest photo was analysed but could not be saved.' };
      }
      finalAnalyzed = true;
    } catch (error) {
      return { ok: false, error: describeCaptureFailure(error as Error) };
    }
  }
  // Else: nothing beyond the initial photo was ever logged. End as-is — the
  // trial becomes inconclusive by definition, no units spent.

  try {
    const updated = await closeTrial(userId, id);
    if (!updated) {
      return { ok: false, error: 'This trial has already ended.' };
    }
    revalidatePath('/');
    revalidatePath('/dashboard');
    revalidatePath(`/trials/${id}`);
    return { ok: true, data: { id, inconclusive: !finalAnalyzed } };
  } catch (error) {
    return { ok: false, error: `Could not end this trial — ${(error as Error).message}` };
  }
}

/**
 * The one door an inconclusive trial gets: one more analysed photo, taken
 * after the trial already ended. `addFollowUpCapture()` (lib/trial-store.ts)
 * is the actual enforcement — it only inserts while fewer than two of the
 * trial's captures carry scores, so this cannot be called twice.
 */
export async function addFinalPhoto(
  trialId: string,
  photo: File,
  device: string | null,
): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to add a photo.' };

  if (isFixtureTrial(trialId)) {
    return { ok: false, error: 'This is the built-in sample trial, so its photos are fixed.' };
  }

  let trial: Trial | undefined;
  try {
    const { trials } = await loadTrials(userId);
    trial = trials.find((t) => t.id === trialId);
  } catch (error) {
    return { ok: false, error: `Could not read that trial — ${(error as Error).message}` };
  }
  if (!trial) return { ok: false, error: 'That trial no longer exists.' };
  if (!isInconclusive(trial)) {
    return { ok: false, error: 'This trial already has a result, so it cannot take another photo.' };
  }

  if (!photo || photo.size === 0) return { ok: false, error: 'Add a photo first.' };
  const imageError = checkImage(photo);
  if (imageError) return { ok: false, error: imageError };

  let capture;
  try {
    capture = await analyzeAndStore(photo, slugify(trial.name));
  } catch (error) {
    return { ok: false, error: describeCaptureFailure(error as Error) };
  }

  try {
    const captureId = await addFollowUpCapture(userId, trialId, {
      device,
      resolution: RESOLUTION,
      blobUrl: capture.blobUrl,
      blobPathname: capture.blobPathname,
      concerns: capture.concerns,
      zones: capture.zones,
      skinAge: capture.skinAge,
    });
    if (!captureId) {
      return {
        ok: false,
        error: 'Your photo was analysed but this trial already has a result, so it was not saved.',
      };
    }
    revalidatePath('/');
    revalidatePath('/dashboard');
    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: { id: captureId } };
  } catch (error) {
    return {
      ok: false,
      error: `Your photo was analysed but could not be saved — ${(error as Error).message}`,
    };
  }
}

export interface TrialSettingsUpdate {
  name: string;
  endDate: string | null;
  endDateSource: Trial['window']['endDateSource'];
  timeOfDay: Trial['timeOfDay'];
  visibility: Trial['visibility'];
  frequency: Frequency;
  commentsEnabled: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A server action is a public endpoint, so the `Frequency` union is re-checked
 * here rather than trusted from the form. Null is "not a schedule this app
 * knows" and the caller refuses the whole save.
 */
function parseFrequency(value: Frequency): Frequency | null {
  switch (value?.kind) {
    case 'daily':
    case 'none':
      return { kind: value.kind };
    case 'every-n-days': {
      const n = Math.round(Number(value.n));
      return Number.isFinite(n) && n >= 2 ? { kind: 'every-n-days', n } : null;
    }
    case 'weekdays': {
      const days = [...new Set((value.days ?? []).map(Number))].filter(
        (d) => Number.isInteger(d) && d >= 0 && d <= 6,
      );
      return { kind: 'weekdays', days };
    }
    default:
      return null;
  }
}

/**
 * Edit a trial's settings — its name, how long it runs for, how often the user
 * means to log, morning or night, and who can see it.
 *
 * What isn't here is the point: the tracked products and their `targets[]` never
 * appear, because they freeze at creation. Moving them afterwards would rewrite
 * the attribution of photos already taken without a single new measurement
 * behind it (CLAUDE.md rule 9). The start date is fixed for the same reason the
 * captures are — the window has to match what was actually logged.
 *
 * On an ended trial the store keeps everything but the name and visibility, so
 * the settings a finished window no longer has any use for can't be moved.
 */
export async function saveTrialSettings(
  id: string,
  input: TrialSettingsUpdate,
): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to edit a trial.' };

  if (isFixtureTrial(id)) {
    return { ok: false, error: 'This is the built-in sample trial, so its settings are fixed.' };
  }

  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'Give the trial a name.' };

  const frequency = parseFrequency(input.frequency);
  if (!frequency) return { ok: false, error: "That's not a logging schedule this app knows." };

  const endDate = input.endDate?.trim() || null;
  if (endDate && !DAY.test(endDate)) return { ok: false, error: 'That end date is not a real date.' };

  let header;
  try {
    header = await getTrialHeader(userId, id);
  } catch (error) {
    return { ok: false, error: `Could not read that trial — ${(error as Error).message}` };
  }
  if (!header) return { ok: false, error: 'That trial no longer exists.' };
  if (endDate && endDate < header.startDate) {
    return { ok: false, error: 'The end date cannot be before the trial started.' };
  }

  try {
    const saved = await updateTrialSettings(userId, id, {
      name,
      endDate,
      endDateSource: endDate ? (input.endDateSource ?? 'user-chosen') : null,
      timeOfDay: input.timeOfDay === 'pm' ? 'pm' : 'am',
      // Same rule as creation: anything other than an explicit 'public' is
      // private, so a trial is never published by omission.
      visibility: input.visibility === 'public' ? 'public' : 'private',
      frequency,
      commentsEnabled: input.commentsEnabled !== false,
    });
    if (!saved) return { ok: false, error: 'That trial no longer exists.' };

    revalidatePath('/');
    revalidatePath('/dashboard');
    revalidatePath(`/trials/${id}`);
    return { ok: true, data: { id } };
  } catch (error) {
    return { ok: false, error: `Could not save your changes — ${(error as Error).message}` };
  }
}

/**
 * The header's quick Public/Private toggle — the same setting
 * `saveTrialSettings()` moves, exposed on its own so flipping it doesn't
 * require the whole settings form's other fields along for the ride.
 */
export async function setTrialVisibility(
  id: string,
  visibility: Trial['visibility'],
): Promise<ActionResult<{ visibility: Trial['visibility'] }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to change who can see this trial.' };

  if (isFixtureTrial(id)) {
    return { ok: false, error: 'This is the built-in sample trial, so its visibility is fixed.' };
  }

  const value = visibility === 'public' ? 'public' : 'private';
  try {
    const saved = await updateTrialVisibility(userId, id, value);
    if (!saved) return { ok: false, error: 'That trial no longer exists.' };

    revalidatePath('/');
    revalidatePath('/dashboard');
    revalidatePath(`/trials/${id}`);
    return { ok: true, data: { visibility: value } };
  } catch (error) {
    return { ok: false, error: `Could not change visibility — ${(error as Error).message}` };
  }
}

/**
 * Delete a trial outright — its own row and everything under it (products,
 * photos, applications, comments, saves), plus the photos themselves in Blob.
 * There is no undo, and unlike ending a trial, deleting removes it from the
 * dashboard and the community surfaces entirely rather than closing it out.
 */
export async function removeTrial(id: string): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to delete a trial.' };

  if (isFixtureTrial(id)) {
    return { ok: false, error: 'This is the built-in sample trial and cannot be deleted.' };
  }

  try {
    const pathnames = await deleteTrial(userId, id);
    if (!pathnames) return { ok: false, error: 'That trial no longer exists.' };
    await Promise.all(pathnames.map((p) => del(p).catch(() => {})));

    revalidatePath('/');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Could not delete this trial — ${(error as Error).message}` };
  }
}

/**
 * The "applied products" check-in — one press, stamped server-side. The photo
 * taken afterwards reports the hours in between (`timeSinceApplied`).
 */
export async function applyProducts(trialId: string): Promise<ActionResult<null>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to check in.' };

  if (isFixtureTrial(trialId)) {
    return { ok: false, error: 'This is the built-in sample trial.' };
  }

  try {
    const logged = await logApplication(userId, trialId);
    if (!logged) return { ok: false, error: 'That trial is not running.' };
    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: `Could not check in — ${(error as Error).message}` };
  }
}

const MAX_NOTE = 500;

/** Add, edit, or (with an empty string) remove the note on one photo. */
export async function saveCaptureNote(
  trialId: string,
  captureId: string,
  note: string,
): Promise<ActionResult<null>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to edit a note.' };

  if (isFixtureTrial(trialId)) {
    return { ok: false, error: 'This is the built-in sample trial, so its photos are fixed.' };
  }

  const trimmed = note.trim().slice(0, MAX_NOTE) || null;
  try {
    const saved = await setCaptureNote(userId, trialId, captureId, trimmed);
    if (!saved) return { ok: false, error: 'That photo no longer exists.' };
    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: `Could not save the note — ${(error as Error).message}` };
  }
}

const MAX_EXTRA_PHOTOS = 8;

/**
 * Attach extra angles to one day's capture. Never analysed — these are
 * qualitative context, cost no YouCam units, and skip straight to Blob once
 * ownership is confirmed. The ownership read comes first so a stranger's id
 * refuses before anything is uploaded.
 */
export async function addCapturePhotos(
  trialId: string,
  captureId: string,
  form: FormData,
): Promise<ActionResult<null>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to add photos.' };

  if (isFixtureTrial(trialId)) {
    return { ok: false, error: 'This is the built-in sample trial, so its photos are fixed.' };
  }

  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: 'Add a photo first.' };
  if (files.length > MAX_EXTRA_PHOTOS) {
    return { ok: false, error: `That's a lot of angles — keep it to ${MAX_EXTRA_PHOTOS} at a time.` };
  }
  for (const file of files) {
    const imageError = checkImage(file);
    if (imageError) return { ok: false, error: imageError };
  }

  try {
    const owned = await captureOwnedBy(userId, trialId, captureId);
    if (!owned) return { ok: false, error: 'That photo no longer exists.' };

    for (const file of files) {
      const extension = file.type === 'image/png' ? 'png' : 'jpg';
      const blob = await put(
        `captures/extra/${captureId}/${randomUUID()}.${extension}`,
        Buffer.from(await file.arrayBuffer()),
        { access: 'private', contentType: file.type },
      );
      const id = await addCapturePhoto(userId, captureId, {
        blobUrl: blob.url,
        blobPathname: blob.pathname,
      });
      // The capture vanished mid-upload; don't leave the blob orphaned.
      if (!id) await del(blob.pathname).catch(() => {});
    }

    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: `Could not add the photos — ${(error as Error).message}` };
  }
}

export async function removeCapturePhoto(
  trialId: string,
  photoId: string,
): Promise<ActionResult<null>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in first.' };

  try {
    const pathname = await deleteCapturePhoto(userId, photoId);
    if (!pathname) return { ok: false, error: 'That photo no longer exists.' };
    await del(pathname).catch(() => {});
    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: `Could not remove the photo — ${(error as Error).message}` };
  }
}

/**
 * Write the Gemini summary for a completed trial the caller owns.
 *
 * The gate is applied while assembling the prompt (`lib/summary.ts`): metrics
 * inside their wobble reach the model as "no measurable change" with nothing
 * to narrate. Regenerating overwrites — the numbers it describes cannot have
 * changed, since the trial is closed.
 */
export async function generateSummary(trialId: string): Promise<ActionResult<{ text: string }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in first.' };

  if (isFixtureTrial(trialId)) {
    return { ok: false, error: 'This is the built-in sample trial.' };
  }

  let trial;
  try {
    const { trials } = await loadTrials(userId);
    trial = trials.find((t) => t.id === trialId);
  } catch (error) {
    return { ok: false, error: `Could not read that trial — ${(error as Error).message}` };
  }
  if (!trial) return { ok: false, error: 'That trial no longer exists.' };
  if (trial.status !== 'completed') {
    return { ok: false, error: 'The summary is written when the trial ends.' };
  }
  if (isInconclusive(trial)) {
    // Every metric's series is <2 points, which `metricChanges()` reports as
    // `direction: 'flat'` — indistinguishable, to the gate, from "measured
    // twice and didn't move." Only one measurement exists here, so nothing
    // is safe to narrate; add a final photo first.
    return {
      ok: false,
      error: 'This trial is inconclusive — add a final photo before writing a summary.',
    };
  }

  try {
    const summary = await writeSummary(trial);
    const saved = await setSummary(userId, trialId, summary);
    if (!saved) return { ok: false, error: 'That trial no longer exists.' };
    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: { text: summary.text } };
  } catch (error) {
    return { ok: false, error: `The summary could not be written — ${(error as Error).message}` };
  }
}

const MAX_REVIEW = 4000;

/** The user's own words on a finished trial — the qualitative layer. */
export async function saveUserReview(
  trialId: string,
  review: string,
): Promise<ActionResult<null>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in first.' };

  if (isFixtureTrial(trialId)) {
    return { ok: false, error: 'This is the built-in sample trial.' };
  }

  try {
    const saved = await setUserReview(userId, trialId, review.trim().slice(0, MAX_REVIEW) || null);
    if (!saved) return { ok: false, error: 'Your words are saved when the trial has ended.' };
    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: `Could not save — ${(error as Error).message}` };
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
