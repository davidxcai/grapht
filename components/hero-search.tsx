'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';

/**
 * The homepage search. One field across every category — products, brands,
 * ingredients, trials. State lives in the URL so a search is shareable and
 * survives reload; the page re-renders on the server with the narrowed list.
 */
export function HeroSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get('q') ?? '');

  // Debounced: typing shouldn't fire a navigation per keystroke.
  useEffect(() => {
    const initial = params.get('q') ?? '';
    if (q === initial) return;
    const timer = setTimeout(() => {
      const trimmed = q.trim();
      router.replace(trimmed ? `${pathname}?q=${encodeURIComponent(trimmed)}` : pathname, {
        scroll: false,
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    // The icon sits in flow rather than absolutely, so it can never collide
    // with the placeholder; the border and focus ring move to the wrapper.
    <div className="flex h-12 w-full items-center gap-3 rounded-xl border border-input px-4 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
      <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search products, brands, ingredients…"
        aria-label="Search"
        className="h-full flex-1 rounded-none border-0 p-0 text-base focus-visible:ring-0 md:text-base"
      />
    </div>
  );
}
