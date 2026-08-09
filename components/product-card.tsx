import Image from 'next/image';
import Link from 'next/link';
import { Package } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { ConcernChips } from '@/components/concern-chips';
import type { Intervention } from '@/lib/trials';

/**
 * One tracked product: thumbnail on the left, everything else left-aligned on
 * the right — name, brand, the user's own note on it (`dosage` doubles as the
 * only free text a trial attaches to a product), then what it's tracked for.
 *
 * The thumbnail is `object-contain` on a white backdrop rather than `cover`:
 * these are catalog listing shots (bottle, tube, jar) at whatever aspect ratio
 * the manufacturer used, and cropping to fill the square would cut off the cap
 * or the label. White rather than transparent because most listing shots are
 * already shot on white, so an unmatched backdrop reads as a rendering bug
 * only on the minority that aren't.
 *
 * Links to `/products/[id]` only when `catalogProductId` is set — a typed-name
 * or scanned product has no catalog row to point at, so it renders as a plain,
 * unclickable card instead.
 */
export function ProductCard({ intervention }: { intervention: Intervention }) {
  const { name, brand, image, dosage, targets, catalogProductId } = intervention;

  const thumbnail = (
    <div className="flex aspect-square w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white sm:w-24">
      {image ? (
        <Image
          src={image}
          alt=""
          width={96}
          height={96}
          unoptimized
          className="size-full object-contain"
        />
      ) : (
        <Package className="size-8 text-neutral-300" aria-hidden />
      )}
    </div>
  );

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
        <Card className="flex-row items-start gap-3 p-3 text-left transition-colors group-hover:bg-accent/40 sm:p-4">
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
