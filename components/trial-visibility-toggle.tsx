'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { setTrialVisibility } from '@/app/trials/actions';
import type { TrialVisibility } from '@/lib/trials';

/**
 * The owner's quick Public/Private switch, under the trial title. One click
 * flips it and saves immediately — there's no form, because a two-state
 * setting doesn't need one. Never shown to anyone but the owner: a visitor
 * who can see the trial already knows it's public.
 */
export function TrialVisibilityToggle({
  trialId,
  visibility,
}: {
  trialId: string;
  visibility: TrialVisibility;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(visibility);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isPublic = current === 'public';
  const next: TrialVisibility = isPublic ? 'private' : 'public';

  const flip = () => {
    setError(null);
    startTransition(async () => {
      const result = await setTrialVisibility(trialId, next);
      if (result.ok) {
        setCurrent(result.data.visibility);
        toast.success(result.data.visibility === 'public' ? 'Trial is now public' : 'Trial is now private');
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
          <Users aria-hidden />
        ) : (
          <Lock aria-hidden />
        )}
        {isPublic ? 'Public' : 'Private'}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
