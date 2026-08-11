import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { ConcernChips } from '@/components/concern-chips';
import { Thumbnail } from '@/components/thumbnail';

/** The subset of `Intervention` this card actually renders — a plain
 *  `Intervention` satisfies this structurally, but so does a still-editing
 *  `ProductDraft` (the new-trial review step), which has no `direction` or
 *  `startedOn` yet. */
export interface ProductCardData {
  name: string;
  brand?: string | null;
  image?: string | null;
  dosage?: string | null;
  targets: string[];
  catalogProductId?: string | null;
}

/**
 * One tracked product: thumbnail on the left, everything else left-aligned on
 * the right — name, brand, the user's own note on it (`dosage` doubles as the
 * only free text a trial attaches to a product), then what it's tracked for.
 * Read-only — for the editable equivalent see `ProductDraftCard`; for the
 * shared image box see `Thumbnail`. Prefer reusing one of these over a new
 * card.
 *
 * Links to `/products/[id]` when `catalogProductId` is set — a typed-name or
 * scanned product has no catalog row to point at, so it renders as a plain,
 * unclickable card instead. Pass `linkable={false}` to suppress that link
 * even when a catalog id exists — the new-trial review step is mid-form, and
 * navigating away there would abandon the in-progress trial (the same reason
 * `RoutineSummary`'s `linkItems` defaults off).
 */
export function ProductCard({
  intervention,
  linkable = true,
}: {
  intervention: ProductCardData;
  linkable?: boolean;
}) {
  const { name, brand, image, dosage, targets, catalogProductId } = intervention;

  const thumbnail = <Thumbnail src={image} size={96} className="w-20 rounded-lg sm:w-24" />;

  const body = (
    <div className="min-w-0 flex-1 space-y-1.5">
      <div>
        <p className="truncate text-sm font-medium">{name}</p>
        {brand && <p className="truncate text-xs text-muted-foreground">{brand}</p>}
      </div>

      {dosage && <p className="text-sm text-muted-foreground">{dosage}</p>}

      <ConcernChips concerns={targets} empty="Nothing tracked" tone="product" />
    </div>
  );

  if (linkable && catalogProductId) {
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
