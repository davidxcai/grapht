import { cn } from '@/lib/utils';

/**
 * The shared card container for dashboard tabs (active, completed, routines,
 * saved) — one column on mobile, up to four across on desktop. Change the
 * layout here and it applies everywhere at once.
 */
export function CardGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-1 gap-3 lg:grid-cols-4', className)}>
      {children}
    </div>
  );
}
