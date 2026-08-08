import Link from 'next/link';
import { Package } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { ConcernChips } from '@/components/concern-chips';
import { ProductSearch } from '@/components/product-search';
import { listCommunityProducts, type CommunityProduct } from '@/lib/community';
import { fuzzyRank } from '@/lib/fuzzy';
import { formatCount } from '@/lib/format';

/**
 * The product index (ideas.md): everything the community has actually
 * trialled, searchable. A product's page is its evidence — the trials that
 * used it — not a star rating, so this list exists only where trials do.
 */
export const dynamic = 'force-dynamic';

function ProductCard({ product }: { product: CommunityProduct }) {
  return (
    <Link href={`/products/${product.key}`} className="group block">
      <Card className="gap-2 p-5 transition-colors group-hover:bg-accent/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {product.brand && (
              <p className="truncate text-xs text-muted-foreground">{product.brand}</p>
            )}
            <h2 className="truncate text-base font-medium">{product.name}</h2>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatCount(product.trials.length)}{' '}
            {product.trials.length === 1 ? 'trial' : 'trials'}
          </span>
        </div>
        {product.targets.length > 0 && (
          <ConcernChips concerns={product.targets.slice(0, 5)} className="mt-1" />
        )}
      </Card>
    </Link>
  );
}

export default async function Products({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;

  let products = await listCommunityProducts();
  if (q) products = fuzzyRank(q, products, (p) => [p.brand, p.name].filter(Boolean).join(' '));

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every product someone in the community has actually put on trial.
        </p>
      </header>

      <div className="mt-6">
        <ProductSearch />
      </div>

      <div className="mt-6 space-y-3">
        {products.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-14 text-center">
            <Package className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-sm text-muted-foreground">
              {q
                ? 'Nothing matches — nobody has trialled it yet. Be the first.'
                : 'No products yet — they appear here when trials are published.'}
            </p>
            <Link href="/trials/new" className="mt-4 inline-block text-sm underline underline-offset-2">
              Start a trial
            </Link>
          </div>
        ) : (
          products.map((p) => <ProductCard key={p.key} product={p} />)
        )}
      </div>
    </main>
  );
}
