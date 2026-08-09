import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Package } from 'lucide-react';

import { ConcernChips } from '@/components/concern-chips';
import { getCatalogProduct } from '@/lib/catalog';

/**
 * One catalog product's full detail — the same information incidecoder
 * itself shows, sourced from our own copy. Standard 2-column product page:
 * image on the left, identity + description + concerns + ingredient panel
 * stacked on the right. Separate from /products/[key] (community — a
 * product's trial history); this page has no trials, no ratings, just the
 * identity and the panel.
 */
export const dynamic = 'force-dynamic';

export default async function CatalogProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getCatalogProduct(id);
  if (!product) notFound();

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <Link
        href="/catalog"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Catalog
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,340px)_1fr]">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-white lg:sticky lg:top-10">
          {product.image ? (
            <Image
              src={product.image}
              alt=""
              width={340}
              height={340}
              unoptimized
              className="size-full object-contain"
            />
          ) : (
            <Package className="size-12 text-neutral-300" aria-hidden />
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <div>
            {product.brand && <p className="text-sm text-muted-foreground">{product.brand}</p>}
            <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
            {product.description && (
              <p className="mt-2 text-sm text-muted-foreground">{product.description}</p>
            )}
          </div>

          {product.concernTags.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">What its ingredients plausibly target</p>
              <ConcernChips concerns={product.concernTags} />
            </div>
          )}

          <section>
            <h2 className="text-sm font-medium">Ingredients ({product.ingredientCount})</h2>
            {product.ingredients.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No ingredient panel on file for this product.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Ingredient</th>
                      <th className="px-3 py-2 font-medium">Function</th>
                      <th className="px-3 py-2 font-medium">Irritancy</th>
                      <th className="px-3 py-2 font-medium">Comedogenicity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {product.ingredients.map((ing, i) => (
                      <tr key={`${ing.slug}-${i}`}>
                        <td className="px-3 py-2">{ing.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {ing.functions.length ? ing.functions.join(', ') : '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{ing.irritancy ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{ing.comedogenicity ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
