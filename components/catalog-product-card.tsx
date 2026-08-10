import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { ConcernChips } from '@/components/concern-chips';
import { Thumbnail } from '@/components/thumbnail';
import type { CatalogSearchResult } from '@/lib/catalog';

/**
 * One catalog product as a grid tile — image on top, text below. Distinct
 * from /catalog's own row-style card: that page lists results full-width, this
 * one sits inside CardGrid's four-across layout on /search, where a wide
 * flex-row card would look cramped in a narrow column. The only card that
 * isn't a row — for those see `ProductCard`, `ProductDraftCard`, and
 * `TrendingProductCard`; the image box itself is `Thumbnail`. Prefer reusing
 * one of these over a new card.
 */
export function CatalogProductCard({ product }: { product: CatalogSearchResult }) {
  return (
    <Link href={`/products/${product.id}`} className="group block h-full">
      <Card className="h-full gap-3 overflow-hidden p-0 transition-colors group-hover:bg-slate-100/50">
        <Thumbnail src={product.image} size={160} />
        <div className="flex min-w-0 flex-col gap-2 px-4 pb-4">
          {product.brand && <p className="truncate text-xs text-muted-foreground">{product.brand}</p>}
          <h2 className="truncate text-base font-medium">{product.name}</h2>
          {product.concernTags.length > 0 && <ConcernChips concerns={product.concernTags.slice(0, 3)} />}
        </div>
      </Card>
    </Link>
  );
}
