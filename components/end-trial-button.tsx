'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { endTrial } from '@/app/trials/actions';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/**
 * Ending a trial — the normal way one finishes, not an escape hatch.
 *
 * The copy avoids "stop early" and "quit" deliberately. A trial runs until the
 * user ends it and there is nothing to be early for; the end date was only ever
 * a marker. It also does not say *stop the treatment*, because it doesn't
 * mean that — the log closes, the routine is the user's own business.
 *
 * The confirmation exists for one reason worth stating out loud: this cannot be
 * undone.
 */
export function EndTrialButton({ trialId, daysLogged }: { trialId: string; daysLogged: number }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await endTrial(trialId);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger render={<Button variant="destructive" className="w-full" />}>
          End trial
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this trial?</AlertDialogTitle>
            <AlertDialogDescription>
              Your {daysLogged} {daysLogged === 1 ? 'day' : 'days'} of photos stay exactly as they
              are, and your summary is written from them. You can&rsquo;t add more photos to a trial
              once it&rsquo;s ended — picking this routine back up later means starting a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={confirm} disabled={pending}>
              {pending ? 'Ending…' : 'End trial'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
