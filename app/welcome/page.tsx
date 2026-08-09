import { redirect } from 'next/navigation';

import { OnboardingStepper } from '@/components/onboarding-stepper';
import { AuthUnavailable } from '@/components/auth-parts';
import { clerkConfigured, requireUserId } from '@/lib/auth';
import { getProfile } from '@/lib/profile-store';

export const metadata = { title: 'Finish signing up · Grapht' };

/** The profile is a live database read. */
export const dynamic = 'force-dynamic';

/**
 * The last step of sign-up, and the only one.
 *
 * Email and Google both land here: Clerk creates the account, and the fields
 * docs/app-ui.md §2 asks for are collected once, afterwards, so there is one
 * implementation rather than one per provider. Writing the row is what marks
 * sign-up finished, which is why `app/page.tsx` sends anyone without one back.
 *
 * **No photo is analysed here, and there is no calibration step.** Both would
 * spend YouCam units per account against a ~468-unit budget, and the cost of
 * skipping is already priced in — the consistency checks in
 * docs/capture-quality.md cannot run until a user has history anyway.
 */
export default async function Welcome() {
  if (!clerkConfigured) {
    return (
      <main className="mx-auto w-full max-w-sm px-5 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Finish signing up</h1>
        <AuthUnavailable />
      </main>
    );
  }

  const userId = await requireUserId();

  /**
   * Already done — arriving here again is a stale link or a back button. An
   * unreachable database answers "not done" and leaves the form up, which fails
   * loudly on save rather than redirecting into a screen that cannot load
   * either.
   */
  const done = await getProfile(userId).catch(() => null);
  if (done) redirect('/profile');

  return (
    <main className="mx-auto w-full max-w-sm px-5 py-16">
      <OnboardingStepper />
    </main>
  );
}
