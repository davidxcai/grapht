import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Eye, Pencil } from 'lucide-react';

import { ApplyCheckIn } from '@/components/apply-check-in';
import { Button } from '@/components/ui/button';
import { CompletedBadge } from '@/components/completed-badge';
import { SaveTrialButton } from '@/components/save-trial-button';
import { TimeOfDayBadge } from '@/components/time-of-day-badge';
import { TrialComments } from '@/components/trial-comments';
import { TrialDetailTabs } from '@/components/trial-detail-tabs';
import { TrialGauge } from '@/components/trial-gauge';
import { TrialPhotosVisibilityToggle } from '@/components/trial-photos-visibility-toggle';
import { TrialVisibilityToggle } from '@/components/trial-visibility-toggle';
import { getFixtureTrials, isFixtureTrial, loadTrials } from '@/lib/trial-store';
import {
  getPublicTrial,
  isSaved,
  listComments,
  recordView,
  type TrialComment,
} from '@/lib/community';
import { catalogProductImages } from '@/lib/catalog';
import { logRecord, metricChanges } from '@/lib/trial-detail';
import { isInconclusive } from '@/lib/trials';
import { currentUserId } from '@/lib/auth';
import type { RoutineSnapshot } from '@/lib/routines';

/**
 * The trial detail page — the daily log for the owner, and the published
 * record for everyone else.
 *
 * Three ways in. Your own trials arrive via `loadTrials()`; the fixture is
 * looked up by id, because it is a published sample readable by anyone and no
 * longer rides in a signed-in user's list. Anything else falls through to
 * `getPublicTrial()`, which returns only what its owner deliberately published
 * — so a private trial and a nonexistent one still 404 identically, and "not
 * yours" leaks nothing.
 *
 * A community reader gets the same tabs the owner does, minus every control:
 * no capture slot, no note editing, no End trial, no settings. The one thing
 * their visit changes is the view counter.
 */
export default async function TrialDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  const { trials } = await loadTrials(userId);

  let trial = trials.find((t) => t.id === id) ?? getFixtureTrials().find((t) => t.id === id);
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

  // A public trial's photos are a separate opt-in. If the viewer is not the
  // owner and photos are private, strip the photo URLs before the trial object
  // reaches the client — the actual blob access is also gated in the photo
  // route, but the URL should never appear in the page payload either.
  const canViewPhotos = isOwner || trial.photosVisibility === 'public';
  if (!canViewPhotos) {
    trial = {
      ...trial,
      captures: trial.captures.map((c) => ({
        ...c,
        blobUrl: null,
        photoUrl: null,
        extraPhotos: [],
      })),
    };
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

  // The frozen baseline snapshot carries a catalog id for identity/linking
  // only (lib/routines.ts) and never a cached image. This is the same
  // pointer, joined here for the same non-measurement, display-only purpose
  // a live routine already gets via ITEM_COLUMNS's `image` join.
  const baselineCatalogIds = trial.routine.baseline
    .filter((e): e is RoutineSnapshot => typeof e !== 'string')
    .flatMap((r) => r.items.map((i) => i.catalogProductId))
    .filter((id): id is string => id !== null);
  const productImages: Record<string, string | null> = Object.fromEntries(
    await catalogProductImages(baselineCatalogIds),
  );

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <header className="relative">
        {isCompleted && (
          <div className="absolute right-0 top-0">
            <CompletedBadge inconclusive={isInconclusive(trial)} />
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

        {/* Owner-only controls, under the title rather than buried in a tab:
            what the trial's settings are (Edit trial) and who can see it
            (the toggle). A visitor sees neither — if they can view the
            trial, it's already public, so there's nothing to show them. */}
        {canEdit && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/trials/${trial.id}/edit`} />}
            >
              <Pencil aria-hidden />
              Edit trial
            </Button>
            <TrialVisibilityToggle trialId={trial.id} visibility={trial.visibility} />
            {isPublic && (
              <TrialPhotosVisibilityToggle
                trialId={trial.id}
                photosVisibility={trial.photosVisibility}
              />
            )}
          </div>
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

      <TrialDetailTabs
        trial={trial}
        changes={changes}
        record={record}
        canEdit={canEdit}
        productImages={productImages}
      />

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
