import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { CONCERNS, concernLabel } from '@/lib/concerns';
import { cn } from '@/lib/utils';

/**
 * Plain server-rendered links toggling `?concern=`, not a client component —
 * unlike the brand/ingredient facets there's nothing to search, just 14 fixed
 * options. `ConcernChips` (components/concern-chips.tsx) is deliberately
 * display-only, so this is a separate, clickable component rather than a
 * reuse.
 */
export function CatalogConcernFilter({
  active,
  buildHref,
}: {
  active: string | null;
  buildHref: (concern: string | null) => string;
}) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {CONCERNS.map((c) => {
        const selected = c === active;
        return (
          <li key={c}>
            <Link href={buildHref(selected ? null : c)} scroll={false}>
              <Badge
                variant={selected ? 'default' : 'secondary'}
                className={cn('cursor-pointer font-normal', selected && 'pr-1.5')}
              >
                {concernLabel(c)}
              </Badge>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
