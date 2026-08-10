import type { ReactNode } from 'react';

import { ConcernChips } from '@/components/concern-chips';
import { ProductRow } from '@/components/product-row';

export interface RoutineSummaryItem {
  id: string;
  name: string;
  image: string | null;
  catalogProductId: string | null;
}

export interface RoutineSummaryData {
  name: string;
  coverage: string[];
  items: RoutineSummaryItem[];
}

/**
 * A routine's content, at a glance: name, product count, what it covers, and
 * the products themselves with a small image where the catalog has one.
 *
 * Shared by the dashboard's routine card (components/routine-card.tsx, wrapped
 * in a Link) and the new-trial screen's chosen-routine preview
 * (components/trial-editor.tsx, wrapped in a static panel) — the two must
 * render identically since they show the same data, so this is the one place
 * that layout is written.
 */
export function RoutineSummary({
  routine,
  as: Heading = 'h2',
  titleClassName = 'text-base',
  trailing,
  linkItems = false,
}: {
  routine: RoutineSummaryData;
  as?: 'h1' | 'h2' | 'h3';
  titleClassName?: string;
  trailing?: ReactNode;
  /** Opt-in, not opt-out: `RoutineCard` is nested inside its own outer link,
   *  where a per-item link to `/products/[id]` would land inside that `<a>`,
   *  and the trial-editor's chosen-routine preview is mid-form — navigating
   *  away there would drop the in-progress trial. Only the routine's own
   *  standalone page (`app/routines/[id]/page.tsx`) has nothing to lose. */
  linkItems?: boolean;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Heading className={`truncate font-medium ${titleClassName}`}>{routine.name}</Heading>
        <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {routine.items.length} {routine.items.length === 1 ? 'product' : 'products'}
          {trailing}
        </div>
      </div>

      <div>
        <ConcernChips concerns={routine.coverage} empty="No metrics tagged yet" />
      </div>

      {routine.items.length > 0 && (
        <div className="space-y-2">
          {routine.items.map((item) => (
            <ProductRow
              key={item.id}
              name={item.name}
              image={item.image}
              href={linkItems && item.catalogProductId ? `/products/${item.catalogProductId}` : null}
            />
          ))}
        </div>
      )}
    </>
  );
}
