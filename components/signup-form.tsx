'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSignUp } from '@clerk/nextjs';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoogleButton } from '@/components/google-button';
import { PasswordStrengthInput } from '@/components/password-strength-input';
import { Divider, FieldError, FormError } from '@/components/auth-parts';

export function SignupForm() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [mismatch, setMismatch] = useState<string | null>(null);

  const busy = fetchStatus === 'fetching';

  /**
   * Clerk drives the step, not a local flag: the account exists the moment
   * `password()` succeeds, so a reload during verification has to resume at the
   * code rather than trying to create the account a second time.
   */
  const verifying =
    signUp.unverifiedFields.includes('email_address') && signUp.missingFields.length === 0;

  async function finish() {
    await signUp.finalize({
      navigate: ({ decorateUrl }) => {
        /** Full load — the root layout reads the session on the server. */
        window.location.href = decorateUrl('/dashboard');
      },
    });
  }

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    if (password !== confirm) {
      setMismatch('Passwords do not match.');
      return;
    }
    setMismatch(null);

    const { error } = await signUp.password({ emailAddress: email, password });
    if (!error) await signUp.verifications.sendEmailCode();
  }

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === 'complete') await finish();
  }

  if (verifying) {
    return (
      <div className="mt-8 flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">
          We sent a code to <span className="text-foreground">{email || 'your email'}</span>.
        </p>

        <form onSubmit={onVerify} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Verification code</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="h-10"
              aria-invalid={Boolean(errors.fields.code)}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <FieldError error={errors.fields.code} />
          </div>

          <FormError errors={errors} />

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Verify
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mx-auto"
          disabled={busy}
          onClick={() => signUp.verifications.sendEmailCode()}
        >
          Send a new code
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      <GoogleButton mode="signUp" />

      <Divider />

      <form onSubmit={onCreate} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            required
            className="h-10"
            aria-invalid={Boolean(errors.fields.emailAddress)}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <FieldError error={errors.fields.emailAddress} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <PasswordStrengthInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
            className="h-10"
            aria-invalid={Boolean(errors.fields.password)}
            value={password}
            userInputs={email ? [email] : undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              setMismatch(null);
            }}
          />
          <FieldError error={errors.fields.password} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            name="confirm"
            autoComplete="new-password"
            required
            className="h-10"
            aria-invalid={Boolean(mismatch)}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setMismatch(null);
            }}
          />
        </div>

        <FormError message={mismatch} errors={errors} />

        {/* Clerk's bot protection mounts here, and sign-up fails without it. */}
        <div id="clerk-captcha" />

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Create account
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="text-foreground underline underline-offset-4">
          Log in
        </Link>
      </p>
    </div>
  );
}
