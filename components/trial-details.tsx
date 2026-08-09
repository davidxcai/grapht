import Link from 'next/link';
import { Pencil } from 'lucide-react';

import { TrialProducts } from '@/components/trial-products';
import { Button } from '@/components/ui/button';
import type { Frequency, Trial } from '@/lib/trials';

interface Props {
  trial: Trial;
  /** False for the reference series, which has no row to edit. */
  canEdit: boolean;
}

function longDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function frequencyLabel(frequency: Frequency): string {
  switch (frequency.kind) {
    case 'daily':
      return 'Every day';
    case 'every-n-days':
      if (frequency.n === 2) return 'Every other day';
      if (frequency.n === 7) return 'Once a week';
      return `Every ${frequency.n} days`;
    case 'weekdays': {
      const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const picked = [...frequency.days].sort((a, b) => a - b).map((d) => names[d]);
      return picked.length > 0 ? picked.join(', ') : 'No set days';
    }
    case 'none':
      return 'Whenever you like';
  }
}

/** Only the sources worth naming — a date the user picked speaks for itself. */
function endDateNote(source: Trial['window']['endDateSource']): string | null {
  if (source === 'clinician') return 'from your clinician';
  if (source === 'product-claim') return "from the product's claim";
  return null;
}

function Row({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b py-3 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm">
        {value}
        {note && <span className="text-muted-foreground"> · {note}</span>}
      </dd>
    </div>
  );
}

export function TrialDetails({ trial, canEdit }: Props) {
  const { startDate, endDate, endDateSource } = trial.window;
  const devices = [...new Set(trial.captures.map((c) => c.device))];

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Left column: Products */}
      <TrialProducts trial={trial} />

      {/* Right column: Settings info */}
      <div className="space-y-8">
        <dl>
          <Row label="Started" value={longDate(startDate)} />
          <Row
            label="Ends"
            value={endDate ? longDate(endDate) : 'Open-ended'}
            note={endDate ? endDateNote(endDateSource) : null}
          />
          <Row label="Logging" value={frequencyLabel(trial.frequency)} />
          <Row label="Time of day" value={trial.timeOfDay === 'pm' ? 'Night' : 'Morning'} />
          <Row label="Photos" value={String(trial.captures.length)} />
          {devices.length > 0 && (
            <Row label={devices.length === 1 ? 'Camera' : 'Cameras'} value={devices.join(', ')} />
          )}
          <Row label="Visibility" value={trial.visibility === 'public' ? 'Public' : 'Private'} />
        </dl>

        {/* Settings only — the products above are frozen, and the page it opens
            says so rather than showing controls that would refuse to save. */}
        {canEdit && (
          <div className="border-t pt-6">
            <Button
              variant="outline"
              className="w-full"
              render={<Link href={`/trials/${trial.id}/edit`} />}
            >
              <Pencil aria-hidden />
              Edit
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
