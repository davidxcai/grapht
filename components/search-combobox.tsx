'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Thumbnail } from '@/components/thumbnail';
import { cn } from '@/lib/utils';

/**
 * A debounced text input backed by a server action, showing a dropdown of
 * matches to pick from. Deliberately not built on the Popover primitive
 * (components/ui/popover.tsx) — a plain absolutely-positioned list is enough
 * here and keeps outside-click/blur handling simple. Generic over `T` so one
 * component serves /search's brand filter, its ingredient filter, and the
 * trial-editor product picker (components/trial-editor.tsx).
 */
export function SearchCombobox<T>({
  search,
  itemKey,
  itemLabel,
  itemImage,
  onSelect,
  placeholder,
  className,
}: {
  search: (q: string) => Promise<T[]>;
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  /** When provided, a thumbnail renders left of the label — used by the
   *  catalog-backed product picker; the plain brand/ingredient filters
   *  (components/catalog-facets.tsx) omit it and stay text-only. */
  itemImage?: (item: T) => string | null;
  onSelect: (item: T) => void;
  placeholder?: string;
  className?: string;
}) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<T[]>([]);
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
      const results = await search(trimmed);
      if (requestId.current === id) setOptions(results);
    }, 250);
    return () => clearTimeout(timer);
  }, [q, search]);

  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="pl-9"
      />
      {open && q.trim() && options.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md ring-1 ring-foreground/10">
          {options.map((opt) => {
            const image = itemImage?.(opt);
            return (
              <li key={itemKey(opt)}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-slate-100/50"
                  // Fires before the input's onBlur closes the list.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(opt);
                    setQ('');
                    setOptions([]);
                    setOpen(false);
                  }}
                >
                  {itemImage && <Thumbnail src={image} size={32} className="size-8 rounded" />}
                  <span className="min-w-0 truncate">{itemLabel(opt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
