import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CommunityTrialCard } from '@/components/community-trial-card';
import { ProductSearch } from '@/components/product-search';
import { ConcernChips } from '@/components/concern-chips';
import {
  listCommunityProducts,
  listCommunityUsers,
  listPublicTrials,
  type PublicTrial,
} from '@/lib/community';
import { fuzzyRank } from '@/lib/fuzzy';
import { formatCount } from '@/lib/format';

/**
 * Global search (ideas.md): one box, three tabs — trials, products, people, in
 * that order, each with its result count. Fuzzy, so a typo still lands.
 * Everything searched here is already public; a private trial is not in the
 * corpus at all.
 */
export const dynamic = 'force-dynamic';

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

  const [allTrials, allProducts, allUsers] = await Promise.all([
    listPublicTrials(),
    listCommunityProducts(),
    listCommunityUsers(),
  ]);

  const trials = q ? fuzzyRank(q, allTrials, trialText) : allTrials;
  const products = q
    ? fuzzyRank(q, allProducts, (p) => [p.brand, p.name].filter(Boolean).join(' '))
    : allProducts;
  const users = q ? fuzzyRank(q, allUsers, (u) => u.handle) : allUsers;

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      </header>

      <div className="mt-6">
        <ProductSearch placeholder="Search trials, products, people…" />
      </div>

      <Tabs defaultValue="trials" className="mt-6">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="trials">Trials ({formatCount(trials.length)})</TabsTrigger>
          <TabsTrigger value="products">Products ({formatCount(products.length)})</TabsTrigger>
          <TabsTrigger value="users">People ({formatCount(users.length)})</TabsTrigger>
        </TabsList>

        <TabsContent value="trials" className="mt-5 space-y-3">
          {trials.length === 0 ? (
            <Empty>{q ? 'No trials match.' : 'No public trials yet.'}</Empty>
          ) : (
            trials.map((entry) => <CommunityTrialCard key={entry.trial.id} entry={entry} />)
          )}
        </TabsContent>

        <TabsContent value="products" className="mt-5 space-y-3">
          {products.length === 0 ? (
            <Empty>{q ? 'No products match.' : 'No products yet.'}</Empty>
          ) : (
            products.map((p) => (
              <Link key={p.key} href={`/products/${p.key}`} className="group block">
                <Card className="gap-2 p-5 transition-colors group-hover:bg-accent/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {p.brand && (
                        <p className="truncate text-xs text-muted-foreground">{p.brand}</p>
                      )}
                      <h2 className="truncate text-base font-medium">{p.name}</h2>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatCount(p.trials.length)} {p.trials.length === 1 ? 'trial' : 'trials'}
                    </span>
                  </div>
                  {p.targets.length > 0 && (
                    <ConcernChips concerns={p.targets.slice(0, 5)} className="mt-1" />
                  )}
                </Card>
              </Link>
            ))
          )}
        </TabsContent>

        <TabsContent value="users" className="mt-5 space-y-3">
          {users.length === 0 ? (
            <Empty>{q ? 'Nobody matches.' : 'Nobody has published a trial yet.'}</Empty>
          ) : (
            users.map((u) => (
              <Card key={u.handle} className="flex-row items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-base font-medium">@{u.handle}</p>
                  {u.skinType && (
                    <p className="text-xs text-muted-foreground">{u.skinType} skin</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {u.publicTrials} public {u.publicTrials === 1 ? 'trial' : 'trials'}
                </span>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
