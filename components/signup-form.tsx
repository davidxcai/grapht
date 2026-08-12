'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSignUp } from '@clerk/nextjs';

import { GoogleButton } from '@/components/google-button';
import { PasswordStrengthInput } from '@/components/password-strength-input';
import {
  AuthField,
  AuthSubmit,
  Divider,
  EmailCodeStep,
  FormError,
} from '@/components/auth-parts';

export function SignupForm() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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

  async function onVerify(code: string) {
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === 'complete') await finish();
  }

  if (verifying) {
    return (
      <EmailCodeStep
        email={email}
        busy={busy}
        errors={errors}
        codeError={errors.fields.code}
        onVerify={onVerify}
        onResend={() => signUp.verifications.sendEmailCode()}
      />
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      <GoogleButton mode="signUp" />

      <Divider />

      <form onSubmit={onCreate} noValidate className="flex flex-col gap-4">
        <AuthField
          id="email"
          type="email"
          name="email"
          label="Email"
          autoComplete="email"
          error={errors.fields.emailAddress}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <AuthField id="password" label="Password" error={errors.fields.password}>
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
        </AuthField>

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

        {/* Clerk's bot protection mounts here, and sign-up fails without it. */}
        <div id="clerk-captcha" />

        <AuthSubmit busy={busy}>Create account</AuthSubmit>
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
