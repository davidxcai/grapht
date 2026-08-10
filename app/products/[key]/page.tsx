import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { CardGrid, EmptyCard } from '@/components/card-grid';
import { ConcernChips } from '@/components/concern-chips';
import { CommunityTrialCard } from '@/components/community-trial-card';
import { RoutineCard } from '@/components/routine-card';
import { Thumbnail } from '@/components/thumbnail';
import { IngredientTable } from '@/components/ingredient-table';
import { getCommunityProduct, getCommunityProductByCatalogId, type CommunityProduct } from '@/lib/community';
import { getCatalogProduct, type CatalogProductDetail } from '@/lib/catalog';
import { listPublicRoutines, publicRoutinesWithProduct } from '@/lib/routines';
import { formatCount } from '@/lib/format';

/**
 * One product, merging what used to be two separate pages (a confusing split
 * once both existed): the catalog's own identity — image, description,
 * ingredient panel, sourced from our copy of incidecoder — and the
 * community's evidence — who has trialled it, what those trials targeted,
 * the trials themselves. No aggregate verdict and no rating on the community
 * side — averaging outcomes across different faces is the easiest way to
 * fabricate confidence, so the trials speak individually.
 *
 * Keyed by whichever id resolves the product: a catalog UUID when the
 * product has a catalog row (the common case — most trials pick products
 * through the catalog), falling back to the community's brand+name slug for
 * products only ever added by typed name, barcode, or ingredient photo, which
 * have no catalog row at all. A community product that turns out to have a
 * catalog id redirects to the canonical catalog-id URL, so a given product
 * never renders at two different addresses.
 */
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Four columns × four rows before a section starts paginating (components/card-grid.tsx).
const PAGE_SIZE = 16;

type SearchParams = { ongoing?: string; completed?: string };

function buildHref(
  key: string,
  current: SearchParams,
  overrides: Partial<Record<keyof SearchParams, string | null>>,
) {
  const merged = new URLSearchParams();
  const combined: Record<string, string | null | undefined> = { ...current, ...overrides };
  for (const [k, v] of Object.entries(combined)) {
    if (v) merged.set(k, v);
  }
  const qs = merged.toString();
  return qs ? `/products/${key}?${qs}` : `/products/${key}`;
}

function TrialGridPagination({
  page,
  lastPage,
  href,
}: {
  page: number;
  lastPage: number;
  href: (page: number | null) => string;
}) {
  if (lastPage <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between text-sm">
      <Link
        href={href(page > 1 ? page - 1 : null)}
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
        href={href(page + 1)}
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
  );
}

