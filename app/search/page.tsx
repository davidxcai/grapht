import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CardGrid } from '@/components/card-grid';
import { CommunityTrialCard } from '@/components/community-trial-card';
import { CatalogProductCard } from '@/components/catalog-product-card';
import { ProductSearch } from '@/components/product-search';
import { searchCatalog, searchCatalogIngredients } from '@/lib/catalog';
import { listPublicTrials, type PublicTrial } from '@/lib/community';
import { fuzzyRank } from '@/lib/fuzzy';
import { formatCount } from '@/lib/format';

/**
 * Global search (ideas.md): one box, three tabs — products, trials,
 * ingredients, in that order, products first since the catalog is the
 * largest and most common thing to look for here. Fuzzy for trials (a small,
 * in-memory corpus); products and ingredients are index-driven catalog
 * queries (lib/catalog.ts) since that table alone is 183k rows. Everything
 * searched here is already public; a private trial is not in the corpus at
 * all, and there's no browse-everything default for products/ingredients —
 * that's what /catalog is for.
 */
export const dynamic = 'force-dynamic';

const RESULT_LIMIT = 24;

function trialText(entry: PublicTrial): string {
  const products = entry.trial.routine.interventions
    .map((i) => [i.brand, i.name].filter(Boolean).join(' '))
    .join(' ');
  return `${entry.trial.name} ${products} ${entry.handle ?? ''}`;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const trimmed = q.trim();

  const [{ results: products, total: productTotal }, ingredients, allTrials] = await Promise.all([
    trimmed ? searchCatalog({ q: trimmed, limit: RESULT_LIMIT }) : Promise.resolve({ results: [], total: 0 }),
    trimmed ? searchCatalogIngredients(trimmed, RESULT_LIMIT) : Promise.resolve([]),
    listPublicTrials(),
  ]);

  const trials = trimmed ? fuzzyRank(trimmed, allTrials, trialText) : allTrials;

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      </header>

      <div className="mt-6">
        <ProductSearch placeholder="Search products, trials, ingredients…" />
      </div>

      <Tabs defaultValue="products" className="mt-6">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="products">Products ({formatCount(productTotal)})</TabsTrigger>
          <TabsTrigger value="trials">Trials ({formatCount(trials.length)})</TabsTrigger>
          <TabsTrigger value="ingredients">Ingredients ({formatCount(ingredients.length)})</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-5">
          {products.length === 0 ? (
            <Empty>{trimmed ? 'No products match.' : 'Start typing to search products.'}</Empty>
          ) : (
            <CardGrid>
              {products.map((p) => (
                <CatalogProductCard key={p.id} product={p} />
              ))}
            </CardGrid>
          )}
        </TabsContent>

        <TabsContent value="trials" className="mt-5">
          {trials.length === 0 ? (
            <Empty>{trimmed ? 'No trials match.' : 'No public trials yet.'}</Empty>
          ) : (
            <CardGrid>
              {trials.map((entry) => (
                <CommunityTrialCard key={entry.trial.id} entry={entry} />
              ))}
            </CardGrid>
          )}
        </TabsContent>

        <TabsContent value="ingredients" className="mt-5">
          {ingredients.length === 0 ? (
            <Empty>{trimmed ? 'No ingredients match.' : 'Start typing to search ingredients.'}</Empty>
          ) : (
            <CardGrid>
              {ingredients.map((ing) => (
                <Link key={ing.slug} href={`/catalog?ingredient=${ing.slug}`} className="group block h-full">
                  <Card className="h-full gap-2 p-5 transition-colors group-hover:bg-slate-100/50">
                    <h2 className="text-base font-medium">{ing.name}</h2>
                    {ing.functions.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5">
                        {ing.functions.slice(0, 4).map((f) => (
                          <li key={f}>
                            <Badge variant="secondary" className="font-normal capitalize">
                              {f}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </Link>
              ))}
            </CardGrid>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
