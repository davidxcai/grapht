import { notFound } from 'next/navigation';

import { TrialSettingsEditor } from '@/components/trial-settings-editor';
import { listStoredTrials } from '@/lib/trial-store';
import { requireOnboardedUserId } from '@/lib/profile-store';

/**
 * Editing a trial's settings.
 *
 * `listStoredTrials()` is scoped to the owner and never includes the fixture, so
 * a stranger's id and the built-in reference series both fall out as 404 with no
 * test of their own — the same reason the detail page needs none. Unlike that
 * page this one does not catch a database failure: there is nothing to degrade
 * to, and a form that silently edits nothing would be worse than an error.
 */
export default async function EditTrial({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireOnboardedUserId();

  const trial = (await listStoredTrials(userId)).find((t) => t.id === id);
  if (!trial) notFound();

  return (
    <main className="w-full px-5 py-10 lg:px-10">
      <h1 className="text-2xl font-semibold tracking-tight">Edit trial</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {trial.status === 'completed'
          ? 'This trial has ended, so its window and schedule stay as they were logged.'
          : 'Your products stay as you set them up, so what has already been measured still counts.'}
      </p>

      <TrialSettingsEditor
        trialId={trial.id}
        status={trial.status}
        startDate={trial.window.startDate}
        settings={{
          name: trial.name,
          endDate: trial.window.endDate,
          endDateSource: trial.window.endDateSource,
          timeOfDay: trial.timeOfDay,
          visibility: trial.visibility,
          photosVisibility: trial.photosVisibility,
          frequency: trial.frequency,
          commentsEnabled: trial.commentsEnabled !== false,
        }}
      />
    </main>
  );
}
