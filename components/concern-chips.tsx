import { Badge } from '@/components/ui/badge';
import { concernLabel } from '@/lib/concerns';
import { cn } from '@/lib/utils';

/**
 * A set of concerns, as flat neutral chips.
 *
 * Deliberately unstyled by metric: no per-concern colour, ever. `--progress` is
 * the ring's and nothing else's, and a hue that means "acne" here would have to
 * mean something else on a chart. These chips say *which* metrics, never how
 * they are doing.
 */
export function ConcernChips({
  concerns,
  className,
  empty = 'No metrics yet',
}: {
  concerns: string[];
  className?: string;
  empty?: string;
}) {
  if (concerns.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  }

  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)}>
      {concerns.map((c) => (
        <li key={c}>
          <Badge variant="secondary" className="font-normal">
            {concernLabel(c)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
