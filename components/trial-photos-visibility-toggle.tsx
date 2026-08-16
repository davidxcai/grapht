'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Image, ImageOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { setTrialPhotosVisibility } from '@/app/trials/actions';
import type { TrialVisibility } from '@/lib/trials';

/**
 * The owner's quick Photos Private/Public switch. Shown on public trials so the
 * owner can opt in (or back out) of sharing face photos without unpublishing the
 * whole trial. Metrics and routine stay public either way.
 */
export function TrialPhotosVisibilityToggle({
  trialId,
  photosVisibility,
}: {
  trialId: string;
  photosVisibility: TrialVisibility;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(photosVisibility);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isPublic = current === 'public';
  const next: TrialVisibility = isPublic ? 'private' : 'public';

  const flip = () => {
    setError(null);
    startTransition(async () => {
      const result = await setTrialPhotosVisibility(trialId, next);
      if (result.ok) {
        setCurrent(result.data.photosVisibility);
        toast.success(
          result.data.photosVisibility === 'public'
            ? 'Photos are now public'
            : 'Photos are now private',
        );
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <Button variant="outline" size="sm" onClick={flip} disabled={pending}>
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : isPublic ? (
          <Image aria-hidden />
        ) : (
          <ImageOff aria-hidden />
        )}
        {isPublic ? 'Photos public' : 'Photos private'}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
