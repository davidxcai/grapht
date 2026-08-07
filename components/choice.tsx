'use client';

import { cn } from '@/lib/utils';

/**
 * A pill in a single-select row. Same shape as a concern chip, on purpose —
 * the trial editors pick a duration, a schedule and a visibility with the same
 * control the concern picker uses, so a row of options reads as one thing
 * wherever it appears.
 */
export function Choice({
  on,
  children,
  onClick,
  className,
}: {
  on: boolean;
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs transition-colors',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        on
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}
