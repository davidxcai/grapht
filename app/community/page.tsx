import Link from 'next/link';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CommunityFilters } from '@/components/community-filters';
import { CommunityTrialCard } from '@/components/community-trial-card';
import { listPublicTrials, type PublicTrial } from '@/lib/community';
import { interventionTargets } from '@/lib/trials';
import { fuzzyRank } from '@/lib/fuzzy';

/**
 * The community: every published trial, ongoing and finished (ideas.md). Free
 * to browse signed out — watching someone else's trial run is the pitch for
 * starting your own.
 *
 * Filters narrow by product text (fuzzy), the owner's skin type, and the
 * concerns a trial tracks. Ordering is recency; the only count shown is views.
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

export default async function Community({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; skin?: string; concern?: string }>;
}) {
  const { q = '', skin = '', concern = '' } = await searchParams;

  let entries = await listPublicTrials();
  if (skin) entries = entries.filter((e) => e.skinType === skin);
  if (concern) entries = entries.filter((e) => interventionTargets(e.trial).includes(concern));
  if (q) entries = fuzzyRank(q, entries, searchableText);

  const ongoing = entries.filter((e) => e.trial.status === 'active');
  const completed = entries.filter((e) => e.trial.status === 'completed');
  const filtered = Boolean(q || skin || concern);

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Community</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Real trials, in full — every photo, every measurement, and what it sat on. Also
          browsable{' '}
          <Link href="/products" className="underline underline-offset-2">
            by product
          </Link>
          .
        </p>
      </header>

      <div className="mt-6">
        <CommunityFilters />
      </div>

      <Tabs defaultValue="ongoing" className="mt-6">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="ongoing">Ongoing ({ongoing.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="ongoing" className="mt-5 space-y-3">
          {ongoing.length === 0 ? (
            <Empty>
              {filtered ? 'No ongoing trials match.' : 'No ongoing public trials right now.'}
            </Empty>
          ) : (
            ongoing.map((entry) => <CommunityTrialCard key={entry.trial.id} entry={entry} />)
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-5 space-y-3">
          {completed.length === 0 ? (
            <Empty>
              {filtered ? 'No completed trials match.' : 'No completed public trials yet.'}
            </Empty>
          ) : (
            completed.map((entry) => <CommunityTrialCard key={entry.trial.id} entry={entry} />)
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
