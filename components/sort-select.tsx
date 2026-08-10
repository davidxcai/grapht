'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpDown } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface SortOption {
  value: string;
  label: string;
}

/**
 * A URL-backed sort dropdown for one /search tab. Each tab owns its own query
 * param (`sortProducts`/`sortTrials`/`sortRoutines`) rather than a shared
 * `sort` — the three tabs' sort vocabularies don't overlap (Products sorts
 * hit SQL in `lib/catalog.ts`; Trials/Routines sort the already-loaded
 * community arrays in app/search/page.tsx), so nothing is gained by sharing
 * the param and a shared one would leak an invalid value across tabs when
 * switching.
 */
export function SortSelect({
  param,
  options,
  defaultValue,
  resetsPage = false,
}: {
  param: string;
  options: SortOption[];
  defaultValue: string;
  /** Products' sort touches SQL pagination; Trials/Routines have none. */
  resetsPage?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const value = params.get(param) ?? defaultValue;

  function setSort(next: string) {
    const merged = new URLSearchParams(params.toString());
    if (resetsPage) merged.delete('page');
    if (next === defaultValue) merged.delete(param);
    else merged.set(param, next);
    router.push(merged.size ? `${pathname}?${merged.toString()}` : pathname, { scroll: false });
  }

  return (
    <Select value={value} onValueChange={(next: unknown) => setSort(next as string)}>
      <SelectTrigger size="sm" aria-label="Sort by" className="w-fit">
        <ArrowUpDown className="size-3.5 text-muted-foreground" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
