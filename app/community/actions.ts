'use server';

import { revalidatePath } from 'next/cache';

import { currentUserId } from '@/lib/auth';
import { addComment, deleteComment, isSaved, saveTrial, unsaveTrial } from '@/lib/community';
import { failed, failedBecause, type ActionResult } from '@/lib/action-result';

/**
 * Community writes: comments and saves. Both need an account — the community
 * reads free, but a word or a bookmark has to belong to someone.
 */

const MAX_COMMENT = 1000;

export async function postComment(
  trialId: string,
  body: string,
): Promise<ActionResult<null>> {
  const userId = await currentUserId();
  if (!userId) return failed('Log in to comment.');

  const trimmed = body.trim().slice(0, MAX_COMMENT);
  if (!trimmed) return failed('Write something first.');

  try {
    const added = await addComment(userId, trialId, trimmed);
    if (!added) return failed('Comments are closed on this trial.');
    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: null };
  } catch (error) {
    return failedBecause('Could not post', error);
  }
}

export async function removeComment(
  trialId: string,
  commentId: string,
): Promise<ActionResult<null>> {
  const userId = await currentUserId();
  if (!userId) return failed('Log in first.');

  try {
    const removed = await deleteComment(userId, commentId);
    if (!removed) return failed('That comment is not yours to remove.');
    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: null };
  } catch (error) {
    return failedBecause('Could not remove', error);
  }
}

/** Flip the bookmark; returns the new state so the button can settle. */
export async function toggleSave(trialId: string): Promise<ActionResult<{ saved: boolean }>> {
  const userId = await currentUserId();
  if (!userId) return failed('Log in to save a trial.');

  try {
    if (await isSaved(userId, trialId)) {
      await unsaveTrial(userId, trialId);
      revalidatePath(`/trials/${trialId}`);
      return { ok: true, data: { saved: false } };
    }
    await saveTrial(userId, trialId);
    revalidatePath(`/trials/${trialId}`);
    return { ok: true, data: { saved: await isSaved(userId, trialId) } };
  } catch (error) {
    return failedBecause('Could not save', error);
  }
}
