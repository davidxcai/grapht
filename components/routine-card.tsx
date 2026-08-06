import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { ConcernChips } from '@/components/concern-chips';
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
    <Link href={`/routines/${routine.id}`} className="group block">
      <Card className="gap-3 p-5 transition-colors group-hover:bg-accent/40">
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate text-base font-medium">{routine.name}</h2>
          <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {routine.items.length} {routine.items.length === 1 ? 'product' : 'products'}
            <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </div>
        </div>

        {routine.items.length > 0 && (
          <p className="truncate text-sm text-muted-foreground">
            {routine.items.map((i) => i.name).join(' · ')}
          </p>
        )}

        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Covers</p>
          <ConcernChips concerns={coverage} empty="No metrics tagged yet" />
        </div>
      </Card>
    </Link>
  );
}
