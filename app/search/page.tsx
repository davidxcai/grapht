import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CardGrid } from '@/components/card-grid';
import { TrialCard } from '@/components/trial-card';
import { RoutineCard } from '@/components/routine-card';
import { CatalogProductCard } from '@/components/catalog-product-card';
import { ProductSearch } from '@/components/product-search';
import { CatalogFacets } from '@/components/catalog-facets';
import { CatalogConcernFilter } from '@/components/catalog-concern-filter';
import { CommunityOnlyToggle } from '@/components/community-only-toggle';
import { searchCatalog, catalogProductIdsWithIngredient } from '@/lib/catalog';
import {
  listPublicTrials,
  listCommunityProductIds,
  countProductUsersByCatalogId,
  type PublicTrial,
} from '@/lib/community';
import { listPublicRoutines, type PublicRoutine } from '@/lib/routines';
import { toCardData } from '@/lib/trials';
import { fuzzyRank } from '@/lib/fuzzy';
import { formatCount } from '@/lib/format';

/**
 * The one consolidated search surface (replaces the old three-way split of
 * /catalog, /products and /search): one search box, three tabs — Products,
 * Trials, Routines — and one set of filters (brand, ingredient, concern,
 * "trialled by community") that narrows all three, not just Products.
 *
 * Products come straight from the 183k-row catalog (lib/catalog.ts) via an
 * index-driven query. Trials and routines are a much smaller, in-memory
 * corpus (lib/community.ts, lib/routines.ts) filtered here instead: their
 * items carry brand/targets directly, so brand and concern filtering is a
 * plain in-memory check, but never an ingredient list, so the ingredient
 * facet can only reach a trial/routine through an item's frozen
 * `catalogProductId` — see `ingredientMatchIds` below.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

type SearchParams = {
  q?: string;
  brand?: string;
  brandLabel?: string;
  ingredient?: string;
  ingredientLabel?: string;
  concern?: string;
  community?: string;
  page?: string;
};

function buildHref(current: SearchParams, overrides: Record<string, string | null>) {
  const merged = new URLSearchParams();
  const combined: Record<string, string | null | undefined> = { ...current, ...overrides };
  for (const [key, value] of Object.entries(combined)) {
    if (value) merged.set(key, value);
  }
  const qs = merged.toString();
  return qs ? `/search?${qs}` : '/search';
}

function trialText(entry: PublicTrial): string {
  const products = entry.trial.routine.interventions
    .map((i) => [i.brand, i.name].filter(Boolean).join(' '))
    .join(' ');
  return `${entry.trial.name} ${products} ${entry.handle ?? ''}`;
}

function routineText(entry: PublicRoutine): string {
  const products = entry.routine.items.map((i) => [i.brand, i.name].filter(Boolean).join(' ')).join(' ');
  return `${entry.routine.name} ${products} ${entry.handle ?? ''}`;
}

type ProductItem = { brand?: string | null; targets: string[]; catalogProductId?: string | null };

/** Union of every item's targets — the same "coverage" a routine already
 *  reports (routineCoverage in lib/routines.ts), just computed once per
 *  trial/routine here to test against the selected concerns. */
function coversAllConcerns(items: ProductItem[], concerns: string[]): boolean {
  if (concerns.length === 0) return true;
  const covered = new Set(items.flatMap((i) => i.targets));
  return concerns.every((c) => covered.has(c));
}

/** True when at least one item is simultaneously the selected brand and (if
 *  an ingredient is selected) carries it — a brand+ingredient pair describes
 *  one specific product, so both must land on the same item. */
