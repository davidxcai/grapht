import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { SignupForm } from '@/components/signup-form';
import { AuthUnavailable } from '@/components/auth-parts';
import { clerkConfigured } from '@/lib/auth';

export const metadata = { title: 'Sign up · Grapht' };

export default async function SignupPage() {
  if (clerkConfigured) {
    const { userId } = await auth();
    if (userId) redirect('/');
  }

  return (
    <main className="mx-auto w-full max-w-sm px-5 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign up</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Start a trial and keep every measurement.
      </p>

      {clerkConfigured ? <SignupForm /> : <AuthUnavailable />}
    </main>
  );
}
