import { currentUser } from '@clerk/nextjs/server';

/**
 * The navbar is the only consumer — everything downstream takes `session` as a
 * prop and does not care where it came from.
 */
export type Session = { name: string } | null;

/**
 * False when the app is running from fixtures with no Clerk keys, which is a
 * supported way to run it (BRIEF.md). `ClerkProvider` and the auth screens both
 * check this, because Clerk throws rather than degrading when the key is absent.
 */
export const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export async function getSession(): Promise<Session> {
  if (!clerkConfigured) return null;

  try {
    const user = await currentUser();
    if (!user) return null;

    /** Google gives a name; email sign-up gives only an address. */
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.primaryEmailAddress?.emailAddress ||
      'Account';

    return { name };
  } catch {
    /** Same deliberate degradation the dashboard applies to Neon: a signed-out
     *  navbar costs the user their session, never the reference series. */
    return null;
  }
}
