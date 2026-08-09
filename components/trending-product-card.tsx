import Image from 'next/image';
import Link from 'next/link';
import { Package } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { ConcernChips } from '@/components/concern-chips';
import { formatCount } from '@/lib/format';
import type { CommunityProduct } from '@/lib/community';

/**
 * One trending product on the homepage: thumbnail on the left, same
 * text-first layout otherwise. The thumbnail follows `ProductCard`'s
 * language (the trial detail page's "details" tab) — a 1:1 `object-contain`
 * box on a white backdrop, since catalog listing shots aren't square and
 * cropping to fill would cut off the cap or the label. Falls back to a
 * package icon when the product has no catalog image (typed name, barcode,
 * or ingredient photo).
 */
export function TrendingProductCard({ product }: { product: CommunityProduct }) {
  return (
    <Link href={`/products/${product.catalogProductId ?? product.key}`} className="group block h-full">
      <Card className="flex-row items-start gap-3 p-3 text-left transition-colors group-hover:bg-accent/40 h-full sm:p-4">
        <div className="flex aspect-square w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white sm:w-24">
          {product.image ? (
            <Image
              src={product.image}
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

        <div className="min-w-0 flex-1 space-y-2">
          <div className="min-w-0">
            {product.brand && <p className="truncate text-xs text-muted-foreground">{product.brand}</p>}
            <h3 className="truncate text-base font-medium">{product.name}</h3>
          </div>

          <p className="text-xs text-muted-foreground">
            {formatCount(product.trials.length)} {product.trials.length === 1 ? 'trial' : 'trials'} this
            week
          </p>

          {product.targets.length > 0 && (
            <ConcernChips concerns={product.targets.slice(0, 4)} className="mt-1" />
          )}
        </div>
      </Card>
    </Link>
  );
}
