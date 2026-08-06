import { Badge } from '@/components/ui/badge';

/**
 * The "Completed" marker, on the dashboard card and the detail page.
 *
 * It carries `--complete`, which also fills the ring on a finished trial. Like
 * `--progress` it marks trial *status* and is forbidden from encoding a metric —
 * a hue that means "done" in one place and "acne" in another is how a chart
 * starts lying. Direction of change has its own two tokens.
 */
export function CompletedBadge() {
  return (
    <Badge className="shrink-0 border-transparent bg-[var(--complete)] text-white">Completed</Badge>
  );
}
