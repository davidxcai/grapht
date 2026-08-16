'use client';

import Link from 'next/link';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Thumbnail } from '@/components/thumbnail';
import { ConcernChips } from '@/components/concern-chips';
import { ProductCollectionBadges } from '@/components/product-collection-badges';
import type { MyProduct } from '@/lib/my-products';

export function MyProductCard({
  product,
  onRemove,
}: {
  product: MyProduct;
  onRemove: () => void;
}) {
  const href = product.catalogProductId ? `/products/${product.catalogProductId}` : null;

  const card = (
    <Card className="h-full gap-3 overflow-hidden p-0 transition-colors hover:bg-slate-100/50">
      <Thumbnail src={product.image} size={160} />
      <div className="flex min-w-0 flex-col gap-2 px-4 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {product.brand && (
              <p className="truncate text-xs text-muted-foreground">{product.brand}</p>
            )}
            <h3 className="truncate text-base font-medium">{product.name}</h3>
            <ProductCollectionBadges saved inUse={product.inUse} />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove product"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        {product.concernTags.length > 0 && (
          <ConcernChips concerns={product.concernTags.slice(0, 3)} />
        )}
      </div>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="group block h-full">
        {card}
      </Link>
    );
  }

  return card;
}
