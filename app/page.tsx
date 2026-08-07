import Link from 'next/link';
import { Camera, LineChart, ShieldCheck, Users } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CommunityTrialCard } from '@/components/community-trial-card';
import { listPublicTrials } from '@/lib/community';
import { metricChanges } from '@/lib/trial-detail';
import { currentUserId } from '@/lib/auth';
import { cn } from '@/lib/utils';

/**
 * The front door — what Grapht is, shown before it is explained (ideas.md,
 * "homescreen"). The dashboard moved to /dashboard; this page sells the idea
 * to a visitor who has never seen it.
 *
 * The hero graphic is not an illustration: it plots the built-in sample
 * trial's real acne series, because "here is 175 days of one person's face,
 * measured" *is* the pitch. Retrospective only, like everything else — the
 * line ends at the last photo and projects nowhere.
 */
export const dynamic = 'force-dynamic';

function TrendGraphic({
  series,
}: {
  series: { day: number; value: number }[];
}) {
  if (series.length < 2) return null;
  const w = 640;
  const h = 220;
  const pad = 12;
  const days = series[series.length - 1].day || 1;
  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (day: number) => pad + ((w - 2 * pad) * day) / days;
  const y = (value: number) => h - pad - ((h - 2 * pad) * (value - min)) / span;
  const points = series.map((p) => `${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  const first = series[0];

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Acne score across ${days} days of the sample trial`}
      className="w-full"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--progress)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {series.map((p) => (
        <circle key={p.day} cx={x(p.day)} cy={y(p.value)} r="3" fill="var(--progress)" />
      ))}
      <text
        x={x(first.day) + 6}
        y={y(first.value) - 8}
        className="fill-muted-foreground text-[11px]"
      >
        day 1 · {Math.round(first.value)}
      </text>
      <text
        x={x(last.day) - 6}
        y={y(last.value) - 8}
        textAnchor="end"
        className="fill-muted-foreground text-[11px]"
      >
        day {last.day} · {Math.round(last.value)}
      </text>
    </svg>
  );
}

function Step({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Camera;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-2 p-5">
      <Icon className="size-5 text-[var(--progress)]" aria-hidden />
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </Card>
  );
}

export default async function Home() {
  const userId = await currentUserId();
  const publicTrials = await listPublicTrials();

  // The proof section: the most recent finished, published trials.
  const completed = publicTrials.filter((p) => p.trial.status === 'completed').slice(0, 3);

  // The hero chart: the sample trial's own tracked metric, real measurements
  // only — synthetic concerns never make marketing material.
  const sample = publicTrials.find((p) => p.sample)?.trial;
  const tracked = sample
    ? metricChanges(sample).find((m) => m.tracked && !m.synthetic)
    : undefined;

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-14">
      {/* ---- hero ---- */}
      <section className="text-center">
        <h1 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Hold your skincare accountable.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
          Start tracking your skincare products to see if they really work.
        </p>
        <div className="mt-7 flex items-center justify-center gap-2">
          <Link
            href={userId ? '/trials/new' : '/signup'}
            className={buttonVariants({ size: 'lg' })}
          >
            Start a trial
          </Link>
          <Link
            href="/community"
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            Browse trials
          </Link>
        </div>
      </section>

      {/* ---- the graphic: real sample data ---- */}
      {tracked && tracked.series.length >= 2 && (
        <section className="mt-12">
          <Card className="gap-3 p-6">
            <TrendGraphic
              series={tracked.series.map((p) => ({ day: p.day + 1, value: p.value }))}
            />
            <p className="text-center text-xs text-muted-foreground">
              Real data: acne score across {sample!.captures.length} photos of the built-in
              sample trial — one face, one product, {tracked.series[tracked.series.length - 1].day + 1}{' '}
              days.{' '}
              <Link href={`/trials/${sample!.id}`} className="underline underline-offset-2">
                See the whole trial
              </Link>
            </p>
          </Card>
        </section>
      )}

      {/* ---- how it works ---- */}
      <section className="mt-14">
        <div className="grid gap-3 sm:grid-cols-3">
          <Step icon={Camera} title="Log a daily photo">
            One standardised selfie a day. Each photo is scored on fourteen skin metrics by
            facial analysis — acne, texture, redness, pores and more.
          </Step>
          <Step icon={LineChart} title="Watch what changes">
            Skin changes too slowly to see in a mirror. The numbers move where your eyes
            can&rsquo;t, day by day, from your first photo on.
          </Step>
          <Step icon={ShieldCheck} title="Get an honest answer">
            The app knows its own measurement error and never calls a change smaller than
            it. &ldquo;No measurable change&rdquo; is a real result, said plainly.
          </Step>
        </div>
      </section>

      {/* ---- the problem ---- */}
      <section className="mt-14 rounded-xl border px-6 py-8 text-center sm:px-10">
        <h2 className="text-xl font-semibold tracking-tight">
          Reviews tell you the ending. Never the journey.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
          Credible skincare reviews are hard to find — a star rating says nothing about who
          it worked for, how long it took, or what it did along the way. A Grapht trial is
          the whole record: every photo, every measurement, the routine it sat on, and how
          consistently it was logged. You see exactly what someone used and exactly what
          happened to their skin.
        </p>
      </section>

      {/* ---- recent completed trials ---- */}
      {completed.length > 0 && (
        <section className="mt-14">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold tracking-tight">Recently completed</h2>
            <Link
              href="/community"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              All trials →
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {completed.map((entry) => (
              <CommunityTrialCard key={entry.trial.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {/* ---- community ---- */}
      <section className="mt-14 text-center">
        <Users className="mx-auto size-6 text-[var(--progress)]" aria-hidden />
        <h2 className="mt-3 text-xl font-semibold tracking-tight">
          A community of real trials
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
          Watch ongoing trials as they run, search finished ones by product, skin type or
          concern, and save the ones that look like you. When you&rsquo;re ready, run your
          own — that&rsquo;s the standard way to review a product here: with data.
        </p>
        <div className={cn('mt-6 flex justify-center')}>
          <Link href="/community" className={buttonVariants({ variant: 'outline' })}>
            Explore the community
          </Link>
        </div>
      </section>
    </main>
  );
}
