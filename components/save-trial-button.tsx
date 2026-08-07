'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bookmark, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toggleSave } from '@/app/community/actions';

/** Bookmark someone else's public trial; it turns up under Saved on the
 *  dashboard. Never shown on your own trials — you already have those. */
export function SaveTrialButton({ trialId, saved }: { trialId: string; saved: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    setError(null);
    startTransition(async () => {
      const result = await toggleSave(trialId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <Button variant="outline" size="sm" onClick={toggle} disabled={pending}>
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Bookmark className={saved ? 'fill-current' : ''} aria-hidden />
        )}
        {saved ? 'Saved' : 'Save'}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
