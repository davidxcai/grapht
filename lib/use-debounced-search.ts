'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The query/dropdown half of a search box: debounce, drop stale replies, and
 * keep the list open while the field has focus.
 *
 * Shared by the homepage hero search and the generic `SearchCombobox`. The
 * request id is what makes the results trustworthy — a slow first keystroke
 * must not overwrite the answer to a later, narrower one, which is the bug
 * both copies of this were already careful about.
 */
export function useDebouncedSearch<T>(search: (q: string) => Promise<T[]>, delayMs = 250) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);

  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) {
      setOptions([]);
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const results = await search(trimmed);
      if (requestId.current === id) setOptions(results);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [trimmed, search, delayMs]);

  /** After a pick: empty field, no list, nothing stale left to show. */
  function reset() {
    setQuery('');
    setOptions([]);
    setOpen(false);
  }

  return {
    query,
    trimmed,
    options,
    /** Whether the dropdown should render at all. */
    showOptions: open && Boolean(trimmed) && options.length > 0,
    setOpen,
    reset,
    /** Spread onto the input: typing opens the list, blur closes it late
     *  enough for a click on an option to land first. */
    inputProps: {
      value: query,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(event.target.value);
        setOpen(true);
      },
      onFocus: () => setOpen(true),
      onBlur: () => setTimeout(() => setOpen(false), 150),
    },
  };
}
