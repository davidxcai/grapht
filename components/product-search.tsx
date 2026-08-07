'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';

/** URL-backed search box for the product index — same pattern as the
 *  community filters, minus the selects. */
export function ProductSearch({
  placeholder = 'Search products by name or brand…',
}: {
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  useEffect(() => {
    const initial = params.get('q') ?? '';
    if (q === initial) return;
    const timer = setTimeout(() => {
      router.replace(q.trim() ? `${pathname}?q=${encodeURIComponent(q.trim())}` : pathname, {
        scroll: false,
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label="Search products"
        className="pl-9"
      />
    </div>
  );
}
