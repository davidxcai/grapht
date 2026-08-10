import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { ConcernChips } from '@/components/concern-chips';
import { Thumbnail } from '@/components/thumbnail';
import type { Intervention } from '@/lib/trials';

/**
 * One tracked product: thumbnail on the left, everything else left-aligned on
 * the right — name, brand, the user's own note on it (`dosage` doubles as the
 * only free text a trial attaches to a product), then what it's tracked for.
 * Read-only — for the editable equivalent see `ProductDraftCard`; for the
 * homepage's near-identical row see `TrendingProductCard`; for the shared
 * image box see `Thumbnail`. Prefer reusing one of these over a new card.
 *
 * Links to `/products/[id]` only when `catalogProductId` is set — a typed-name
 * or scanned product has no catalog row to point at, so it renders as a plain,
 * unclickable card instead.
 */
export function ProductCard({ intervention }: { intervention: Intervention }) {
  const { name, brand, image, dosage, targets, catalogProductId } = intervention;

  const thumbnail = <Thumbnail src={image} size={96} className="w-20 rounded-lg sm:w-24" />;

  const body = (
    <div className="min-w-0 flex-1 space-y-1.5">
      <div>
        <p className="truncate text-sm font-medium">{name}</p>
        {brand && <p className="truncate text-xs text-muted-foreground">{brand}</p>}
      </div>

      {dosage && <p className="text-sm text-muted-foreground">{dosage}</p>}

      <ConcernChips concerns={targets} empty="Nothing tracked" />
    </div>
  );

  if (catalogProductId) {
    return (
      <Link href={`/products/${catalogProductId}`} className="group block">
        <Card className="flex-row items-start gap-3 p-3 text-left transition-colors group-hover:bg-slate-100/50 sm:p-4">
          {thumbnail}
          {body}
        </Card>
      </Link>
    );
  }

  return (
    <Card className="flex-row items-start gap-3 p-3 text-left sm:p-4">
      {thumbnail}
      {body}
    </Card>
  );
}
