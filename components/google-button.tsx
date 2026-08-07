'use client';

import { useState } from 'react';
import { useSignIn, useSignUp } from '@clerk/nextjs';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * Both flows are the same redirect. Clerk decides whether a Google account is a
 * sign-in or a sign-up by whether it has seen it before, so `mode` only picks
 * which resource opens the handshake. A returned error means the redirect never
 * started — a success navigates away and nothing here renders again.
 */
export function GoogleButton({ mode }: { mode: 'signIn' | 'signUp' }) {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);

    /** `as const` because sign-in narrows `strategy` to the OAuth literals,
     *  while sign-up takes a plain string. */
    const params = {
      strategy: 'oauth_google',
      redirectUrl: '/dashboard',
      redirectCallbackUrl: '/sso-callback',
    } as const;

    const { error } = mode === 'signIn' ? await signIn.sso(params) : await signUp.sso(params);

    if (error) {
      setError(error.message);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={start}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GoogleMark />}
        Continue with Google
      </Button>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
