import { notFound } from 'next/navigation';

import { RoutineEditor } from '@/components/routine-editor';
import { getRoutine } from '@/lib/routines';
import { requireOnboardedUserId } from '@/lib/profile-store';

export default async function EditRoutine({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireOnboardedUserId();

  /** Someone else's routine 404s rather than saying it exists. */
  const routine = await getRoutine(userId, id);
  if (!routine) notFound();

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <h1 className="text-2xl font-semibold tracking-tight">Edit routine</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Changes apply from now on. Trials already running keep the copy they started with.
      </p>

      <RoutineEditor routine={routine} />
    </main>
  );
}
