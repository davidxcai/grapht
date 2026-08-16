'use server';

import { revalidatePath } from 'next/cache';

import { currentUserId } from '@/lib/auth';
import { localDay, parseDay } from '@/lib/days';
import { PROFILE_VISIBILITIES, SKIN_TYPES, type ProfileVisibility, type SkinType } from '@/lib/profile';
import { saveProfile } from '@/lib/profile-store';
import { causeMessage, failed, type ActionResult } from '@/lib/action-result';

export interface ProfileFormInput {
  username: string;
  skinType: string;
  birthday: string;
  visibility: string;
}

/** Postgres unique-violation, i.e. somebody already has that username. */
const UNIQUE_VIOLATION = '23505';

/**
 * Letters, digits, `-` and `_`, and it has to start and end on something
 * readable. Deliberately plain: a username here is a handle, not a display name,
 * and the avatar and email carry the personality.
 */
const USERNAME = /^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])?$/i;

/** Older than anyone alive. A birthday this far back is a typo, not a claim. */
const MAX_AGE_YEARS = 120;

function checkBirthday(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Enter your birthday.';

  const parsed = parseDay(value);
  if (Number.isNaN(parsed.getTime()) || value.slice(0, 10) !== localDay(parsed)) {
    return 'That is not a real date.';
  }

  const now = new Date();
  if (parsed > now) return 'That birthday is in the future.';

  const oldest = new Date(now);
  oldest.setFullYear(oldest.getFullYear() - MAX_AGE_YEARS);
  if (parsed < oldest) return 'Check that year.';

  return null;
}

/**
 * Write the profile, which is also what marks sign-up finished.
 *
 * Used by both `/welcome` and `/profile` — the same fields, the same rules, and
 * an upsert underneath, so there is nothing for the two screens to disagree
 * about. The avatar is not here: it lives in Clerk and the form sets it directly
 * (`components/profile-form.tsx`).
 */
export async function saveProfileDetails(input: ProfileFormInput): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return failed('Log in first.');

  const username = input.username?.trim() ?? '';
  if (!username) return failed('Pick a username.');
  if (!USERNAME.test(username)) {
    return failed('Usernames are 2–24 characters: letters, digits, hyphens and underscores.');
  }

  if (!SKIN_TYPES.includes(input.skinType as SkinType)) {
    return failed('Pick a skin type.');
  }

  if (!PROFILE_VISIBILITIES.includes(input.visibility as ProfileVisibility)) {
    return failed('Pick who can see your profile.');
  }

  const birthdayError = checkBirthday(input.birthday ?? '');
  if (birthdayError) return failed(birthdayError);

  try {
    await saveProfile(userId, {
      username,
      skinType: input.skinType as SkinType,
      birthday: input.birthday,
      visibility: input.visibility as ProfileVisibility,
    });

    revalidatePath('/');
    revalidatePath('/profile');
    return { ok: true };
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      return failed(`"${username}" is taken.`);
    }
    return failed(causeMessage(error));
  }
}
