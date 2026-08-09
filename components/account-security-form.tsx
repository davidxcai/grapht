'use client';

import { useState } from 'react';
import { useUser, useReverification } from '@clerk/nextjs';
import type { EmailAddressResource } from '@clerk/shared/types';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { clerkErrorMessage } from '@/components/auth-parts';

/**
 * Email and password both live on Clerk, not in our own tables (`lib/auth.ts`),
 * so these two sections talk to `useUser()` directly rather than through a
 * server action. Each is its own small state machine and fails independently —
 * a broken password change should not block an email change sitting above it.
 */
export function AccountSecurityForm() {
  return (
    <div className="mt-10 space-y-8">
      <Separator />
      <EmailSection />
      <Separator />
      <PasswordSection />
    </div>
  );
}

function EmailSection() {
  const { user } = useUser();
  const updatePrimary = useReverification((emailId: string) =>
    user!.update({ primaryEmailAddressId: emailId }),
  );

  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<EmailAddressResource | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentEmail = user?.primaryEmailAddress?.emailAddress ?? null;

  function reset() {
    setEditing(false);
    setEmail('');
    setPending(null);
    setCode('');
    setError(null);
  }

  async function onSendCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !user) return;

    setBusy(true);
    setError(null);
    try {
      const created = await user.createEmailAddress({ email });
      await created.prepareVerification({ strategy: 'email_code' });
      setPending(created);
    } catch (cause) {
      setError(clerkErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !user || !pending) return;

    setBusy(true);
    setError(null);
    try {
      await pending.attemptVerification({ code });
      const previous = user.primaryEmailAddress;
      await updatePrimary(pending.id);
      // Best-effort: the switch already succeeded, so a stray old address
      // (e.g. still linked to an external account) shouldn't read as a failure.
      if (previous && previous.id !== pending.id) {
        await previous.destroy().catch(() => {});
      }
      toast.success('Email updated');
      reset();
    } catch (cause) {
      setError(clerkErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (pending) await pending.destroy().catch(() => {});
    reset();
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Email</h2>

      {!editing && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">
            {currentEmail ?? 'No email on file'}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Change email
          </Button>
        </div>
      )}

      {editing && !pending && (
        <form onSubmit={onSendCode} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-email">New email</Label>
            <Input
              id="new-email"
              type="email"
              autoComplete="email"
              required
              className="h-10"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Send code
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {pending && (
        <form onSubmit={onVerify} noValidate className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            We sent a code to <span className="text-foreground">{email}</span>.
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email-code">Verification code</Label>
            <Input
              id="email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="h-10"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Verify
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function PasswordSection() {
  const { user } = useUser();
  const updatePassword = useReverification(
    (params: { currentPassword?: string; newPassword: string }) =>
      user!.updatePassword({ ...params, signOutOfOtherSessions: true }),
  );

  const hasPassword = user?.passwordEnabled ?? false;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !user) return;

    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await updatePassword({
        currentPassword: hasPassword ? currentPassword : undefined,
        newPassword,
      });
      toast.success(hasPassword ? 'Password updated' : 'Password set');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (cause) {
      setError(clerkErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Password</h2>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        {hasPassword && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              className="h-10"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="new-password">{hasPassword ? 'New password' : 'Password'}</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            className="h-10"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setError(null);
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            className="h-10"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setError(null);
            }}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" size="sm" className="self-start" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {hasPassword ? 'Update password' : 'Set password'}
        </Button>
      </form>
    </section>
  );
}
