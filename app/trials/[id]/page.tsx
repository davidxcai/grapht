import { notFound } from 'next/navigation';
import { Eye } from 'lucide-react';

import { ApplyCheckIn } from '@/components/apply-check-in';
import { CompletedBadge } from '@/components/completed-badge';
import { SaveTrialButton } from '@/components/save-trial-button';
import { TimeOfDayBadge } from '@/components/time-of-day-badge';
import { TrialComments } from '@/components/trial-comments';
import { TrialDetailTabs } from '@/components/trial-detail-tabs';
import { TrialGauge } from '@/components/trial-gauge';
import { isFixtureTrial, loadTrials } from '@/lib/trial-store';
import {
  getPublicTrial,
  isSaved,
  listComments,
  recordView,
  type TrialComment,
} from '@/lib/community';
import { logRecord, metricChanges } from '@/lib/trial-detail';
import { currentUserId } from '@/lib/auth';

/**
 * The trial detail page — the daily log for the owner, and the published
 * record for everyone else.
 *
 * Two ways in. Your own trials (and the fixture) arrive via `loadTrials()`,
 * exactly as before. Anything else falls through to `getPublicTrial()`, which
 * returns only what its owner deliberately published — so a private trial and
 * a nonexistent one still 404 identically, and "not yours" leaks nothing.
 *
 * A community reader gets the same tabs the owner does, minus every control:
 * no capture slot, no note editing, no End trial, no settings. The one thing
 * their visit changes is the view counter.
 */
export default async function TrialDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  const { trials } = await loadTrials(userId);

  let trial = trials.find((t) => t.id === id);
  let handle: string | null = null;
  let isOwner = trial !== undefined && !isFixtureTrial(trial.id);

  if (!trial) {
    const published = await getPublicTrial(id);
    if (!published) notFound();
    trial = published.trial;
    handle = published.handle;
    isOwner = false;
    await recordView(trial.id, userId);
  }

  const record = logRecord(trial);
  const changes = metricChanges(trial);
  const isCompleted = trial.status === 'completed';
  const canEdit = isOwner;

  const isPublic = trial.visibility === 'public';
  const isSample = isFixtureTrial(trial.id);
  const stored = !isSample;

  // Community trimmings exist only for stored public trials — the sample has
  // no rows to comment on or save, and a private trial has no readers.
  let comments: TrialComment[] = [];
  let saved = false;
  if (stored && isPublic) {
    comments = await listComments(trial.id, userId).catch(() => []);
    if (userId && !isOwner) saved = await isSaved(userId, trial.id).catch(() => false);
  }

  const lastAppliedAt = trial.applications?.[trial.applications.length - 1] ?? null;
  const views = trial.viewCount ?? 0;

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <header className="relative">
        {isCompleted && (
          <div className="absolute right-0 top-0">
            <CompletedBadge />
          </div>
        )}

        {/* The absent denominator is the signal on an open-ended trial — there is
            nothing to count toward, so nothing is invented to count toward. */}
        <TrialGauge
          dayNumber={record.dayNumber}
          totalDays={record.totalDays}
          completed={isCompleted}
        />

        <div className="mt-3 flex items-center justify-center gap-1.5">
          <h1 className="text-center text-2xl font-semibold tracking-tight">{trial.name}</h1>
          <TimeOfDayBadge timeOfDay={trial.timeOfDay} />
        </div>

        {(handle || (isPublic && stored && views > 0)) && (
          <p className="mt-1.5 flex items-center justify-center gap-3 text-sm text-muted-foreground">
            {handle && <span>@{handle}</span>}
            {isPublic && stored && views > 0 && (
              <span className="flex items-center gap-1">
                <Eye className="size-3.5" aria-hidden />
                {views} {views === 1 ? 'view' : 'views'}
              </span>
            )}
          </p>
        )}

        {/* The quick check-in, right under the title (ideas.md): press when the
            routine goes on, and the next photo knows its hours-since. */}
        {canEdit && !isCompleted && (
          <div className="mt-4 flex justify-center">
            <ApplyCheckIn trialId={trial.id} lastAppliedAt={lastAppliedAt} />
          </div>
        )}

        {!isOwner && stored && userId && (
          <div className="mt-4 flex justify-center">
            <SaveTrialButton trialId={trial.id} saved={saved} />
          </div>
        )}
      </header>

      <TrialDetailTabs trial={trial} changes={changes} record={record} canEdit={canEdit} />

      {stored && isPublic && (
        <TrialComments
          trialId={trial.id}
          comments={comments}
          canComment={trial.commentsEnabled !== false}
          signedIn={userId !== null}
          isOwner={isOwner}
        />
      )}
    </main>
  );
}
