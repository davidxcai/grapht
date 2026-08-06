import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { RoutineEditor } from '@/components/routine-editor';

export default function NewRoutine() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">New routine</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        What you already use, grouped and named. Pick it when you start a trial instead of
        typing it out again.
      </p>

      <RoutineEditor />
    </main>
  );
}
