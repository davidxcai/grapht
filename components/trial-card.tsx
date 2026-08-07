import Link from 'next/link';
import { CircleCheck, CircleDashed } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { CompletedBadge } from '@/components/completed-badge';
import { TimeOfDayBadge } from '@/components/time-of-day-badge';
import { ConcernChips } from '@/components/concern-chips';
import { TrialRing } from '@/components/trial-ring';
import { interventionLabel, interventionTargets, type TrialCardData } from '@/lib/trials';

/**
 * The whole dashboard, repeated. Ring, name, what it tracks, today's log state.
 * Everything else is one tap deeper — the homescreen makes no demands.
 *
 * "What it tracks" is both the interventions (signed `+`/`−`, so removals read
 * as removals) and the concerns their `targets[]` union to, as chips — the
 * metrics this trial can actually attribute a change to. Never the baseline's
 * coverage, which is confounded, not tracked.
 */
export function TrialCard({ data }: { data: TrialCardData }) {
  const { trial, dayNumber, totalDays, loggedToday } = data;
  const isCompleted = trial.status === 'completed';
  const targets = interventionTargets(trial);

  return (
    <Link href={`/trials/${trial.id}`} className="group block">
      <Card className="flex-row items-center gap-5 p-5 transition-colors group-hover:bg-accent/40">
        <TrialRing dayNumber={dayNumber} totalDays={totalDays} completed={isCompleted} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h2 className="truncate text-base font-medium">{trial.name}</h2>
            <div className="flex shrink-0 items-center gap-1.5">
              <TimeOfDayBadge timeOfDay={trial.timeOfDay} />
              {isCompleted && <CompletedBadge />}
            </div>
          </div>

          <ul className="mt-1.5 space-y-0.5">
            {trial.routine.interventions.map((i) => (
              <li key={i.name} className="truncate text-sm text-muted-foreground">
                {interventionLabel(i)}
              </li>
            ))}
          </ul>

          {targets.length > 0 && <ConcernChips concerns={targets} className="mt-2" />}

          {!isCompleted && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              {loggedToday ? (
                <>
                  <CircleCheck className="size-3.5 text-[var(--progress)]" aria-hidden />
                  Logged today
                </>
              ) : (
                <>
                  <CircleDashed className="size-3.5" aria-hidden />
                  Not yet logged
                </>
              )}
            </p>
          )}
        </div>
      </Card>
    </Link>
  );
}
