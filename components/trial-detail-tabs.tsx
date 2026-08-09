'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrialCalendar } from '@/components/trial-calendar';
import { TrialPhotos } from '@/components/trial-photos';
import { MetricList } from '@/components/metric-list';
import { TrialDetails } from '@/components/trial-details';
import { TrialSummary } from '@/components/trial-summary';
import { EndTrialButton } from '@/components/end-trial-button';
import { AddFinalPhoto } from '@/components/add-final-photo';
import { isInconclusive, type Trial } from '@/lib/trials';
import type { LogRecord, MetricChange } from '@/lib/trial-detail';

/**
 * The trial detail page: photos, details, progress, summary.
 *
 * Photos leads because the photo is what the user came to see and the thing they
 * can judge for themselves. Details is how the trial was set up. Progress carries
 * the measurements. Summary is empty until the trial is ended, and says so rather
 * than hiding.
 */

interface Props {
  trial: Trial;
  changes: MetricChange[];
  record: LogRecord;
  /** False for the reference series, which has no row to edit. */
  canEdit: boolean;
}

export function TrialDetailTabs({ trial, changes, record, canEdit }: Props) {
  const isCompleted = trial.status === 'completed';
  const isOpenEnded = trial.window.endDate === null;
  const loggedDays = record.days.filter((d) => d.captures.length > 0).map((d) => d.date);

  // Progress only shows what's actually tracked: the trial's intervention
  // targets, plus whatever the baseline routine covers (confounded, but still
  // something the user is measuring). A metric with data but no tie to either
  // is noise here — hide it rather than list every one of the 14 concerns.
  const relevant = changes.filter((m) => m.tracked || m.confounded);
  const tracked = relevant.filter((m) => m.tracked);
  const untracked = relevant.filter((m) => !m.tracked);
  const onlyBaseline = record.daysLogged < 2;

  // Get routine name from the baseline snapshot
  const baselineRoutine = trial.routine.baseline.find(
    (b) => typeof b === 'object' && b !== null && 'routineName' in b,
  ) as { routineName: string } | undefined;
  const routineName = baselineRoutine?.routineName || 'routine';

  return (
    <Tabs defaultValue="photos" className="mt-6">
      <TabsList className="w-full">
        <TabsTrigger value="photos">Photos</TabsTrigger>
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="progress">Progress</TabsTrigger>
        <TabsTrigger value="summary">Summary</TabsTrigger>
      </TabsList>

      {/* ---------------------------------------------------------- photos */}
      {/* Today lives inside the roll as its last frame, so the old "come back
          tomorrow" note is gone — it contradicted a camera button sitting right
          beside it, and the empty frame already says what is missing. */}
      <TabsContent value="photos" className="mt-5">
        <TrialPhotos
          trialId={trial.id}
          captures={trial.captures}
          startDate={trial.window.startDate}
          totalDays={record.totalDays}
          dayNumber={record.dayNumber}
          canCapture={!isCompleted && canEdit}
          loggedToday={record.loggedToday}
          canEdit={canEdit}
          applications={trial.applications ?? []}
        />
      </TabsContent>

      {/* --------------------------------------------------------- details */}
      <TabsContent value="details" className="mt-5">
        <TrialDetails trial={trial} canEdit={canEdit} />
      </TabsContent>

      {/* -------------------------------------------------------- progress */}
      <TabsContent value="progress" className="mt-5">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Calendar */}
          <div>
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-medium">Days logged</h3>
              <p className="text-sm text-muted-foreground tabular-nums">
                {record.daysLogged} {record.daysLogged === 1 ? 'day' : 'days'}
              </p>
            </div>
            <div className="mt-3">
              <TrialCalendar
                startDate={trial.window.startDate}
                loggedDays={loggedDays}
                endDate={trial.window.endDate}
              />
            </div>
          </div>

          {/* Tracked metrics */}
          <div>
            {onlyBaseline ? (
              <p className="rounded-lg border border-dashed px-5 py-6 text-center text-sm text-muted-foreground">
                No progress yet — come back and take another photo tomorrow.
              </p>
            ) : (
              <div className="space-y-8">
                <MetricList
                  metrics={tracked}
                  title="Product Concerns"
                />
                <MetricList
                  metrics={untracked}
                  title={`From ${routineName} routine`}
                />
              </div>
            )}
          </div>
        </div>

        {!isCompleted && canEdit && (
          <div className="border-t pt-8">
            <EndTrialButton
              trialId={trial.id}
              daysLogged={record.daysLogged}
              hasLoggedSince={trial.captures.length > 1}
            />
          </div>
        )}
      </TabsContent>

      {/* --------------------------------------------------------- summary */}
      <TabsContent value="summary" className="mt-5">
        {isCompleted && isInconclusive(trial) ? (
          <div className="rounded-lg border border-dashed px-6 py-14 text-center">
            <p className="text-sm text-muted-foreground">
              This trial is inconclusive — only your starting photo was ever analysed, so there's
              nothing to compare it against.
            </p>
            {canEdit && (
              <div className="mt-4 flex justify-center">
                <AddFinalPhoto trialId={trial.id} />
              </div>
            )}
          </div>
        ) : isCompleted ? (
          <TrialSummary trial={trial} canEdit={canEdit} />
        ) : (
          <div className="rounded-lg border border-dashed px-6 py-14 text-center">
            <p className="text-sm text-muted-foreground">
              {isOpenEnded
                ? 'No summary until you stop this trial. It runs as long as you want it to.'
                : record.daysRemaining === 0
                  ? "You've reached your end date. End the trial whenever you're ready and your summary is written then."
                  : `${record.daysRemaining} more ${record.daysRemaining === 1 ? 'day' : 'days'} until complete.`}
            </p>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
