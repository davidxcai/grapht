import { notFound } from 'next/navigation';
import { Eye } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { RoutineEditor } from '@/components/routine-editor';
import { RoutineSummary } from '@/components/routine-summary';
import { getPublicRoutine, getRoutine, routineCoverage } from '@/lib/routines';
import { currentUserId } from '@/lib/auth';

/**
 * The routine screen — the editor for the owner, a read-only page for
 * everyone else, same split as `/trials/[id]`.
 *
 * `currentUserId()` rather than `requireOnboardedUserId()`: a routine can now
 * be published (`RoutineVisibility`, `lib/routines.ts`), which means this
 * route must render for a signed-out visitor too, not force them to `/login`
 * first. `proxy.ts` reflects the same change — `/routines/(.*)` no longer
 * requires an account.
 */
export default async function RoutineDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();

  const owned = userId ? await getRoutine(userId, id) : null;
  if (owned) {
    return (
      <main className="w-full px-5 py-10 lg:px-10">
        <h1 className="text-2xl font-semibold tracking-tight">Edit routine</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes apply from now on. Trials already running keep the copy they started with.
        </p>

        <RoutineEditor routine={owned} />
      </main>
    );
  }

  /** Not yours (or nobody's signed in) — the only other way in is a published
   *  link. Anything else 404s, same as a nonexistent id, so a private routine
   *  never admits it exists. */
  const published = await getPublicRoutine(id);
  if (!published) notFound();

  const { routine, handle } = published;
  const coverage = routineCoverage(routine);

  return (
    <main className="mx-auto w-full max-w-xl px-5 py-10 lg:px-10">
      <Card className="gap-3 p-6">
        <RoutineSummary
          routine={{ name: routine.name, coverage, items: routine.items }}
          as="h1"
          titleClassName="text-2xl"
          linkItems
        />
      </Card>

      {routine.description && (
        <p className="mt-4 text-sm text-muted-foreground">{routine.description}</p>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Eye className="size-3.5" aria-hidden />
        {handle ? `Published by @${handle}` : 'Published routine'} — read-only
      </p>
    </main>
  );
}
