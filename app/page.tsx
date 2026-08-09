import { HeroSearch } from '@/components/hero-search';
import { BrandMarquee } from '@/components/brand-marquee';
import { CommunityTrialCard } from '@/components/community-trial-card';
import { TrendingProductCard } from '@/components/trending-product-card';
import { CardGrid } from '@/components/card-grid';
import { listRecentPublicTrials, listTrendingProducts } from '@/lib/community';

const HOME_SECTION_LIMIT = 4;

/**
 * The front door: search over the front of the page, every published trial
 * below it, ongoing and finished (ideas.md). Free to browse signed out —
 * watching someone else's trial run is the pitch for starting your own, so a
 * first-time visitor lands on the trials themselves rather than on a page
 * describing them.
 *
 * The search box never changes what renders here — it only navigates away,
 * to a product page or to /search (components/hero-search.tsx). Ordering is
 * recency; the only count shown is views.
 */
export const dynamic = 'force-dynamic';

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export default async function Home() {
  const [ongoing, completed, trending] = await Promise.all([
    listRecentPublicTrials('active', HOME_SECTION_LIMIT),
    listRecentPublicTrials('completed', HOME_SECTION_LIMIT),
    listTrendingProducts(HOME_SECTION_LIMIT),
  ]);

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <section className="mx-auto flex max-w-2xl flex-col items-center py-12 text-center sm:py-20">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Skincare, Verified.
        </h1>
        <p className="mt-3 text-base text-muted-foreground text-balance sm:text-lg">
          Search thousands of skincare products to see real-world results.
        </p>
        <div className="mt-7 w-full">
          <HeroSearch />
        </div>
      </section>

      <BrandMarquee />

      {trending.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Trending products</h2>
          <CardGrid className="mt-5">
            {trending.map((product) => (
              <TrendingProductCard key={product.key} product={product} />
            ))}
          </CardGrid>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Ongoing</h2>
        {ongoing.length === 0 ? (
          <div className="mt-5">
            <Empty>Nothing to show</Empty>
          </div>
        ) : (
          <CardGrid className="mt-5">
            {ongoing.map((entry) => <CommunityTrialCard key={entry.trial.id} entry={entry} />)}
          </CardGrid>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Completed</h2>
        {completed.length === 0 ? (
          <div className="mt-5">
            <Empty>Nothing to show</Empty>
          </div>
        ) : (
          <CardGrid className="mt-5">
            {completed.map((entry) => <CommunityTrialCard key={entry.trial.id} entry={entry} />)}
          </CardGrid>
        )}
      </section>
    </main>
  );
}
