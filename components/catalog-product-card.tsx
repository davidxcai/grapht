import Image from 'next/image';
import Link from 'next/link';
import { Package } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { ConcernChips } from '@/components/concern-chips';
import type { CatalogSearchResult } from '@/lib/catalog';

/**
 * One catalog product as a grid tile — image on top, text below. Distinct
 * from /catalog's own row-style card: that page lists results full-width, this
 * one sits inside CardGrid's four-across layout on /search, where a wide
 * flex-row card would look cramped in a narrow column.
 */
export function CatalogProductCard({ product }: { product: CatalogSearchResult }) {
  return (
    <Link href={`/products/${product.id}`} className="group block h-full">
      <Card className="h-full gap-3 overflow-hidden !bg-white p-0 transition-colors group-hover:bg-accent/40">
        <div className="flex aspect-square items-center justify-center bg-muted">
          {product.image ? (
            <Image
              src={product.image}
              alt=""
              width={160}
              height={160}
              unoptimized
              className="size-full object-contain"
            />
          ) : (
            <Package className="size-8 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2 px-4 pb-4">
          {product.brand && <p className="truncate text-xs text-muted-foreground">{product.brand}</p>}
          <h2 className="truncate text-base font-medium">{product.name}</h2>
          {product.concernTags.length > 0 && <ConcernChips concerns={product.concernTags.slice(0, 3)} />}
        </div>
      </Card>
    </Link>
  );
}
