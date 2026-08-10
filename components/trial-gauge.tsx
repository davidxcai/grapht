const RADIUS = 80;
const STROKE = 14;
/** Upper half only: left of centre, over the top, to the right of centre. */
const ARC = `M ${100 - RADIUS} 100 A ${RADIUS} ${RADIUS} 0 0 1 ${100 + RADIUS} 100`;
const ARC_LENGTH = Math.PI * RADIUS;

/**
 * Days elapsed in a trial window, as a half ring — the header of the detail
 * page, where `TrialRing`'s full circle is the dashboard card.
 *
 * Elapsed, not logged: the arc fills on its own whether or not you captured
 * today. An arc that stalls on a missed day is a nag, and the logging record
 * lives one tab down (docs/app-ui.md §3).
 *
 * A finished trial switches to `--complete`, matching its Completed badge.
 */
export function TrialGauge({
    dayNumber,
    totalDays,
    completed = false,
}: {
    dayNumber: number;
    totalDays: number | null;
    completed?: boolean;
}) {
    const color = completed ? "var(--complete)" : "var(--progress)";
    // Open-ended: there is no endpoint to fill toward, so the arc goes full
    // rather than part-filled against an invented horizon — a part-fill would
    // imply a horizon the user deliberately declined to set (docs/app-ui.md §3).
    const fraction =
        totalDays === null ? 1 : Math.min(1, dayNumber / totalDays);

    return (
        <div className="relative mx-auto w-[240px]">
            <svg viewBox="0 0 200 116" className="w-full" aria-hidden>
                <path
                    d={ARC}
                    fill="none"
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    className="stroke-muted"
                />
                {fraction > 0 && (
                    <path
                        d={ARC}
                        fill="none"
                        strokeWidth={STROKE}
                        strokeLinecap="round"
                        strokeDasharray={`${fraction * ARC_LENGTH} ${ARC_LENGTH}`}
                        style={{ stroke: color }}
                    />
                )}
            </svg>

            <div className="absolute inset-x-0 bottom-[14%] flex flex-col items-center">
                <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums">
                    {totalDays === null
                        ? dayNumber
                        : `${dayNumber}/${totalDays}`}
                </span>
                <span className="mt-1.5 text-xs text-muted-foreground">
                    Days
                </span>
            </div>
        </div>
    );
}