export default async function ProductDetail({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { key } = await params;
  const sp = await searchParams;

  let catalog: CatalogProductDetail | null = null;
  let community: CommunityProduct | null = null;
  let backHref = '/products';
  let backLabel = 'Products';

  if (UUID_RE.test(key)) {
    catalog = await getCatalogProduct(key);
    if (!catalog) notFound();
    community = await getCommunityProductByCatalogId(key);
    backHref = '/catalog';
    backLabel = 'Catalog';
  } else {
    community = await getCommunityProduct(key);
    if (!community) notFound();
    // This product does have a catalog row after all — send the visitor to
    // the canonical catalog-id URL rather than rendering it twice.
    if (community.catalogProductId) redirect(`/products/${community.catalogProductId}`);
  }

  const brand = catalog?.brand ?? community?.brand ?? null;
  const name = catalog?.name ?? community?.name ?? '';
  const image = catalog?.image ?? community?.image ?? null;
  const trials = community?.trials ?? [];

  // Community-wide, like `trials` above — every published routine that
  // carries this product, not just the signed-in viewer's own.
  const routines = publicRoutinesWithProduct(await listPublicRoutines(), {
    catalogProductId: catalog?.id ?? null,
    brand,
    name,
  });
  // Already newest-first: `trials` comes from published rows queried
  // `order by created_at desc` (lib/community.ts), so slicing here keeps new
  // trials on page 1 without re-sorting.
  const completed = trials.filter((t) => t.trial.status === 'completed');
  const ongoing = trials.filter((t) => t.trial.status === 'active');

  const ongoingPage = Math.max(1, Number(sp.ongoing) || 1);
  const ongoingLastPage = Math.max(1, Math.ceil(ongoing.length / PAGE_SIZE));
  const ongoingSlice = ongoing.slice((ongoingPage - 1) * PAGE_SIZE, ongoingPage * PAGE_SIZE);

  const completedPage = Math.max(1, Number(sp.completed) || 1);
  const completedLastPage = Math.max(1, Math.ceil(completed.length / PAGE_SIZE));
  const completedSlice = completed.slice((completedPage - 1) * PAGE_SIZE, completedPage * PAGE_SIZE);

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {backLabel}
      </Link>

      <div className="mt-6 space-y-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_1fr]">
          <Thumbnail src={image} size={340} className="rounded-lg border lg:sticky lg:top-10" />

          <div className="min-w-0 space-y-6">
            <div>
              {brand && <p className="text-sm text-muted-foreground">{brand}</p>}
              <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
              {catalog?.description && (
                <p className="mt-2 text-sm text-muted-foreground">{catalog.description}</p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">
                {community
                  ? `Trialled by ${community.users} ${community.users === 1 ? 'person' : 'people'} in the community · ${trials.length} ${trials.length === 1 ? 'trial' : 'trials'}${community.dosages.length > 0 ? ` · used as ${community.dosages.join(', ')}` : ''}`
                  : 'Not yet trialled by anyone in the community.'}
              </p>
            </div>

            {catalog && catalog.concernTags.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">What its ingredients plausibly target</p>
                <ConcernChips concerns={catalog.concernTags} />
              </div>
            )}

            {community && community.targets.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">What the community watches it for</p>
                <ConcernChips concerns={community.targets} />
              </div>
            )}

            <section>
              <h2 className="text-sm font-medium">
                Ingredients{catalog ? ` (${catalog.ingredientCount})` : ''}
              </h2>
              {!catalog ? (
                <p className="mt-3 text-sm text-muted-foreground">No ingredient panel on file for this product.</p>
              ) : (
                <div className="mt-3">
                  <IngredientTable ingredients={catalog.ingredients} count={catalog.ingredientCount} />
                </div>
              )}
            </section>
          </div>
        </div>

        <section>
          <h2 className="text-lg font-medium">Routines that use this</h2>
          {routines.length === 0 ? (
            <div className="mt-4">
              <CardGrid>
                <EmptyCard href="/routines/new" label="Add to a routine" message="not in any routines yet, be the first" />
              </CardGrid>
            </div>
          ) : (
            <div className="mt-4">
              <CardGrid>
                {routines.map(({ routine, handle }) => (
                  <RoutineCard key={routine.id} routine={routine} handle={handle} />
                ))}
              </CardGrid>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-medium">Trials that use this</h2>
          {trials.length === 0 ? (
            <div className="mt-4 space-y-3">
              <p className="text-center text-sm text-muted-foreground">
                No trial yet. Be the first.
              </p>
              <CardGrid>
                <EmptyCard href="/trials/new" label="Start a trial" />
              </CardGrid>
            </div>
          ) : (
            <>
              {ongoing.length > 0 && (
                <div className="mt-4">
                  <CardGrid>
                    {ongoingSlice.map((entry) => (
                      <CommunityTrialCard key={entry.trial.id} entry={entry} />
                    ))}
                  </CardGrid>
                  <TrialGridPagination
                    page={ongoingPage}
                    lastPage={ongoingLastPage}
                    href={(p) => buildHref(key, sp, { ongoing: p ? String(p) : null })}
                  />
                </div>
              )}

              {completed.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-muted-foreground">Completed</h3>
                  <div className="mt-3">
                    <CardGrid>
                      {completedSlice.map((entry) => (
                        <CommunityTrialCard key={entry.trial.id} entry={entry} />
                      ))}
                    </CardGrid>
                    <TrialGridPagination
                      page={completedPage}
                      lastPage={completedLastPage}
                      href={(p) => buildHref(key, sp, { completed: p ? String(p) : null })}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
