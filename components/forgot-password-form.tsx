'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSignIn } from '@clerk/nextjs';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError, FormError } from '@/components/auth-parts';

export function ForgotPasswordForm() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState<string | null>(null);

  const busy = fetchStatus === 'fetching';

  /**
   * Mirrors the sign-up form's approach: the step is derived from the
   * resource rather than tracked locally, so a reload resumes where it left
   * off instead of restarting the flow.
   */
  const step =
    signIn.status === 'needs_new_password'
      ? 'password'
      : signIn.identifier
        ? 'code'
        : 'email';

  async function onSendCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const { error } = await signIn.create({ identifier: email });
    if (!error) await signIn.resetPasswordEmailCode.sendCode();
  }

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    await signIn.resetPasswordEmailCode.verifyCode({ code });
  }

  async function onSubmitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    if (password !== confirm) {
      setMismatch('Passwords do not match.');
      return;
    }
    setMismatch(null);

    const { error } = await signIn.resetPasswordEmailCode.submitPassword({ password });
    if (!error && signIn.status === 'complete') {
      await signIn.finalize({
        navigate: ({ decorateUrl }) => {
          /** Full load — the root layout reads the session on the server. */
          window.location.href = decorateUrl('/dashboard');
        },
      });
    }
  }

  if (step === 'password') {
    return (
      <div className="mt-8 flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">Choose a new password for your account.</p>

        <form onSubmit={onSubmitPassword} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              className="h-10"
              aria-invalid={Boolean(errors.fields.password)}
              value={password}
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

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Reset password
          </Button>
        </form>
      </div>
    );
  }

  if (step === 'code') {
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
          onClick={() => signIn.resetPasswordEmailCode.sendCode()}
        >
          Send a new code
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      <form onSubmit={onSendCode} noValidate className="flex flex-col gap-4">
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

        <FormError errors={errors} />

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Send reset code
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-foreground underline underline-offset-4">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
