'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { SearchCombobox } from '@/components/search-combobox';
import { MyProductCard } from '@/components/my-product-card';
import { CardGrid } from '@/components/card-grid';
import {
  addToMyProducts,
  removeFromMyProducts,
  searchCatalogForMyProducts,
} from '@/app/products/actions';
import type { MyProduct } from '@/lib/my-products';
import type { CatalogPickerMatch } from '@/lib/catalog';

function EmptyMyProducts({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export interface MyProductsSectionProps {
  initialProducts: MyProduct[];
  error: string | null;
}

export function MyProductsSection({ initialProducts, error }: MyProductsSectionProps) {
  const [products, setProducts] = useState(initialProducts);
  const [, startTransition] = useTransition();

  function handleAdd(match: CatalogPickerMatch) {
    startTransition(async () => {
      const result = await addToMyProducts({
        catalogProductId: match.id,
        brand: match.brand,
        name: match.name,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setProducts((prev) => [
        result.data.product,
        ...prev.filter((p) => p.id !== result.data.product.id),
      ]);
      toast.success('Added to My Products');
    });
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      const result = await removeFromMyProducts(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setProducts((prev) => prev.filter((p) => p.id !== id));
      toast.success('Removed');
    });
  }

  if (error) {
    return <EmptyMyProducts>{error}</EmptyMyProducts>;
  }

  return (
    <section className="mt-10 space-y-4">
      <h2 className="text-lg font-semibold">My Products</h2>
      <div className="max-w-md">
        <SearchCombobox
          search={searchCatalogForMyProducts}
          itemKey={(m) => m.id}
          itemLabel={(m) => (m.brand ? `${m.name} — ${m.brand}` : m.name)}
          itemImage={(m) => m.image}
          onSelect={handleAdd}
          placeholder="Search products to add..."
        />
      </div>
      {products.length === 0 ? (
        <EmptyMyProducts>Start by searching for a product above.</EmptyMyProducts>
      ) : (
        <CardGrid>
          {products.map((p) => (
            <MyProductCard key={p.id} product={p} onRemove={() => handleRemove(p.id)} />
          ))}
        </CardGrid>
      )}
    </section>
  );
}
