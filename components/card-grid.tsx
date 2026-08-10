import Link from 'next/link';
import { Plus } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The shared card container for dashboard tabs (active, completed, routines,
 * saved) and /search's result grids — one column on mobile, stepping up to
 * two, three, then four across as the viewport widens. Change the layout here
 * and it applies everywhere at once.
 */
export function CardGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('grid grid-cols-1 gap-3 auto-rows-fr sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4', className)}
    >
      {children}
    </div>
  );
}

/**
 * A dashed-border filler card, sized like any other card in the grid, that
 * doubles as the "add new" action for a section with nothing in it yet —
 * used instead of a plain empty-state paragraph so an empty tab still reads
 * as part of the grid rather than a dead end below it.
 */
export function EmptyCard({ href, label, message }: { href: string; label: string; message?: string }) {
  return (
    <Link
      href={href}
      className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/20 p-5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-slate-100/50 hover:text-foreground"
    >
      <div className="flex items-center justify-center rounded-full bg-primary p-2">
        <Plus className="size-5 text-primary-foreground" aria-hidden />
      </div>
      <div className="text-center">
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
        <p>{label}</p>
      </div>
    </Link>
  );
}
