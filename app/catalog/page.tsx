import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { ConcernChips } from '@/components/concern-chips';
import { ProductSearch } from '@/components/product-search';
import { CatalogFacets } from '@/components/catalog-facets';
import { CatalogConcernFilter } from '@/components/catalog-concern-filter';
import { searchCatalog, type CatalogSearchResult } from '@/lib/catalog';
import { formatCount } from '@/lib/format';

/**
 * The full incidecoder product catalog (docs/product-identity.md) — browse and
 * search over all 183k rows. Detail pages live at /products/[id] (merged with
 * the community's trial history for the same product, when there is any).
 * Every filter here is index-driven at the scale of the full catalog, so
 * combining name + brand + ingredient + concern stays a plain query, never a
 * scan — see lib/catalog.ts.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

type SearchParams = {
  q?: string;
  brand?: string;
  ingredient?: string;
  concern?: string;
  page?: string;
};

function buildHref(current: SearchParams, overrides: Record<string, string | null>) {
  const merged = new URLSearchParams();
  const combined: Record<string, string | null | undefined> = { ...current, ...overrides };
  for (const [key, value] of Object.entries(combined)) {
    if (value) merged.set(key, value);
  }
  const qs = merged.toString();
  return qs ? `/catalog?${qs}` : '/catalog';
}

function ProductCard({ product }: { product: CatalogSearchResult }) {
  return (
    <Link href={`/products/${product.id}`} className="group block">
      <Card className="flex-row gap-4 overflow-hidden p-0 transition-colors group-hover:bg-slate-100/50 max-sm:flex-col">
        <div className="flex aspect-square shrink-0 items-center justify-center bg-muted max-sm:h-40 max-sm:w-full">
          {product.image ? (
            <Image
              src={product.image}
              alt=""
              width={112}
              height={112}
              unoptimized
              className="size-full object-contain"
            />
          ) : (
            <Package className="size-6 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 py-5 pr-5 max-sm:px-5 max-sm:pt-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {product.brand && <p className="truncate text-xs text-muted-foreground">{product.brand}</p>}
              <h2 className="truncate text-base font-medium">{product.name}</h2>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatCount(product.ingredientCount)} {product.ingredientCount === 1 ? 'ingredient' : 'ingredients'}
            </span>
          </div>
          {product.concernTags.length > 0 && <ConcernChips concerns={product.concernTags.slice(0, 5)} />}
        </div>
      </Card>
    </Link>
  );
}

export default async function Catalog({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const { results, total } = await searchCatalog({
    q: params.q ?? null,
    brand: params.brand ?? null,
    concern: params.concern ?? null,
    ingredientSlug: params.ingredient ?? null,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const hasFilters = Boolean(params.q || params.brand || params.ingredient || params.concern);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatCount(total)} {total === 1 ? 'product' : 'products'}, searchable by name, brand, ingredient, or what
          it targets.
        </p>
      </header>

      <div className="mt-6 space-y-3">
        <ProductSearch placeholder="Search the catalog by name or brand…" />
        <CatalogFacets />
        <CatalogConcernFilter
          active={params.concern ?? null}
          buildHref={(concern) => buildHref(params, { concern: concern ?? null, page: null })}
        />
      </div>

      <div className="mt-6 space-y-3">
        {results.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-14 text-center">
            <Package className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-sm text-muted-foreground">
              {hasFilters ? 'Nothing matches these filters.' : 'The catalog is empty.'}
            </p>
          </div>
        ) : (
          results.map((p) => <ProductCard key={p.id} product={p} />)
        )}
      </div>

      {lastPage > 1 && (
        <nav className="mt-6 flex items-center justify-between text-sm">
          <Link
            href={buildHref(params, { page: page > 1 ? String(page - 1) : null })}
            aria-disabled={page <= 1}
            className={buttonVariants({
              variant: 'outline',
              size: 'sm',
              className: page <= 1 ? 'pointer-events-none opacity-40' : undefined,
            })}
          >
            <ChevronLeft className="size-4" aria-hidden />
            Previous
          </Link>
          <span className="text-muted-foreground">
            Page {page} of {formatCount(lastPage)}
          </span>
          <Link
            href={buildHref(params, { page: String(page + 1) })}
            aria-disabled={page >= lastPage}
            className={buttonVariants({
              variant: 'outline',
              size: 'sm',
              className: page >= lastPage ? 'pointer-events-none opacity-40' : undefined,
            })}
          >
            Next
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </nav>
      )}
    </main>
  );
}
