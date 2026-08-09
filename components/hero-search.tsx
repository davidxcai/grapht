'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { searchHeroProducts } from '@/app/search/actions';
import type { CatalogPickerMatch } from '@/lib/catalog';

/**
 * The homepage search. Debounces into a dropdown of matching catalog
 * products, picking one goes straight to that product's page. It never
 * touches the homepage's own trial feed (ideas.md) — this box only
 * navigates away, either to a product or, on enter/search with nothing
 * picked, to /search, which also covers trials and ingredients.
 */
export function HeroSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<CatalogPickerMatch[]>([]);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) {
      setOptions([]);
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const results = await searchHeroProducts(trimmed);
      if (requestId.current === id) setOptions(results);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  function goToSearchPage() {
    const trimmed = q.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search');
  }

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
          goToSearchPage();
        }}
        className="flex h-12 w-full items-center gap-3 rounded-xl border border-input bg-input/10 px-4 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/20"
      >
        <button type="submit" aria-label="Search" className="shrink-0">
          <Search className="size-5 text-foreground" aria-hidden />
        </button>
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search products, brands, ingredients…"
          aria-label="Search"
          className="h-full flex-1 rounded-none border-0 bg-transparent p-0 text-base focus-visible:ring-0 md:text-base"
        />
      </form>

      {open && q.trim() && options.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md ring-1 ring-foreground/10">
          {options.map((opt) => (
            <li key={opt.id}>
              <Link
                href={`/products/${opt.id}`}
                // Fires before the input's onBlur closes the list.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-accent"
              >
                <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                  {opt.image ? (
                    <Image
                      src={opt.image}
                      alt=""
                      width={32}
                      height={32}
                      unoptimized
                      className="size-full object-cover"
                    />
                  ) : (
                    <Package className="size-3.5 text-muted-foreground" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 truncate">
                  {opt.brand && <span className="text-muted-foreground">{opt.brand} </span>}
                  {opt.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
