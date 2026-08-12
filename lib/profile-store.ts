import 'server-only';
import { redirect } from 'next/navigation';

import { getSql } from '@/lib/db';
import { degraded } from '@/lib/log';
import { clerkConfigured, requireUserId } from '@/lib/auth';
import type { Profile, ProfileInput, ProfileVisibility, SkinType } from '@/lib/profile';

/**
 * The profile row in Neon. Types and the skin-type list live in `lib/profile.ts`
 * so the client form can import them without dragging the database in.
 */

function asDay(value: unknown): string {
  if (value instanceof Date) {
    const offset = value.getTimezoneOffset() * 60_000;
    return new Date(value.getTime() - offset).toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const sql = getSql();
  const rows = (await sql`
    select user_id, username, skin_type, birthday, visibility
      from profiles where user_id = ${userId}`) as Record<string, unknown>[];

  const row = rows[0];
  if (!row) return null;

  return {
    userId: row.user_id as string,
    username: row.username as string,
    skinType: row.skin_type as SkinType,
    birthday: asDay(row.birthday),
    visibility: row.visibility as ProfileVisibility,
  };
}

/**
 * Create or update the profile. Nothing else: a new account starts empty.
 *
 * This used to also claim rows still owned by `DEMO_USER`, as a one-time
 * migration from before accounts existed. That handed the first account to
 * sign up whatever the keyless demo build had written — pre-seeded trials it
 * never created — so the claim is gone. Rows written keyless stay on the
 * keyless path.
 */
export async function saveProfile(userId: string, input: ProfileInput): Promise<void> {
  const sql = getSql();
  const username = input.username.trim();

  await sql`insert into profiles (user_id, username, skin_type, birthday, visibility)
      values (${userId}, ${username}, ${input.skinType}::skin_type, ${input.birthday}::date, ${input.visibility}::profile_visibility)
      on conflict (user_id) do update
        set username = excluded.username,
            skin_type = excluded.skin_type,
            birthday = excluded.birthday,
            visibility = excluded.visibility,
            updated_at = now()`;
}

/**
 * Whether this account still needs to finish sign-up.
 *
 * A database failure answers "no". Bouncing a signed-in user to `/welcome`
 * because Neon is unreachable would trap them in a form that cannot save — the
 * same reasoning that makes every other read here degrade rather than throw.
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
  try {
    return (await getProfile(userId)) === null;
  } catch (error) {
    degraded('needsOnboarding', error, 'answering "already onboarded"');
    return false;
  }
}

/**
 * Signed in *and* finished signing up, or a redirect to whichever step is
 * missing. For the screens that create things: a trial filed under an account
 * with no username is a half-made state, and the dashboard redirect alone
 * doesn't catch someone who typed the URL.
 */
export async function requireOnboardedUserId(): Promise<string> {
  const userId = await requireUserId();
  if (clerkConfigured && (await needsOnboarding(userId))) redirect('/welcome');
  return userId;
}
