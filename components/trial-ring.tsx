'use client';

import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';

const config = {
  days: { label: 'Days', color: 'var(--progress)' },
} satisfies ChartConfig;

/**
 * Days elapsed in a trial window.
 *
 * Elapsed, not logged — the ring fills on its own whether or not you captured
 * today. A ring that stalls on a missed day is a nag, and the logging record
 * lives on the detail page (docs/app-ui.md §3).
 *
 * A finished trial switches to `--complete`, matching its Completed badge.
 */
export function TrialRing({
  dayNumber,
  totalDays,
  completed = false,
}: {
  dayNumber: number;
  totalDays: number | null;
  completed?: boolean;
}) {
  const color = completed ? 'var(--complete)' : 'var(--progress)';
  // Open-ended: there is nothing to fill toward, so the ring stays bare track.
  // A spinner or a bar filling against an invented horizon would both imply an
  // endpoint the user deliberately declined to set (docs/app-ui.md §3).
  const data = [{ name: 'days', days: totalDays === null ? 0 : dayNumber }];
  const domain: [number, number] = [0, totalDays ?? 1];

  return (
    <div className="relative size-[104px] shrink-0">
      <ChartContainer config={config} className="size-full">
        <RadialBarChart
          data={data}
          innerRadius="76%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
          barSize={10}
        >
          <PolarAngleAxis type="number" domain={domain} tick={false} axisLine={false} />
          <RadialBar
            dataKey="days"
            fill={color}
            // Track colour comes from ChartContainer's
            // `.recharts-radial-bar-background-sector` rule, which wins over a
            // fill attribute set here.
            background
            cornerRadius={6}
            isAnimationActive={false}
          />
        </RadialBarChart>
      </ChartContainer>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tabular-nums leading-none tracking-tight">
          {totalDays === null ? dayNumber : `${dayNumber}/${totalDays}`}
        </span>
        <span className="mt-1 text-[11px] text-muted-foreground">Days</span>
      </div>
    </div>
  );
}
