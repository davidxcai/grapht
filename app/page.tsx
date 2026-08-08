import { HeroSearch } from '@/components/hero-search';
import { CommunityTrialCard } from '@/components/community-trial-card';
import { listPublicTrials, type PublicTrial } from '@/lib/community';
import { fuzzyRank } from '@/lib/fuzzy';

/**
 * The front door: search over the front of the page, every published trial
 * below it, ongoing and finished (ideas.md). Free to browse signed out —
 * watching someone else's trial run is the pitch for starting your own, so a
 * first-time visitor lands on the trials themselves rather than on a page
 * describing them.
 *
 * Ordering is recency; the only count shown is views.
 */
export const dynamic = 'force-dynamic';

function searchableText(entry: PublicTrial): string {
  const products = entry.trial.routine.interventions
    .map((i) => [i.brand, i.name].filter(Boolean).join(' '))
    .join(' ');
  return `${entry.trial.name} ${products}`;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;

  let entries = await listPublicTrials();
  if (q) entries = fuzzyRank(q, entries, searchableText);

  const ongoing = entries.filter((e) => e.trial.status === 'active');
  const completed = entries.filter((e) => e.trial.status === 'completed');
  const filtered = Boolean(q);

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

      <section className="mt-8">
        <h2 className="text-sm font-medium text-foreground/60">Ongoing ({ongoing.length})</h2>
        <div className="mt-5 space-y-3">
          {ongoing.length === 0 ? (
            <Empty>
              {filtered ? 'No ongoing trials match.' : 'No ongoing public trials right now.'}
            </Empty>
          ) : (
            ongoing.map((entry) => <CommunityTrialCard key={entry.trial.id} entry={entry} />)
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-foreground/60">Completed ({completed.length})</h2>
        <div className="mt-5 space-y-3">
          {completed.length === 0 ? (
            <Empty>
              {filtered ? 'No completed trials match.' : 'No completed public trials yet.'}
            </Empty>
          ) : (
            completed.map((entry) => <CommunityTrialCard key={entry.trial.id} entry={entry} />)
          )}
        </div>
      </section>
    </main>
  );
}
