'use client';

import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

/**
 * Where Google returns to. The component reads the result off the URL and picks
 * the destination itself, so it takes routes rather than callbacks. It renders
 * nothing but may mount a captcha, which is why this is a page and not a
 * redirect.
 *
 * `HandleSSOCallback` is the newer equivalent, but `@clerk/react` exports it and
 * `@clerk/nextjs` does not re-export it at runtime — this is the one the Next
 * SDK ships.
 */
export default function SSOCallback() {
  return (
    <main className="mx-auto w-full max-w-sm px-5 py-16">
      <p className="text-sm text-muted-foreground">Finishing sign in…</p>

      <AuthenticateWithRedirectCallback
        signInUrl="/login"
        signUpUrl="/signup"
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
        continueSignUpUrl="/signup"
      />
    </main>
  );
}
