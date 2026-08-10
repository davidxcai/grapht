'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { MultiSelect } from '@/components/multi-select';
import { CONCERNS, concernLabel } from '@/lib/concerns';

/**
 * The concern facet on /search: a dropdown of the 15 fixed concerns (nothing
 * to search, unlike the brand/ingredient facets) rather than the always-
 * visible chip list this replaced — same dropdown-plus-removable-badges shape
 * as `ConcernPicker` (components/concern-picker.tsx), just URL-backed instead
 * of local state. Multiple picks AND together — `searchCatalog()`'s
 * `concerns[]` matches a product only if it carries every one selected, and
 * the same list also narrows the Trials/Routines tabs (see
 * app/search/page.tsx).
 */
export function CatalogConcernFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const selected = (params.get('concern') ?? '').split(',').filter(Boolean);

  function setSelected(next: string[]) {
    const merged = new URLSearchParams(params.toString());
    merged.delete('page'); // any facet change resets pagination
    if (next.length > 0) merged.set('concern', next.join(','));
    else merged.delete('concern');
    router.push(merged.size ? `${pathname}?${merged.toString()}` : pathname, { scroll: false });
  }

  const options = CONCERNS.map((concern) => ({ value: concern, label: concernLabel(concern) }));

  return (
    <div className="space-y-2">
      <MultiSelect
        value={selected}
        options={options}
        placeholder="Filter by concern…"
        summary={(v) => `${v.length} concern${v.length === 1 ? '' : 's'}`}
        onChange={setSelected}
        className="w-fit"
      />

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((concern) => (
            <li key={concern}>
              <Badge variant="secondary" className="gap-1 pr-1 font-normal">
                {concernLabel(concern)}
                <button
                  type="button"
                  aria-label={`Remove ${concernLabel(concern)} filter`}
                  className="rounded-full p-0.5 opacity-60 hover:bg-foreground/10 hover:opacity-100"
                  onClick={() => setSelected(selected.filter((c) => c !== concern))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
