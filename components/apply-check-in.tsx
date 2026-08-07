'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CircleCheck, Droplets, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { applyProducts } from '@/app/trials/actions';

/**
 * The "applied products" check-in, under the trial title (ideas.md). One press
 * records a server-stamped instant; the next photo reports the hours since.
 *
 * The pressed state holds for twelve hours — long enough that the morning
 * check-in is still showing at noon, short enough that tonight's routine gets
 * its own press. A press is never undoable and never editable, for the same
 * reason a capture isn't: half of a time-between measurement is worthless if
 * it can be moved afterwards.
 */

const HOLD_HOURS = 12;

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function ApplyCheckIn({
  trialId,
  lastAppliedAt,
}: {
  trialId: string;
  lastAppliedAt: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const recent =
    lastAppliedAt !== null &&
    Date.now() - Date.parse(lastAppliedAt) < HOLD_HOURS * 3_600_000;

  if (recent && lastAppliedAt) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
        <CircleCheck className="size-4 text-[var(--progress)]" aria-hidden />
        Products applied · {clock(lastAppliedAt)}
      </p>
    );
  }

  const press = () => {
    setError(null);
    startTransition(async () => {
      const result = await applyProducts(trialId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  };

  return (
    <div className="flex flex-col items-center gap-1.5">
      <Button variant="outline" size="sm" onClick={press} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Droplets aria-hidden />}
        Applied products
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
