import Image from 'next/image';
import type { ReactNode } from 'react';
import { Package } from 'lucide-react';

import { ConcernChips } from '@/components/concern-chips';

export interface RoutineSummaryItem {
  id: string;
  name: string;
  image: string | null;
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
}: {
  routine: RoutineSummaryData;
  as?: 'h1' | 'h2' | 'h3';
  titleClassName?: string;
  trailing?: ReactNode;
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
        <p className="mb-1.5 text-xs text-muted-foreground">Covers</p>
        <ConcernChips concerns={routine.coverage} empty="No metrics tagged yet" />
      </div>

      {routine.items.length > 0 && (
        <div className="space-y-2">
          {routine.items.map((item) => (
            <div key={item.id} className="flex min-w-0 items-center gap-2">
              <div className="size-10 shrink-0 overflow-hidden rounded bg-muted flex items-center justify-center">
                {item.image ? (
                  <Image
                    src={item.image}
                    alt=""
                    width={40}
                    height={40}
                    unoptimized
                    className="size-full object-cover"
                  />
                ) : (
                  <Package className="size-5 text-muted-foreground" />
                )}
              </div>
              <p className="truncate text-sm text-muted-foreground">{item.name}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
