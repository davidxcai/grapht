import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { ForgotPasswordForm } from '@/components/forgot-password-form';
import { AuthUnavailable } from '@/components/auth-parts';
import { clerkConfigured } from '@/lib/auth';

export const metadata = { title: 'Reset password · Grapht' };

export default async function ForgotPasswordPage() {
  if (clerkConfigured) {
    const { userId } = await auth();
    if (userId) redirect('/dashboard');
  }

  return (
    <main className="mx-auto w-full max-w-sm px-5 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        We&apos;ll email you a code to get back in.
      </p>

      {clerkConfigured ? <ForgotPasswordForm /> : <AuthUnavailable />}
    </main>
  );
}
