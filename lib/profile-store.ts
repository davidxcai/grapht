import 'server-only';
import { redirect } from 'next/navigation';

import { getSql } from '@/lib/db';
import { clerkConfigured, DEMO_USER, requireUserId } from '@/lib/auth';
import type { Profile, ProfileInput, SkinType } from '@/lib/profile';

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
    select user_id, username, skin_type, birthday
      from profiles where user_id = ${userId}`) as Record<string, unknown>[];

  const row = rows[0];
  if (!row) return null;

  return {
    userId: row.user_id as string,
    username: row.username as string,
    skinType: row.skin_type as SkinType,
    birthday: asDay(row.birthday),
  };
}

/**
 * Create or update the profile, and claim anything still owned by `DEMO_USER`.
 *
 * The claim is the one-time migration from before accounts existed. A build with
 * no Clerk keys writes everything as `'local'` — the demo path has to stay
 * writable (BRIEF.md) — so those rows have a real owner waiting for them, and
 * the first account to finish sign-up is it. The `not exists` guard is what
 * makes it one-time: the moment a second profile row exists, the claim matches
 * nothing, forever after.
 *
 * Both statements ride in the transaction that writes the profile, so either the
 * account exists and owns the old rows or neither happened.
 */
export async function saveProfile(userId: string, input: ProfileInput): Promise<void> {
  const sql = getSql();
  const username = input.username.trim();

  await sql.transaction([
    sql`insert into profiles (user_id, username, skin_type, birthday)
        values (${userId}, ${username}, ${input.skinType}::skin_type, ${input.birthday}::date)
        on conflict (user_id) do update
          set username = excluded.username,
              skin_type = excluded.skin_type,
              birthday = excluded.birthday,
              updated_at = now()`,

    // The name guard skips a collision rather than failing the save. It cannot
    // fire on a genuine first sign-up, where the account owns no routines yet —
    // it exists because this statement also runs on a later profile edit, by
    // which time the sole account may have a routine named like an unclaimed
    // one. `routines_user_name_idx` would reject that, and losing a profile edit
    // to it would be absurd.
    sql`update routines r set user_id = ${userId}
         where r.user_id = ${DEMO_USER}
           and not exists (select 1 from profiles where user_id <> ${userId})
           and not exists (select 1 from routines o
                            where o.user_id = ${userId}
                              and lower(o.name) = lower(r.name))`,

    sql`update trials set user_id = ${userId}
         where user_id = ${DEMO_USER}
           and not exists (select 1 from profiles where user_id <> ${userId})`,
  ]);
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
  } catch {
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
