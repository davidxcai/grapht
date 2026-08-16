'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSignIn } from '@clerk/nextjs';

import { GoogleButton } from '@/components/google-button';
import { AuthField, AuthSubmit, Divider, FormError } from '@/components/auth-parts';

export function LoginForm() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [blocked, setBlocked] = useState<string | null>(null);

  const busy = fetchStatus === 'fetching';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBlocked(null);

    await signIn.password({ emailAddress: email, password });

    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: ({ decorateUrl }) => {
          /**
           * A full load rather than `router.push`. The root layout reads the
           * session on the server, and a client navigation would leave the
           * navbar showing the signed-out links until the next reload.
           */
          window.location.href = decorateUrl('/dashboard');
        },
      });
      return;
    }

    /**
     * Reachable once a second factor or device trust is switched on in the
     * Clerk dashboard — neither has a UI here yet, so say so rather than
     * leaving the button looking dead.
     */
    if (signIn.status === 'needs_second_factor' || signIn.status === 'needs_client_trust') {
      setBlocked('This account needs a second verification step, which is not set up yet.');
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      <GoogleButton mode="signIn" />

      <Divider />

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <AuthField
          id="email"
          type="email"
          name="email"
          label="Email"
          autoComplete="email"
          error={errors.fields.identifier}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <AuthField
          id="password"
          type="password"
          name="password"
          label="Password"
          autoComplete="current-password"
          error={errors.fields.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          labelSuffix={
            <Link
              href="/forgot-password"
              className="text-sm text-muted-foreground underline underline-offset-4"
            >
              Forgot password?
            </Link>
          }
        />

        <FormError message={blocked} errors={errors} />

        <AuthSubmit busy={busy}>Log in</AuthSubmit>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        No account?{' '}
        <Link href="/signup" className="text-foreground underline underline-offset-4">
          Sign up
        </Link>
      </p>
    </div>
  );
}
