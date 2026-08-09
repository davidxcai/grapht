import { Card } from '@/components/ui/card';
import { ConcernChips } from '@/components/concern-chips';
import { ProductCard } from '@/components/product-card';
import type { Trial } from '@/lib/trials';
import type { RoutineSnapshot } from '@/lib/routines';

interface Props {
  trial: Trial;
}

/**
 * The routine this trial sits on, as it stood the day the trial started.
 *
 * Shows what a routine card shows — name, how many products, and what it covers
 * — so the routine reads the same here as it does on the dashboard. "Covers" is
 * the only word available: a baseline is acknowledged and never attributed, so
 * these are the metrics whose movement it could already explain.
 */
function RoutineSnapshotCard({ routine }: { routine: RoutineSnapshot }) {
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="truncate text-sm font-medium">{routine.routineName}</h4>
        <span className="shrink-0 text-xs text-muted-foreground">
          {routine.items.length} {routine.items.length === 1 ? 'product' : 'products'}
        </span>
      </div>

      {routine.items.length > 0 && (
        <ul className="space-y-1">
          {routine.items.map((item) => (
            <li key={item.name} className="text-sm text-muted-foreground">
              {item.name}
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Covers</p>
        <ConcernChips concerns={routine.coverage} empty="No metrics tagged" />
      </div>
    </Card>
  );
}

/**
 * What the trial is testing, and what it is sitting on top of.
 *
 * Lives on the Details tab rather than above the tabs: it is how the trial was
 * set up, which is what Details is for, and it stops a fixed block from pushing
 * the photo down on every tab.
 *
 * The baseline is grouped under its routine's frozen name — a snapshot, so the
 * name is whatever the routine was called on the day the trial started.
 */
export function TrialProducts({ trial }: Props) {
  const { interventions, baseline } = trial.routine;

  // A bare string is a product typed straight into the trial; a snapshot is a
  // saved routine, frozen at creation. They are the same section, not the same
  // shape — only the snapshot knows a name, a count, or what it covers.
  const typed = baseline.filter((e): e is string => typeof e === 'string');
  const snapshots = baseline.filter((e): e is RoutineSnapshot => typeof e !== 'string');

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium">Products</h3>
        <div className="mt-2 space-y-2">
          {interventions.map((i) => (
            <ProductCard key={i.name} intervention={i} />
          ))}
        </div>
      </section>

      {/* Said even when empty. A trial started without a routine has nothing
          running underneath it, and silence here reads as a missing panel
          rather than as the fact that there is nothing to confound with. */}
      <section>
        <h3 className="text-sm font-medium">Routine</h3>
        {baseline.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Already in your routine, and not being tested:
          </p>
        )}

        {baseline.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing — this trial isn&rsquo;t sitting on a saved routine.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {snapshots.map((entry) => (
              <RoutineSnapshotCard key={entry.routineId} routine={entry} />
            ))}

            {typed.length > 0 && (
              <ul className="space-y-1">
                {typed.map((name) => (
                  <li key={name} className="text-sm text-muted-foreground">
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
