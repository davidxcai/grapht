'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrialCalendar } from '@/components/trial-calendar';
import { TrialPhotos } from '@/components/trial-photos';
import { MetricList } from '@/components/metric-list';
import { EndTrialButton } from '@/components/end-trial-button';
import { concernLabel } from '@/lib/concerns';
import { interventionLabel, type Trial } from '@/lib/trials';
import type { LogRecord, MetricChange } from '@/lib/trial-detail';

/**
 * The trial detail page: photos, progress, summary.
 *
 * Photos leads because the photo is what the user came to see and the thing they
 * can judge for themselves. Progress carries the measurements. Summary is empty
 * until the trial is ended, and says so rather than hiding.
 */

interface Props {
  trial: Trial;
  changes: MetricChange[];
  record: LogRecord;
  baselineNames: string[];
}

export function TrialDetailTabs({ trial, changes, record, baselineNames }: Props) {
  const isCompleted = trial.status === 'completed';
  const isOpenEnded = trial.window.endDate === null;
  const loggedDays = record.days.filter((d) => d.captures.length > 0).map((d) => d.date);

  const tracked = changes.filter((m) => m.tracked);
  const untracked = changes.filter((m) => !m.tracked);
  const onlyBaseline = record.daysLogged < 2;

  return (
    <Tabs defaultValue="photos" className="mt-6">
      <TabsList>
        <TabsTrigger value="photos">Photos</TabsTrigger>
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
          changes={changes}
          startDate={trial.window.startDate}
          totalDays={record.totalDays}
          dayNumber={record.dayNumber}
          canCapture={!isCompleted}
          loggedToday={record.loggedToday}
        />
      </TabsContent>

      {/* -------------------------------------------------------- progress */}
      <TabsContent value="progress" className="mt-5 space-y-8">
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

        {onlyBaseline ? (
          <p className="rounded-lg border border-dashed px-5 py-6 text-center text-sm text-muted-foreground">
            No progress yet — come back and upload another picture tomorrow.
          </p>
        ) : (
          <>
            <MetricList
              metrics={tracked}
              title="What you're tracking"
              caption="Change since day 1."
            />
            <MetricList
              metrics={untracked}
              title="Everything else"
              caption="Measured on every photo whether or not you're tracking it — this is where a side effect would show up."
            />
          </>
        )}

        <section>
          <h3 className="text-sm font-medium">Products</h3>
          <ul className="mt-2 space-y-1">
            {trial.routine.interventions.map((i) => (
              <li key={i.name} className="text-sm">
                {interventionLabel(i)}
                {i.targets.length > 0 && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {i.targets.map(concernLabel).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {baselineNames.length > 0 && (
            <>
              <p className="mt-4 text-xs text-muted-foreground">
                Already in your routine, and not being tested:
              </p>
              <ul className="mt-1 space-y-1">
                {baselineNames.map((name) => (
                  <li key={name} className="text-sm text-muted-foreground">
                    {name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {!isCompleted && (
          <div className="border-t pt-6">
            <EndTrialButton trialId={trial.id} daysLogged={record.daysLogged} />
          </div>
        )}
      </TabsContent>

      {/* --------------------------------------------------------- summary */}
      <TabsContent value="summary" className="mt-5">
        {isCompleted ? (
          <div className="rounded-lg border border-dashed px-6 py-14 text-center">
            <p className="text-sm text-muted-foreground">
              Summaries aren&rsquo;t built yet — the numbers are all on the Progress tab.
            </p>
          </div>
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
