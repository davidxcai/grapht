"use client";

import { Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrialCalendar } from "@/components/trial-calendar";
import { TrialPhotos } from "@/components/trial-photos";
import { MetricList } from "@/components/metric-list";
import { TrialProducts } from "@/components/trial-products";
import { TrialSummary } from "@/components/trial-summary";
import { EndTrialButton } from "@/components/end-trial-button";
import { AddFinalPhoto } from "@/components/add-final-photo";
import { isInconclusive, type Trial } from "@/lib/trials";
import type { LogRecord, MetricChange } from "@/lib/trial-detail";

/**
 * The trial detail page: progress, details, summary.
 *
 * Progress leads because the photo is what the user came to see and the thing
 * they can judge for themselves — the calendar rides along with it as the
 * other half of "what's been logged." Details is how the trial was set up and
 * what it's tracking; ending the trial lives there too, since that's a
 * decision about the setup, not about today's photo. Summary is empty until
 * the trial is ended, and says so rather than hiding.
 *
 * What used to be a fourth tab's worth of settings (start/end date, logging
 * schedule, time of day, visibility) now lives under the trial title instead
 * — an Edit trial link and a visibility toggle — so this file no longer
 * renders any of it.
 */

interface Props {
    trial: Trial;
    changes: MetricChange[];
    record: LogRecord;
    /** False for the reference series, which has no row to edit. */
    canEdit: boolean;
    /** Live catalog thumbnails for the frozen baseline snapshot's products,
     *  keyed by catalog id — looked up server-side since the snapshot itself
     *  carries no image (lib/routines.ts). */
    productImages: Record<string, string | null>;
}

export function TrialDetailTabs({ trial, changes, record, canEdit, productImages }: Props) {
    const isCompleted = trial.status === "completed";
    const isOpenEnded = trial.window.endDate === null;
    const loggedDays = record.days
        .filter((d) => d.captures.length > 0)
        .map((d) => d.date);

    // Split into the three attribution rows the trial model defines
    // (docs/trial-model.md): tracked (attributed/shared credit), confounded
    // (covered by the baseline routine, credit withheld), and everything else
    // — measured but tied to neither, reported as a possible side effect
    // rather than hidden.
    const tracked = changes.filter((m) => m.tracked);
    const untracked = changes.filter((m) => !m.tracked && m.confounded);
    const rest = changes.filter((m) => !m.tracked && !m.confounded);
    // The initial photo is analysed immediately (PRODUCT.md), so day one already
    // has real scores — MetricList renders those as a baseline-only row (no
    // arrow, no colour) via its own `series.length < 2` branch. Nothing here
    // should wait for a second day; the placeholder is only for a trial with
    // no measured concerns at all, which no amount of future photos would
    // change either.
    const noData = changes.length === 0;

    return (
        <Tabs defaultValue="details" className="mt-6">
            <TabsList className="w-full">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="progress">Progress</TabsTrigger>
                <TabsTrigger value="summary">Summary</TabsTrigger>
            </TabsList>

            {/* --------------------------------------------------------- details */}
            <TabsContent value="details" className="mt-5">
                <div className="grid gap-8 lg:grid-cols-2">
                    {/* Left column: products & routine */}
                    <TrialProducts trial={trial} productImages={productImages} />

                    {/* Right column: what those products (and the baseline they sit on) are tracking */}
                    <div>
                        <h3 className="flex items-center gap-2 text-sm font-medium">
                            <Sparkles className="h-4 w-4" />
                            AI Skin Analysis
                        </h3>
                        {noData ? (
                            <p className="rounded-lg border border-dashed px-5 py-6 text-center text-sm text-muted-foreground">
                                No photos analyzed in this trial.
                            </p>
                        ) : (
                            <MetricList
                                metrics={[...tracked, ...untracked, ...rest]}
                            />
                        )}
                    </div>
                </div>

                {!isCompleted && canEdit && (
                    <div className="mt-8 border-t pt-8">
                        <EndTrialButton
                            trialId={trial.id}
                            daysLogged={record.daysLogged}
                            hasLoggedSince={trial.captures.length > 1}
                        />
                    </div>
                )}
            </TabsContent>

            {/* --------------------------------------------------------- progress */}
            {/* Today lives inside the roll as its last frame, so the old "come back
          tomorrow" note is gone — it contradicted a camera button sitting right
          beside it, and the empty frame already says what is missing. */}
            <TabsContent value="progress" className="mt-5">
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

                <div className="mt-8">
                    <div className="flex items-baseline justify-between">
                        <h3 className="text-sm font-medium">Days logged</h3>
                        <p className="text-sm text-muted-foreground tabular-nums">
                            {record.daysLogged}{" "}
                            {record.daysLogged === 1 ? "day" : "days"}
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
            </TabsContent>

            {/* --------------------------------------------------------- summary */}
            <TabsContent value="summary" className="mt-5">
                {isCompleted && isInconclusive(trial) ? (
                    <div className="rounded-lg border border-dashed px-6 py-14 text-center">
                        <p className="text-sm text-muted-foreground">
                            This trial is inconclusive — only your starting
                            photo was ever analysed, so there's nothing to
                            compare it against.
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
                                ? "No summary until you stop this trial. It runs as long as you want it to."
                                : record.daysRemaining === 0
                                  ? "You've reached your end date. End the trial whenever you're ready and your summary is written then."
                                  : `${record.daysRemaining} more ${record.daysRemaining === 1 ? "day" : "days"} until complete.`}
                        </p>
                    </div>
                )}
            </TabsContent>
        </Tabs>
    );
}
