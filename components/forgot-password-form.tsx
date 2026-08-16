'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSignIn } from '@clerk/nextjs';

import { AuthField, AuthSubmit, EmailCodeStep, FormError } from '@/components/auth-parts';

export function ForgotPasswordForm() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const [email, setEmail] = useState('');
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

  async function onVerify(code: string) {
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
          <AuthField
            id="password"
            type="password"
            name="password"
            label="New password"
            autoComplete="new-password"
            error={errors.fields.password}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setMismatch(null);
            }}
          />

          <AuthField
            id="confirm"
            type="password"
            name="confirm"
            label="Confirm password"
            autoComplete="new-password"
            invalid={Boolean(mismatch)}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setMismatch(null);
            }}
          />

          <FormError message={mismatch} errors={errors} />

          <AuthSubmit busy={busy}>Reset password</AuthSubmit>
        </form>
      </div>
    );
  }

  if (step === 'code') {
    return (
      <EmailCodeStep
        email={email}
        busy={busy}
        errors={errors}
        codeError={errors.fields.code}
        onVerify={onVerify}
        onResend={() => signIn.resetPasswordEmailCode.sendCode()}
      />
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      <form onSubmit={onSendCode} noValidate className="flex flex-col gap-4">
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

        <FormError errors={errors} />

        <AuthSubmit busy={busy}>Send reset code</AuthSubmit>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-foreground underline underline-offset-4">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
