import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { CompletedBadge } from '@/components/completed-badge';
import { TrialDetailTabs } from '@/components/trial-detail-tabs';
import { loadTrials } from '@/lib/trial-store';
import { logRecord, metricChanges } from '@/lib/trial-detail';
import { baselineNames } from '@/lib/trials';

/**
 * The trial detail page — where the daily log actually lives.
 *
 * Everything is computed on the server: the fixture is read off disk and the
 * saved trials come from Neon, both already awaited by `loadTrials()`, which
 * catches the database failure rather than throwing so the reference series
 * renders with no `DATABASE_URL` at all.
 */
export default async function TrialDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trials } = await loadTrials();
  const trial = trials.find((t) => t.id === id);
  if (!trial) notFound();

  const record = logRecord(trial);
  const changes = metricChanges(trial);
  const isCompleted = trial.status === 'completed';

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back
      </Link>

      <div className="mt-6 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{trial.name}</h1>
        {isCompleted && <CompletedBadge />}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        {/* The absent denominator is the signal on an open-ended trial — there is
            nothing to count toward, so nothing is invented to count toward. */}
        Day {record.dayNumber}
        {record.totalDays !== null && ` of ${record.totalDays}`} ·{' '}
        {record.daysLogged} logged
      </p>

      <TrialDetailTabs
        trial={trial}
        changes={changes}
        record={record}
        baselineNames={baselineNames(trial)}
      />
    </main>
  );
}
