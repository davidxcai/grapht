import { Badge } from '@/components/ui/badge';

/**
 * The "Completed" marker, on the dashboard card and the detail page.
 *
 * It carries `--complete`, which also fills the ring on a finished trial. Like
 * `--progress` it marks trial *status* and is forbidden from encoding a metric —
 * a hue that means "done" in one place and "acne" in another is how a chart
 * starts lying. Direction of change has its own two tokens.
 *
 * `inconclusive` swaps this to an outline badge reading "Inconclusive" — a
 * trial that ended with only its starting photo ever analysed
 * (`isInconclusive()` in lib/trials.ts). Deliberately not `--complete`'s green
 * fill: nothing was resolved, so it shouldn't read as a finished result.
 */
export function CompletedBadge({ inconclusive = false }: { inconclusive?: boolean }) {
  if (inconclusive) {
    return <Badge variant="outline" className="shrink-0">Inconclusive</Badge>;
  }
  return (
    <Badge className="shrink-0 border-transparent bg-[var(--complete)] text-white">Completed</Badge>
  );
}
