'use client';

import { useEffect, useState } from 'react';

import { timeGreeting } from '@/lib/greeting';

/**
 * The dashboard heading, greeting by time of day.
 *
 * `initial` is rendered on the server, where the clock is UTC in production —
 * so the effect recomputes it against the reader's own clock once mounted. The
 * prop is what keeps the hydration render matching the markup it hydrates;
 * computing the hour in the state initialiser instead would disagree with the
 * server for everyone outside UTC.
 */
export function Greeting({ initial, name }: { initial: string; name?: string }) {
  const [greeting, setGreeting] = useState(initial);

  useEffect(() => {
    setGreeting(timeGreeting(new Date().getHours()));
  }, []);

  return <>{name ? `${greeting}, ${name}` : greeting}</>;
}
