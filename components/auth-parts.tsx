'use client';

import { useState } from 'react';
import { isClerkAPIResponseError, isReverificationCancelledError } from '@clerk/nextjs/errors';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Structural rather than imported. Clerk's `Errors<T>` is generic over the
 * field set, which differs between sign-in and sign-up, and these two pieces
 * only ever read a message off it.
 */
type ClerkFieldError = { code: string; message: string; longMessage?: string } | null;
type ClerkErrors = { global: { message: string }[] | null };

/**
 * For calls made directly on a resource (`user.updatePassword()`,
 * `emailAddress.attemptVerification()`, …) rather than through `useSignIn` /
 * `useSignUp`, which is the only place Clerk hands back the structured
 * `errors` shape `FieldError` and `FormError` read. Those calls throw
 * instead, so this is the `catch` counterpart.
 */
export function clerkErrorMessage(cause: unknown): string {
  if (isReverificationCancelledError(cause)) return 'Verification cancelled.';
  if (isClerkAPIResponseError(cause)) {
    return cause.errors[0]?.longMessage ?? cause.errors[0]?.message ?? cause.message;
  }
  return cause instanceof Error ? cause.message : 'Something went wrong.';
}

/** Shown when the app is running from fixtures with no Clerk keys set. */
export function AuthUnavailable() {
  return (
    <p className="mt-8 rounded-lg border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">
      Accounts are not configured on this build. The dashboard and the sample
      trial still work without one.
    </p>
  );
}

export function Divider() {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** `longMessage` is the one Clerk writes for an end user. */
export function FieldError({ error }: { error: ClerkFieldError }) {
  if (!error) return null;

  return (
    <p role="alert" className="text-sm text-destructive">
      {error.longMessage ?? error.message}
    </p>
  );
}

/**
 * Anything not tied to a single input: a local objection raised before Clerk
 * was called, or a Clerk error that belongs to no field.
 */
export function FormError({ message, errors }: { message?: string | null; errors: ClerkErrors }) {
  const text = message ?? errors.global?.[0]?.message;
  if (!text) return null;

  return (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  );
}

/**
 * A labelled input with its Clerk field error underneath — the row every auth
 * form is built out of.
 *
 * `children` is for the one field that isn't a plain `Input`: sign-up's
 * password box, which is `PasswordStrengthInput`. Keeping the wrapper here
 * means the four forms cannot drift on spacing, `aria-invalid`, or whether the
 * error is shown at all.
 */
export function AuthField({
  id,
  label,
  error,
  invalid,
  labelSuffix,
  children,
  ...input
}: React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: ClerkFieldError;
  /** For a field Clerk knows nothing about, e.g. "passwords do not match". */
  invalid?: boolean;
  /** Sits opposite the label — login's "Forgot password?" link. */
  labelSuffix?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {labelSuffix ? (
        <div className="flex items-center justify-between">
          <Label htmlFor={id}>{label}</Label>
          {labelSuffix}
        </div>
      ) : (
        <Label htmlFor={id}>{label}</Label>
      )}
      {children ?? (
        <Input
          id={id}
          required
          className="h-10"
          aria-invalid={invalid ?? Boolean(error)}
          {...input}
        />
      )}
      <FieldError error={error ?? null} />
    </div>
  );
}

/** The full-width submit button, spinner and all. */
export function AuthSubmit({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="lg" className="w-full" disabled={busy}>
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

/**
 * "We sent a code to …", the box to type it into, and a resend.
 *
 * Sign-up and password reset both land here and both must behave the same:
 * the code is held locally because it is worth nothing once submitted, and the
 * step itself is derived from the Clerk resource by the caller, so a reload
 * resumes here rather than restarting the flow.
 */
export function EmailCodeStep({
  email,
  busy,
  errors,
  codeError,
  onVerify,
  onResend,
}: {
  email: string;
  busy: boolean;
  errors: ClerkErrors;
  codeError: ClerkFieldError;
  onVerify: (code: string) => void | Promise<void>;
  onResend: () => void;
}) {
  const [code, setCode] = useState('');

  return (
    <div className="mt-8 flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        We sent a code to <span className="text-foreground">{email || 'your email'}</span>.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          void onVerify(code);
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        <AuthField
          id="code"
          name="code"
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          error={codeError}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />

        <FormError errors={errors} />

        <AuthSubmit busy={busy}>Verify</AuthSubmit>
      </form>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mx-auto"
        disabled={busy}
        onClick={onResend}
      >
        Send a new code
      </Button>
    </div>
  );
}
