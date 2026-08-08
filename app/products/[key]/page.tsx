import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { ConcernChips } from '@/components/concern-chips';
import { CommunityTrialCard } from '@/components/community-trial-card';
import { getCommunityProduct } from '@/lib/community';

/**
 * One product, and its evidence (ideas.md): who in the community has trialled
 * it, what those trials targeted, and the trials themselves. No aggregate
 * verdict and no rating — averaging outcomes across different faces is the
 * easiest way to fabricate confidence, so the trials speak individually.
 */
export const dynamic = 'force-dynamic';

export default async function ProductDetail({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const product = await getCommunityProduct(key);
  if (!product) notFound();

  const trials = product.trials;
  const completed = trials.filter((t) => t.trial.status === 'completed');
  const ongoing = trials.filter((t) => t.trial.status === 'active');

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <Link
        href="/products"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Products
      </Link>

      <header className="mt-6">
        {product.brand && <p className="text-sm text-muted-foreground">{product.brand}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Trialled by {product.users} {product.users === 1 ? 'person' : 'people'} in the
          community · {trials.length} {trials.length === 1 ? 'trial' : 'trials'}
          {product.dosages.length > 0 && ` · used as ${product.dosages.join(', ')}`}
        </p>
        {product.targets.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-muted-foreground">
              What the community watches it for
            </p>
            <ConcernChips concerns={product.targets} />
          </div>
        )}
      </header>

      {ongoing.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Ongoing ({ongoing.length})</h2>
          <div className="mt-3 space-y-3">
            {ongoing.map((entry) => (
              <CommunityTrialCard key={entry.trial.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Completed ({completed.length})</h2>
          <div className="mt-3 space-y-3">
            {completed.map((entry) => (
              <CommunityTrialCard key={entry.trial.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 border-t pt-6 text-center">
        <p className="text-sm text-muted-foreground">
          Using it yourself? Put it on trial and find out what it actually does.
        </p>
        <Link href="/trials/new" className={`${buttonVariants({ variant: 'outline' })} mt-3`}>
          Start a trial
        </Link>
      </section>
    </main>
  );
}
