import { Heart } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface ProductCollectionBadgesProps {
  saved?: boolean;
  inUse?: boolean;
  showLabels?: boolean;
  className?: string;
}

/**
 * Compact status indicators for a product in the signed-in viewer's collection.
 *
 * - A filled heart means the product is saved to My Products.
 * - A blue dot means the product is currently in a routine or trial.
 */
export function ProductCollectionBadges({
  saved = false,
  inUse = false,
  showLabels = false,
  className,
}: ProductCollectionBadgesProps) {
  if (!saved && !inUse) return null;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {saved && (
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          aria-label="Saved to My Products"
        >
          <Heart className="size-3.5 fill-current" fill="currentColor" aria-hidden />
          {showLabels && 'Saved'}
        </span>
      )}
      {inUse && (
        <span
          className="inline-flex items-center gap-1 text-xs font-medium text-primary"
          aria-label="In use"
        >
          <span className="size-2 rounded-full bg-primary" aria-hidden />
          {showLabels && 'In use'}
        </span>
      )}
    </div>
  );
}
