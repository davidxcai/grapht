import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import { concernLabel } from '@/lib/concerns';
import type { Direction, MetricChange } from '@/lib/trial-detail';
import { cn } from '@/lib/utils';

/**
 * Every metric, with its change since day one and a sparkline.
 *
 * The numbers are always visible. What the wobble check controls is the
 * *direction* — the arrow, the colour, and the word — never whether the user is
 * allowed to see their own measurement. Withholding the data until it clears
 * some bar would make the summary the only thing of value, and the daily log is
 * the product (CLAUDE.md).
 */

const TONE: Record<Direction, string> = {
  improved: 'text-[var(--improved)]',
  declined: 'text-[var(--declined)]',
  flat: 'text-muted-foreground',
};

const ICON: Record<Direction, typeof ArrowUpRight> = {
  improved: ArrowUpRight,
  declined: ArrowDownRight,
  flat: Minus,
};

function Sparkline({ points }: { points: { day: number; value: number }[] }) {
  if (points.length < 2) return <div className="h-8 w-20" />;

  const xs = points.map((p) => p.day);
  const ys = points.map((p) => p.value);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const spanX = x1 - x0 || 1;
  // A flat series would divide by zero and, worse, render as a line pinned to
  // the top of the box. Give it a nominal range so it draws through the middle.
  const spanY = y1 - y0 || 1;

  const path = points
    .map((p, i) => {
      const x = ((p.day - x0) / spanX) * 76 + 2;
      const y = 30 - ((p.value - y0) / spanY) * 26;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 80 32" className="h-8 w-20 overflow-visible" aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function MetricRow({ metric }: { metric: MetricChange }) {
  const Icon = ICON[metric.direction];
  const rounded = Math.round(metric.change);

  return (
    <li className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{concernLabel(metric.concern)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {Math.round(metric.first)} → {Math.round(metric.latest)}
          {metric.confounded && ' · also covered by your routine'}
        </p>
      </div>

      <div className={cn('shrink-0', TONE[metric.direction])}>
        <Sparkline points={metric.series} />
      </div>

      <div className={cn('flex w-28 shrink-0 items-center justify-end gap-1.5', TONE[metric.direction])}>
        <Icon className="size-4" aria-hidden />
        <span className="text-sm font-medium tabular-nums">
          {metric.direction === 'flat'
            ? 'no change'
            : `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}`}
        </span>
      </div>
    </li>
  );
}

export function MetricList({
  metrics,
  title,
  caption,
}: {
  metrics: MetricChange[];
  title: string;
  caption?: string;
}) {
  if (metrics.length === 0) return null;

  return (
    <section>
      <h3 className="text-sm font-medium">{title}</h3>
      {caption && <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>}
      <ul className="mt-1 divide-y">
        {metrics.map((metric) => (
          <MetricRow key={metric.concern} metric={metric} />
        ))}
      </ul>
    </section>
  );
}
