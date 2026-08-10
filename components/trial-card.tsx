import Link from "next/link";
import { CircleCheck, CircleDashed } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CompletedBadge } from "@/components/completed-badge";
import { TimeOfDayBadge } from "@/components/time-of-day-badge";
import { ConcernChips } from "@/components/concern-chips";
import { ProductRow } from "@/components/product-row";
import { TrialGauge } from "@/components/trial-gauge";
import {
    interventionTargets,
    isInconclusive,
    type TrialCardData,
} from "@/lib/trials";
import type { RoutineSnapshot } from "@/lib/routines";

/** Today's log state, in the chart's top-right corner on a running trial —
 *  `CompletedBadge` takes that slot once the trial is done. */
function LoggedBadge({ loggedToday }: { loggedToday: boolean }) {
    return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
            {loggedToday ? (
                <>
                    <CircleCheck
                        className="size-3.5 text-[var(--progress)]"
                        aria-hidden
                    />
                    Logged
                </>
            ) : (
                <>
                    <CircleDashed className="size-3.5" aria-hidden />
                    Not logged
                </>
            )}
        </Badge>
    );
}

/**
 * The whole dashboard, repeated: chart, name, what it tracks, products, the
 * routine it sits on. Stacked vertically end to end rather than a ring beside
 * a wall of text — the side-by-side layout stayed cramped down to phone width
 * and wasn't much better on desktop.
 *
 * The am/pm slot and today's log state ride in the chart's corners instead of
 * the vertical stack — they're metadata about the trial, not part of what it's
 * testing, so they don't compete with the name and chips for the centre line.
 *
 * "What it tracks" is both the interventions themselves and the concerns
 * their `targets[]` union to, as chips — the metrics this trial can actually
 * attribute a change to. Never the baseline's coverage, which is confounded,
 * not tracked.
 *
 * `handle` is optional and only passed where a card can belong to any owner —
 * the community surfaces (home, search, a product page's "Trials that use
 * this", the saved tab) pull public trials across every owner, not just the
 * viewer's own, so it's the only place attribution is needed. Same pattern as
 * `RoutineCard`'s `handle` prop. This is also the *only* difference from a
 * dashboard card: same gauge, same badges, same chips, same product rows —
 * one component, not two that drift.
 */
export function TrialCard({
    data,
    handle,
}: {
    data: TrialCardData;
    handle?: string | null;
}) {
    const { trial, dayNumber, totalDays, loggedToday } = data;
    const isCompleted = trial.status === "completed";
    const targets = interventionTargets(trial);

    // A bare string baseline entry is a product typed straight into the trial
    // and has no name of its own — only a saved-routine snapshot does.
    const routineSnapshot = trial.routine.baseline.find(
        (e): e is RoutineSnapshot => typeof e !== "string",
    );

    return (
        <Link href={`/trials/${trial.id}`} className="group block">
            <Card className="gap-4 p-5 transition-colors group-hover:bg-slate-100/50">
                <div className="flex flex-col">
                    <div className="flex justify-between">
                        <div>
                            <TimeOfDayBadge timeOfDay={trial.timeOfDay} />
                        </div>
                        <div>
                            {isCompleted ? (
                                <CompletedBadge
                                    inconclusive={isInconclusive(trial)}
                                />
                            ) : (
                                <LoggedBadge loggedToday={loggedToday} />
                            )}
                        </div>
                    </div>

                    <TrialGauge
                        dayNumber={dayNumber}
                        totalDays={totalDays}
                        completed={isCompleted}
                    />
                </div>

                <div className="space-y-0.5 text-center">
                    <h2 className="truncate text-base font-medium">
                        {trial.name}
                    </h2>
                    {handle !== undefined && (
                        <p className="truncate text-xs text-muted-foreground">
                            {handle ? `@${handle}` : "anonymous"}
                        </p>
                    )}
                </div>

                {targets.length > 0 && (
                    <ConcernChips
                        concerns={targets}
                        className="justify-center"
                        tone="product"
                    />
                )}

                <div className="space-y-2">
                    {trial.routine.interventions.map((i) => (
                        <ProductRow
                            key={i.name}
                            name={i.name}
                            image={i.image}
                        />
                    ))}
                </div>

                {routineSnapshot && (
                    <>
                        <Separator />
                        <p className="truncate text-center text-sm text-muted-foreground">
                            {routineSnapshot.routineName}
                        </p>
                    </>
                )}
            </Card>
        </Link>
    );
}
