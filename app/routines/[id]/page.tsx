import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { RoutineEditor } from '@/components/routine-editor';
import { getRoutine } from '@/lib/routines';

export default async function EditRoutine({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const routine = await getRoutine(id);
  if (!routine) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Edit routine</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Changes apply from now on. Trials already running keep the copy they started with.
      </p>

      <RoutineEditor routine={routine} />
    </main>
  );
}
