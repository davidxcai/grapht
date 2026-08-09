import { isClerkAPIResponseError, isReverificationCancelledError } from '@clerk/nextjs/errors';

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
