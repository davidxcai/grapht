import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { ProfileForm } from '@/components/profile-form';
import { AuthUnavailable } from '@/components/auth-parts';
import { clerkConfigured, getSession, requireUserId } from '@/lib/auth';
import { getProfile } from '@/lib/profile-store';

export const metadata = { title: 'Profile · Grapht' };

/** The profile is a live database read. */
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  if (!clerkConfigured) {
    return (
      <main className="mx-auto w-full max-w-sm px-5 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <AuthUnavailable />
      </main>
    );
  }

  const userId = await requireUserId();
  const session = await getSession();

  let profile;
  try {
    profile = await getProfile(userId);
  } catch (error) {
    return (
      <main className="mx-auto w-full max-w-sm px-5 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-8 rounded-lg border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">
          Your profile is unavailable — {(error as Error).message}
        </p>
      </main>
    );
  }

  /** Signed in but never finished — the same form, under its own heading. */
  if (!profile) redirect('/welcome');

  return (
    <main className="mx-auto w-full max-w-sm px-5 py-16">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Profile</h1>
      {session && <p className="mt-1 text-sm text-muted-foreground">{session.name}</p>}

      <ProfileForm
        mode="profile"
        initial={{
          username: profile.username,
          skinType: profile.skinType,
          birthday: profile.birthday,
        }}
      />
    </main>
  );
}
