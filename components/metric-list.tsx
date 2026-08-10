import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { concernLabel } from "@/lib/concerns";
import type { Direction, MetricChange } from "@/lib/trial-detail";
import { cn } from "@/lib/utils";

/**
 * Every metric, with its change since day one.
 *
 * The numbers are always visible, and that includes the change itself: 62 → 71
 * prints alongside its own "9", because a row that shows both endpoints and then
 * calls their difference "no change" reads as a bug rather than as caution. "No
 * change" is reserved for a delta that rounds to zero — the scores are whole
 * numbers, so anything smaller than a point is below what the display can
 * express anyway. The delta itself carries no sign: the arrow already says
 * which way it moved, so a "+" or "−" in front of the number would say it twice.
 *
 * Colour follows the printed number and nothing else: up is green, down is red,
 * and grey belongs to the zero row alone. Whether a move clears this user's own
 * scatter is a narration question, and the wobble check (`directionOf`) still
 * owns it everywhere narration happens.
 *
 * There is no sparkline. Only the initial and final photo are ever analysed
 * (CLAUDE.md, "Repository state"), so a metric's series is at most two points —
 * a line between them never draws anything beyond the same delta shown as text.
 *
 * There is no per-group heading either. `Badge` stands in for the removed
 * "Product Concerns" / "From routine" section titles: a metric the trial's own
 * products target gets a Product badge, one the baseline routine already covers
 * gets a Routine badge, and a metric tied to neither gets none — nothing to call
 * out there.
 */

const TONE: Record<Direction, string> = {
    improved: "text-[var(--improved)]",
    declined: "text-[var(--declined)]",
    flat: "text-muted-foreground",
};

function toneOf(rounded: number): Direction {
    if (rounded === 0) return "flat";
    return rounded > 0 ? "improved" : "declined";
}

function MetricRow({ metric }: { metric: MetricChange }) {
    const badge = metric.tracked ? (
        <Badge
            variant="outline"
            className="border-transparent bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300"
        >
            Product
        </Badge>
    ) : metric.confounded ? (
        <Badge
            variant="outline"
            className="border-transparent bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
        >
            Routine
        </Badge>
    ) : null;

    // A single capture is a starting point, not a change — never render it as
    // "no change", which would claim something was compared when nothing was.
    if (metric.series.length < 2) {
        return (
            <li className="flex items-center gap-4 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <p className="truncate text-sm font-medium">
                        {concernLabel(metric.concern)}
                    </p>
                    {badge}
                </div>
                <div className="shrink-0 text-right text-sm font-medium tabular-nums">
                    {Math.round(metric.first)}
                </div>
            </li>
        );
    }

    // Round first, then read the sign off the rounded value, so the arrow can
    // never point somewhere the printed number doesn't go.
    const rounded = Math.round(metric.latest) - Math.round(metric.first);
    const Icon =
        rounded === 0 ? Minus : rounded > 0 ? ArrowUpRight : ArrowDownRight;
    const tone = TONE[toneOf(rounded)];

    return (
        <li className="flex items-center gap-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <p className="truncate text-sm font-medium">
                    {concernLabel(metric.concern)}
                </p>
                {badge}
            </div>

            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                {Math.round(metric.first)} → {Math.round(metric.latest)}
            </span>

            <div
                className={cn(
                    "flex w-11 shrink-0 items-center justify-end gap-1",
                    tone,
                )}
            >
                <Icon className="size-4" aria-hidden />
                <span className="text-sm font-medium tabular-nums">
                    {rounded === 0 ? "0" : Math.abs(rounded)}
                </span>
            </div>
        </li>
    );
}

export function MetricList({
    metrics,
    caption,
}: {
    metrics: MetricChange[];
    caption?: string;
}) {
    if (metrics.length === 0) return null;

    return (
        <section>
            {caption && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                    {caption}
                </p>
            )}
            <ul className="mt-1 divide-y">
                {metrics.map((metric) => (
                    <MetricRow key={metric.concern} metric={metric} />
                ))}
            </ul>
        </section>
    );
}
