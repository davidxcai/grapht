import { Badge } from '@/components/ui/badge';
import { concernLabel } from '@/lib/concerns';
import { cn } from '@/lib/utils';

export type ConcernChipTone = 'product' | 'routine' | 'neutral';

// Colour follows what kind of card is showing the chip, not which metric it
// names — that axis stays flat on purpose (see below). Teal marks a product's
// own targets, violet a routine's coverage, matching the Product/Routine
// badges in `metric-list.tsx`. Neutral (blue, the existing `secondary` token)
// is for chips that aren't attached to either — a picker, a filter, this
// product's own page.
const TONE_CLASSES: Record<Exclude<ConcernChipTone, 'neutral'>, string> = {
  product: 'border-transparent bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300',
  routine: 'border-transparent bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
};

/**
 * A set of concerns, as chips coloured by card kind, never by which metric
 * they name — no hue means "acne" here, because that hue would have to mean
 * something else on a chart. These chips say *which* metrics and *whose*
 * they are, never how they are doing.
 */
export function ConcernChips({
  concerns,
  className,
  empty = 'No metrics yet',
  tone = 'neutral',
}: {
  concerns: string[];
  className?: string;
  empty?: string;
  tone?: ConcernChipTone;
}) {
  if (concerns.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  }

  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)}>
      {concerns.map((c) => (
        <li key={c}>
          <Badge
            variant={tone === 'neutral' ? 'secondary' : 'outline'}
            className={cn('font-normal', tone !== 'neutral' && TONE_CLASSES[tone])}
          >
            {concernLabel(c)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
