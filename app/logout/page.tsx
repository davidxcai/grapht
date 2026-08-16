'use client';

import { useEffect, useState } from 'react';
import { useClerk } from '@clerk/nextjs';

/**
 * The navbar links here rather than rendering a button, so the sign-out runs on
 * arrival. `redirectUrl` reloads the page, which is what re-renders the navbar
 * as signed out.
 *
 * A failed sign-out says so. The redirect is the only signal that it worked, so
 * swallowing the failure left this page reading "Signing out…" forever over a
 * session that was still live — the one outcome a user must not be left
 * guessing about.
 */
export default function Logout() {
  const { signOut } = useClerk();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    signOut({ redirectUrl: '/' }).catch((cause: unknown) => {
      console.error('sign-out failed', cause);
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    });
  }, [signOut]);

  return (
    <main className="mx-auto w-full max-w-sm px-5 py-16">
      {error ? (
        <p className="text-sm text-muted-foreground">
          You are still signed in — signing out failed ({error}). Try again, or close the
          browser to end the session locally.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Signing out…</p>
      )}
    </main>
  );
}
