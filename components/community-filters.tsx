'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CONCERNS, concernLabel } from '@/lib/concerns';
import { SKIN_TYPES } from '@/lib/profile';

/**
 * The community's filter bar: product text, skin type, concern (ideas.md).
 * State lives in the URL so a filtered view is shareable and survives reload;
 * the page re-renders on the server with the narrowed list.
 */

const ANY = 'any';

export function CommunityFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get('q') ?? '');
  const skin = params.get('skin') ?? ANY;
  const concern = params.get('concern') ?? ANY;

  const apply = (next: { q?: string; skin?: string; concern?: string }) => {
    const merged = {
      q: next.q ?? q,
      skin: next.skin ?? skin,
      concern: next.concern ?? concern,
    };
    const search = new URLSearchParams();
    if (merged.q.trim()) search.set('q', merged.q.trim());
    if (merged.skin !== ANY) search.set('skin', merged.skin);
    if (merged.concern !== ANY) search.set('concern', merged.concern);
    const qs = search.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Debounced text: typing shouldn't fire a navigation per keystroke.
  useEffect(() => {
    const initial = params.get('q') ?? '';
    if (q === initial) return;
    const timer = setTimeout(() => apply({ q }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by product, brand or ingredient…"
          aria-label="Search trials by product"
          className="pl-9"
        />
      </div>

      <Select value={skin} onValueChange={(next: unknown) => apply({ skin: next as string })}>
        <SelectTrigger aria-label="Skin type" className="h-9 sm:w-40">
          <SelectValue>
            {(value: string) => (value === ANY ? 'Any skin type' : `${value} skin`)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectItem value={ANY}>Any skin type</SelectItem>
          {SKIN_TYPES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={concern} onValueChange={(next: unknown) => apply({ concern: next as string })}>
        <SelectTrigger aria-label="Concern" className="h-9 sm:w-40">
          <SelectValue>
            {(value: string) => (value === ANY ? 'Any concern' : concernLabel(value))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectItem value={ANY}>Any concern</SelectItem>
          {CONCERNS.map((c) => (
            <SelectItem key={c} value={c}>
              {concernLabel(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
