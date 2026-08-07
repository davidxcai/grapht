import Link from 'next/link';
import { Eye } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { CompletedBadge } from '@/components/completed-badge';
import { TimeOfDayBadge } from '@/components/time-of-day-badge';
import { ConcernChips } from '@/components/concern-chips';
import { formatCount } from '@/lib/format';
import { interventionLabel, interventionTargets, toCardData } from '@/lib/trials';
import type { PublicTrial } from '@/lib/community';

/**
 * A published trial as the community sees it: whose it is, what it tested,
 * how far it ran, and how many people have looked. Views are the only count on
 * purpose — no hearts to sort a feed against the product's premise.
 */
export function CommunityTrialCard({ entry }: { entry: PublicTrial }) {
  const { trial, handle, skinType } = entry;
  const isCompleted = trial.status === 'completed';
  const targets = interventionTargets(trial);
  const { dayNumber, totalDays, daysLogged } = toCardData(trial);
  const views = trial.viewCount ?? 0;

  return (
    <Link href={`/trials/${trial.id}`} className="group block">
      <Card className="gap-2 p-5 transition-colors group-hover:bg-accent/40">
        <div className="flex items-start justify-between gap-3">
          <h2 className="truncate text-base font-medium">{trial.name}</h2>
          <div className="flex shrink-0 items-center gap-1.5">
            <TimeOfDayBadge timeOfDay={trial.timeOfDay} />
            {isCompleted && <CompletedBadge />}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {handle ? `@${handle}` : 'anonymous'}
          {skinType && ` · ${skinType} skin`}
          {' · '}
          {isCompleted
            ? `${totalDays ?? dayNumber} days`
            : `day ${dayNumber}${totalDays ? ` of ${totalDays}` : ''}`}
          {` · ${daysLogged} logged`}
        </p>

        <ul className="space-y-0.5">
          {trial.routine.interventions.map((i) => (
            <li key={i.name} className="truncate text-sm text-muted-foreground">
              {interventionLabel(i)}
            </li>
          ))}
        </ul>

        {targets.length > 0 && <ConcernChips concerns={targets} className="mt-1" />}

        {views > 0 && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Eye className="size-3.5" aria-hidden />
            {formatCount(views)} {views === 1 ? 'view' : 'views'}
          </p>
        )}
      </Card>
    </Link>
  );
}
