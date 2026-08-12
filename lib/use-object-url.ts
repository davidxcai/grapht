'use client';

import { useEffect, useState } from 'react';

/**
 * A blob URL for a picked file, revoked when the file changes or the component
 * goes away.
 *
 * Every photo flow in the app shows the shot back before spending anything on
 * it — the review step in `end-trial-button.tsx`, `add-final-photo.tsx`,
 * `trial-photos.tsx` and the trial editor. Each was holding its own `preview`
 * state and its own cleanup, and a missed `revokeObjectURL` leaks the whole
 * image for as long as the tab lives.
 */
export function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);

  return url;
}
