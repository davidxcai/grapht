'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ProductCollectionBadges } from '@/components/product-collection-badges';
import { addToMyProducts, removeFromMyProductsByIdentity } from '@/app/products/actions';
import type { MyProductIdentity } from '@/lib/my-products';

export interface ProductCollectionButtonProps {
  catalogProductId?: string | null;
  brand?: string | null;
  name: string;
  initialSaved: boolean;
  initialInUse: boolean;
}

export function ProductCollectionButton({
  catalogProductId,
  brand,
  name,
  initialSaved,
  initialInUse,
}: ProductCollectionButtonProps) {
  const [saved, setSaved] = useState(initialSaved);
  const [isPending, startTransition] = useTransition();

  const identity: MyProductIdentity = { catalogProductId, brand, name };

  function toggle() {
    startTransition(async () => {
      if (saved) {
        const result = await removeFromMyProductsByIdentity(identity);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setSaved(false);
        toast.success('Removed from My Products');
      } else {
        const result = await addToMyProducts(identity);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setSaved(true);
        toast.success('Added to My Products');
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ProductCollectionBadges saved={saved} inUse={initialInUse} showLabels />
      <Button onClick={toggle} disabled={isPending} variant={saved ? 'outline' : 'default'}>
        {saved ? (
          <>
            <X className="size-4" data-icon="inline-start" aria-hidden />
            Remove
          </>
        ) : (
          <>
            <Plus className="size-4" data-icon="inline-start" aria-hidden />
            Add to My Products
          </>
        )}
      </Button>
    </div>
  );
}
