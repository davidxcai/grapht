import 'server-only';
import { redirect } from 'next/navigation';
import { auth, currentUser } from '@clerk/nextjs/server';

/**
 * Who is asking. Every stored row is scoped to the value `currentUserId()`
 * returns, and the data layer takes it as an argument rather than reaching for
 * it, so a query that forgot to scope is a type error rather than a leak.
 */

export type Session = { userId: string; name: string } | null;

/**
 * False when the app is running from fixtures with no Clerk keys, which is a
 * supported way to run it (BRIEF.md). `ClerkProvider` and the auth screens both
 * check this, because Clerk throws rather than degrading when the key is absent.
 */
export const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * The owner id used by a build with no Clerk keys at all.
 *
 * Such a build has no way to tell one visitor from another, so it behaves as it
 * did before accounts existed: one implicit local owner who can read and write.
 * That is what keeps the keyless demo path complete rather than read-only. With
 * Clerk configured this value is never written again, and rows carrying it stay
 * on the keyless path — no account ever claims them.
 */
export const DEMO_USER = 'local';

/**
 * The signed-in user's id, or null when nobody is signed in.
 *
 * Null is the ordinary signed-out case and callers must handle it: the
 * dashboard renders the reference series for it, and every write refuses.
 */
export async function currentUserId(): Promise<string | null> {
  if (!clerkConfigured) return DEMO_USER;

  try {
    const { userId } = await auth();
    return userId ?? null;
  } catch {
    /** Same deliberate degradation the dashboard applies to Neon: an
     *  unreachable Clerk costs the user their session, never the fixture. */
    return null;
  }
}

/**
 * The signed-in user's id, or a redirect to the login screen.
 *
 * For pages that cannot render anything useful signed out. Server actions use
 * `currentUserId()` and return a refusal instead — a redirect thrown inside an
 * action surfaces to the caller as an error rather than as a navigation.
 */
export async function requireUserId(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) redirect('/login');
  return userId;
}

export async function getSession(): Promise<Session> {
  if (!clerkConfigured) return null;

  try {
    const user = await currentUser();
    if (!user) return null;

    /** Google gives a name; email sign-up gives only an address. The username
     *  from `/welcome` is preferred over both, but it lives in Neon and the
     *  navbar must render with the database down. */
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.primaryEmailAddress?.emailAddress ||
      'Account';

    return { userId: user.id, name };
  } catch {
    return null;
  }
}