function hasMatchingItem(items: ProductItem[], brandLabel: string | null, ingredientMatchIds: Set<string> | null): boolean {
  if (!brandLabel && !ingredientMatchIds) return true;
  return items.some((item) => {
    if (brandLabel && (item.brand ?? '').trim().toLowerCase() !== brandLabel.trim().toLowerCase()) return false;
    if (ingredientMatchIds && !(item.catalogProductId && ingredientMatchIds.has(item.catalogProductId))) return false;
    return true;
  });
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
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const trimmed = (params.q ?? '').trim();
  const page = Math.max(1, Number(params.page) || 1);
  const concerns = (params.concern ?? '').split(',').filter(Boolean);
  const brandLabel = params.brandLabel ?? null;
  const communityOnly = params.community === '1';

  const hasFilters = Boolean(
    trimmed || params.brand || params.ingredient || concerns.length > 0 || communityOnly,
  );

  const [communityProductIds, allTrials, allRoutines] = await Promise.all([
    communityOnly ? listCommunityProductIds() : Promise.resolve(null),
    listPublicTrials(),
    listPublicRoutines(),
  ]);

  // A trial/routine item never stores an ingredient list — only its frozen
  // catalogProductId does, so the ingredient facet resolves against the
  // catalog once, over every id either corpus references.
  let ingredientMatchIds: Set<string> | null = null;
  if (params.ingredient) {
    const referencedIds = new Set<string>();
    for (const entry of allTrials) {
      for (const i of entry.trial.routine.interventions) if (i.catalogProductId) referencedIds.add(i.catalogProductId);
    }
    for (const entry of allRoutines) {
      for (const i of entry.routine.items) if (i.catalogProductId) referencedIds.add(i.catalogProductId);
    }
    ingredientMatchIds = await catalogProductIdsWithIngredient([...referencedIds], params.ingredient);
  }

  const { results: products, total: productTotal } = await searchCatalog({
    q: trimmed || null,
    brand: params.brand ?? null,
    concerns,
    ingredientSlug: params.ingredient ?? null,
    productIds: communityProductIds,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const userCounts = await countProductUsersByCatalogId(products.map((p) => p.id));

  function matchesInterventions(items: ProductItem[]): boolean {
    return coversAllConcerns(items, concerns) && hasMatchingItem(items, brandLabel, ingredientMatchIds);
  }

  let trials = allTrials.filter((entry) => matchesInterventions(entry.trial.routine.interventions));
  if (trimmed) trials = fuzzyRank(trimmed, trials, trialText);

  let routines = allRoutines.filter((entry) => matchesInterventions(entry.routine.items));
  if (trimmed) routines = fuzzyRank(trimmed, routines, routineText);

  const lastPage = Math.max(1, Math.ceil(productTotal / PAGE_SIZE));

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      </header>

      <div className="mt-6 space-y-3">
        <ProductSearch placeholder="Search products, trials, routines…" />
        <CatalogFacets />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CatalogConcernFilter />
          <CommunityOnlyToggle active={communityOnly} />
        </div>
      </div>

      <Tabs defaultValue="products" className="mt-6">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="products">Products ({formatCount(productTotal)})</TabsTrigger>
          <TabsTrigger value="trials">Trials ({formatCount(trials.length)})</TabsTrigger>
          <TabsTrigger value="routines">Routines ({formatCount(routines.length)})</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-5">
          {products.length === 0 ? (
            <Empty>{hasFilters ? 'Nothing matches these filters.' : 'The catalog is empty.'}</Empty>
          ) : (
            <>
              <CardGrid>
                {products.map((p) => (
                  <CatalogProductCard key={p.id} product={{ ...p, userCount: userCounts.get(p.id) ?? 0 }} />
                ))}
              </CardGrid>

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
            </>
          )}
        </TabsContent>

        <TabsContent value="trials" className="mt-5">
          {trials.length === 0 ? (
            <Empty>{hasFilters ? 'Nothing matches these filters.' : 'No public trials yet.'}</Empty>
          ) : (
            <CardGrid>
              {trials.map((entry) => (
                <TrialCard key={entry.trial.id} data={toCardData(entry.trial)} handle={entry.handle} />
              ))}
            </CardGrid>
          )}
        </TabsContent>

        <TabsContent value="routines" className="mt-5">
          {routines.length === 0 ? (
            <Empty>{hasFilters ? 'Nothing matches these filters.' : 'No public routines yet.'}</Empty>
          ) : (
            <CardGrid>
              {routines.map((entry) => (
                <RoutineCard key={entry.routine.id} routine={entry.routine} handle={entry.handle} />
              ))}
            </CardGrid>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
