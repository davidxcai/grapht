import Link from 'next/link';
import { CircleCheck, CircleDashed } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { CompletedBadge } from '@/components/completed-badge';
import { TrialRing } from '@/components/trial-ring';
import { interventionLabel, type TrialCardData } from '@/lib/trials';

/**
 * The whole dashboard, repeated. Ring, name, what it tracks, today's log state.
 * Everything else is one tap deeper — the homescreen makes no demands.
 */
export function TrialCard({ data }: { data: TrialCardData }) {
  const { trial, dayNumber, totalDays, loggedToday } = data;
  const isCompleted = trial.status === 'completed';

  return (
    <Link href={`/trials/${trial.id}`} className="group block">
      <Card className="flex-row items-center gap-5 p-5 transition-colors group-hover:bg-accent/40">
        <TrialRing dayNumber={dayNumber} totalDays={totalDays} completed={isCompleted} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h2 className="truncate text-base font-medium">{trial.name}</h2>
            {isCompleted && <CompletedBadge />}
          </div>

          <ul className="mt-1.5 space-y-0.5">
            {trial.routine.interventions.map((i) => (
              <li key={i.name} className="truncate text-sm text-muted-foreground">
                {interventionLabel(i)}
              </li>
            ))}
          </ul>

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
