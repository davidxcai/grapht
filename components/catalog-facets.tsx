'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

import { SearchCombobox } from '@/components/search-combobox';
import { Badge } from '@/components/ui/badge';
import { searchBrandsAction, searchIngredientsAction } from '@/app/catalog/actions';
import type { CatalogBrandOption, CatalogIngredientOption } from '@/lib/catalog';

/**
 * The brand and ingredient search facets on /catalog. Each is an independent
 * URL param (`brand`/`brandLabel`, `ingredient`/`ingredientLabel`) — the
 * label rides along in the URL purely so the chip can render without a round
 * trip back to the server to resolve a slug to a display name.
 */
export function CatalogFacets() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const brand = params.get('brand');
  const brandLabel = params.get('brandLabel');
  const ingredient = params.get('ingredient');
  const ingredientLabel = params.get('ingredientLabel');

  function setParams(next: Record<string, string | null>) {
    const merged = new URLSearchParams(params.toString());
    merged.delete('page'); // any facet change resets pagination
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    router.push(merged.size ? `${pathname}?${merged.toString()}` : pathname, { scroll: false });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        {brand ? (
          <Badge variant="secondary" className="h-9 w-fit gap-1.5 rounded-lg px-3 text-sm font-normal">
            Brand: {brandLabel ?? brand}
            <button
              type="button"
              aria-label="Clear brand filter"
              onClick={() => setParams({ brand: null, brandLabel: null })}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </Badge>
        ) : (
          <SearchCombobox<CatalogBrandOption>
            search={searchBrandsAction}
            itemKey={(b) => b.slug}
            itemLabel={(b) => `${b.name} (${b.productCount})`}
            onSelect={(b) => setParams({ brand: b.slug, brandLabel: b.name })}
            placeholder="Filter by brand…"
          />
        )}
      </div>

      <div>
        {ingredient ? (
          <Badge variant="secondary" className="h-9 w-fit gap-1.5 rounded-lg px-3 text-sm font-normal">
            Ingredient: {ingredientLabel ?? ingredient}
            <button
              type="button"
              aria-label="Clear ingredient filter"
              onClick={() => setParams({ ingredient: null, ingredientLabel: null })}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </Badge>
        ) : (
          <SearchCombobox<CatalogIngredientOption>
            search={searchIngredientsAction}
            itemKey={(i) => i.slug}
            itemLabel={(i) => i.name}
            onSelect={(i) => setParams({ ingredient: i.slug, ingredientLabel: i.name })}
            placeholder="Filter by ingredient…"
          />
        )}
      </div>
    </div>
  );
}
