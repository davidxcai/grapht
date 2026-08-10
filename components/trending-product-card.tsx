import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { ConcernChips } from '@/components/concern-chips';
import { Thumbnail } from '@/components/thumbnail';
import { formatCount } from '@/lib/format';
import type { CommunityProduct } from '@/lib/community';

/**
 * One trending product on the homepage: thumbnail on the left, same
 * text-first layout otherwise as `ProductCard`. Falls back to a package icon
 * when the product has no catalog image (typed name, barcode, or ingredient
 * photo).
 */
export function TrendingProductCard({ product }: { product: CommunityProduct }) {
  return (
    <Link href={`/products/${product.catalogProductId ?? product.key}`} className="group block h-full">
      <Card className="flex-row items-start gap-3 p-3 text-left transition-colors group-hover:bg-slate-100/50 h-full sm:p-4">
        <Thumbnail src={product.image} size={96} className="w-20 rounded-lg sm:w-24" />

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
