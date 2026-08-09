'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { endTrial } from '@/app/trials/actions';
import { CameraCapture } from '@/components/camera-capture';
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
 * **This is also where the trial's final analysed photo comes from** — the
 * second and last of the two photos a trial ever spends units on. The choice
 * dialog offers a fresh photo or a no-photo fallback; skipping it reuses
 * whichever photo was logged most recently. A trial with nothing logged since
 * day one has nothing to reuse and ends **inconclusive** — still ends, but
 * with an open invitation (on the Summary tab) to add one more photo later.
 *
 * The confirmation exists for one reason worth stating out loud: apart from
 * that one inconclusive-photo exception, this cannot be undone.
 */
export function EndTrialButton({
  trialId,
  daysLogged,
  hasLoggedSince,
}: {
  trialId: string;
  daysLogged: number;
  /** Whether anything beyond the initial photo was ever logged — decides what
   *  "end without a new photo" actually does. */
  hasLoggedSince: boolean;
}) {
  const [mode, setMode] = useState<'button' | 'choose' | 'camera' | 'review'>('button');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const finish = (finalPhoto: File | null) => {
    setError(null);
    startTransition(async () => {
      const result = await endTrial(trialId, finalPhoto, navigator.userAgent);
      if (result.ok) {
        setMode('button');
        toast.success(
          result.data.inconclusive
            ? 'Trial ended — inconclusive. Add a photo anytime to get a result.'
            : 'Trial ended',
        );
        router.push('/dashboard');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  if (mode === 'camera') {
    const accept = (file: File) => {
      setPhoto(file);
      setMode('review');
    };
    return <CameraCapture onCapture={accept} onCancel={() => setMode('button')} />;
  }

  if (mode === 'review' && preview) {
    return (
      <div>
        <div className="overflow-hidden rounded-xl bg-muted">
          {/* A local object URL, not a remote asset the Image loader could optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Your final photo, before you keep it" className="w-full" />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-center gap-2">
          <Button onClick={() => finish(photo)} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {pending ? 'Analysing your photo…' : 'Use this as your final photo'}
          </Button>
          <Button variant="outline" onClick={() => setMode('camera')} disabled={pending}>
            Retake
          </Button>
          <Button variant="ghost" onClick={() => { setPhoto(null); setMode('button'); }} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AlertDialog open={mode === 'choose'} onOpenChange={(open) => setMode(open ? 'choose' : 'button')}>
        <AlertDialogTrigger render={<Button variant="destructive" className="w-full" />}>
          End trial
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this trial?</AlertDialogTitle>
            <AlertDialogDescription>
              Your {daysLogged} {daysLogged === 1 ? 'day' : 'days'} of photos stay exactly as they
              are. Take a final photo now for the most accurate result — otherwise{' '}
              {hasLoggedSince
                ? "we'll use whichever photo you logged most recently."
                : 'this trial will end inconclusive, since nothing beyond your starting photo was ever logged. You can add one later to resolve it.'}{' '}
              You can&rsquo;t add more photos to a trial once it&rsquo;s ended (with that one
              exception) — picking this routine back up later means starting a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep going</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() => finish(null)}
              disabled={pending}
            >
              {pending ? 'Ending…' : 'End without a new photo'}
            </AlertDialogAction>
            <AlertDialogAction onClick={() => setMode('camera')} disabled={pending}>
              Take final photo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
