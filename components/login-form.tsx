'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSignIn } from '@clerk/nextjs';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoogleButton } from '@/components/google-button';
import { Divider, FieldError, FormError } from '@/components/auth-parts';

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
          window.location.href = decorateUrl('/');
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
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            required
            className="h-10"
            aria-invalid={Boolean(errors.fields.identifier)}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <FieldError error={errors.fields.identifier} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            className="h-10"
            aria-invalid={Boolean(errors.fields.password)}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FieldError error={errors.fields.password} />
        </div>

        <FormError message={blocked} errors={errors} />

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Log in
        </Button>
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
