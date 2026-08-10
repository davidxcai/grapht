import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { ConcernChips } from '@/components/concern-chips';
import { Thumbnail } from '@/components/thumbnail';
import { formatCount } from '@/lib/format';
import type { CatalogSearchResult } from '@/lib/catalog';

/**
 * One catalog product as a grid tile — image on top, text below, ingredient
 * count top-right. Used everywhere a catalog product renders in a grid: the
 * Products tab of /search, and any other CardGrid of catalog results. The
 * only card that isn't a row — for those see `ProductCard`, `ProductDraftCard`,
 * and `TrendingProductCard`; the image box itself is `Thumbnail`. Prefer
 * reusing one of these over a new card.
 */
export function CatalogProductCard({ product }: { product: CatalogSearchResult }) {
  return (
    <Link href={`/products/${product.id}`} className="group block h-full">
      <Card className="h-full gap-3 overflow-hidden p-0 transition-colors group-hover:bg-slate-100/50">
        <Thumbnail src={product.image} size={160} />
        <div className="flex min-w-0 flex-col gap-2 px-4 pb-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {product.brand && <p className="truncate text-xs text-muted-foreground">{product.brand}</p>}
              <h2 className="truncate text-base font-medium">{product.name}</h2>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatCount(product.ingredientCount)} {product.ingredientCount === 1 ? 'ingredient' : 'ingredients'}
            </span>
          </div>
          {product.concernTags.length > 0 && <ConcernChips concerns={product.concernTags.slice(0, 3)} />}
        </div>
      </Card>
    </Link>
  );
}
