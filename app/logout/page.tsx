'use client';

import { useEffect } from 'react';
import { useClerk } from '@clerk/nextjs';

/**
 * The navbar links here rather than rendering a button, so the sign-out runs on
 * arrival. `redirectUrl` reloads the page, which is what re-renders the navbar
 * as signed out.
 */
export default function Logout() {
  const { signOut } = useClerk();

  useEffect(() => {
    void signOut({ redirectUrl: '/' });
  }, [signOut]);

  return (
    <main className="mx-auto w-full max-w-sm px-5 py-16">
      <p className="text-sm text-muted-foreground">Signing out…</p>
    </main>
  );
}
