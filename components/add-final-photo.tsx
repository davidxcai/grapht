'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { addFinalPhoto } from '@/app/trials/actions';
import { CameraCapture } from '@/components/camera-capture';
import { Button } from '@/components/ui/button';

/**
 * The one door an inconclusive trial gets: one more analysed photo, taken
 * after the trial already ended (`addFinalPhoto()` in app/trials/actions.ts —
 * the single exception to "ended is immutable"). It closes itself the moment
 * it succeeds once, so this component has nothing to do afterwards but
 * disappear — the Summary tab re-renders as a normal completed trial.
 */
export function AddFinalPhoto({ trialId }: { trialId: string }) {
  const [mode, setMode] = useState<'button' | 'camera' | 'review'>('button');
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

  const accept = (file: File) => {
    setError(null);
    setPhoto(file);
    setMode('review');
  };

  const save = () => {
    if (!photo) return;
    setError(null);
    startTransition(async () => {
      const result = await addFinalPhoto(trialId, photo, navigator.userAgent);
      if (result.ok) {
        toast.success('Final photo analysed — this trial now has a result');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  if (mode === 'camera') {
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
          <Button onClick={save} disabled={pending}>
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
      <Button onClick={() => setMode('camera')}>
        <Camera aria-hidden />
        Add a final photo
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
