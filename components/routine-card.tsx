import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { RoutineSummary } from '@/components/routine-summary';
import { routineCoverage, type Routine } from '@/lib/routines';

/**
 * One saved routine, at a glance: what it's called, what's in it, and which
 * metrics it touches.
 *
 * "Covers" is the strongest word available here. A baseline routine is never
 * attributed (docs/trial-model.md), so this cannot read as "improves" or
 * "treats" — these are the metrics whose movement this routine could already
 * explain, which is the opposite of a credit claim.
 */
export function RoutineCard({ routine }: { routine: Routine }) {
  const coverage = routineCoverage(routine);

  return (
    <Link href={`/routines/${routine.id}`} className="group block h-full">
      <Card className="gap-3 p-5 transition-colors group-hover:bg-accent/40 h-full">
        <RoutineSummary
          routine={{ name: routine.name, coverage, items: routine.items }}
          trailing={
            <ChevronRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          }
        />
      </Card>
    </Link>
  );
}
