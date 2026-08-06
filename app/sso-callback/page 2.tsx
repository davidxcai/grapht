'use client';

import { HandleSSOCallback } from '@clerk/nextjs';

/**
 * Where Google returns to. The component reads the result off the URL and picks
 * the destination; it renders nothing but may mount a captcha, so it needs a
 * page of its own rather than a redirect.
 */
export default function SSOCallback() {
  return (
    <main className="mx-auto w-full max-w-sm px-5 py-16">
      <p className="text-sm text-muted-foreground">Finishing sign in…</p>

      <HandleSSOCallback
        navigateToApp={({ decorateUrl }) => {
          /** Full load — the root layout reads the session on the server. */
          window.location.href = decorateUrl('/');
        }}
        navigateToSignIn={() => {
          window.location.href = '/login';
        }}
        navigateToSignUp={() => {
          window.location.href = '/signup';
        }}
      />
    </main>
  );
}
