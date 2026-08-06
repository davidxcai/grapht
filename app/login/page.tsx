import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { LoginForm } from '@/components/login-form';
import { AuthUnavailable } from '@/components/auth-parts';
import { clerkConfigured } from '@/lib/auth';

export const metadata = { title: 'Log in · Grapht' };

export default async function LoginPage() {
  if (clerkConfigured) {
    const { userId } = await auth();
    if (userId) redirect('/');
  }

  return (
    <main className="mx-auto w-full max-w-sm px-5 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Pick up where your trials left off.</p>

      {clerkConfigured ? <LoginForm /> : <AuthUnavailable />}
    </main>
  );
}
