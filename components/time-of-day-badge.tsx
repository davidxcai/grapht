import { Badge } from '@/components/ui/badge';
import type { TimeOfDay } from '@/lib/trials';

/**
 * AM/PM, next to the trial name. Outline rather than a filled color — unlike
 * `CompletedBadge`, this isn't status, and the filled tokens are reserved for
 * status and direction of change.
 */
export function TimeOfDayBadge({ timeOfDay }: { timeOfDay: TimeOfDay }) {
  return <Badge variant="outline">{timeOfDay.toUpperCase()}</Badge>;
}
