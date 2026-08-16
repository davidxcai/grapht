import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';

import { currentUserId } from '@/lib/auth';
import { getFixtureTrials, isFixtureTrial, loadTrials } from '@/lib/trial-store';
import { getPublicTrial } from '@/lib/community';

/**
 * Streams one capture's photo (or one of its extra angles) from the private
 * Vercel Blob store.
 *
 * `analyzeAndStore()` (lib/capture.ts) uploads with `access: 'private'`
 * deliberately — these are faces — which means the raw blob URL 403s for
 * anyone who tries to fetch it directly, browser included. This route is what
 * makes that URL renderable again: it re-runs the exact same access check
 * `app/trials/[id]/page.tsx` uses to decide whether to render the trial at
 * all (own trial, the published fixture, or someone else's public trial),
 * then fetches the blob server-side with the store's token and relays the
 * bytes. `Capture.blobUrl` and `ExtraPhoto.url` never reach the client as-is.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id, photoId } = await params;
  const userId = await currentUserId();
  const { trials } = await loadTrials(userId);

  let isOwner = false;
  let trial = trials.find((t) => t.id === id) ?? getFixtureTrials().find((t) => t.id === id);
  if (trial) {
    isOwner = !isFixtureTrial(trial.id);
  } else {
    const published = await getPublicTrial(id);
    if (!published) return new NextResponse(null, { status: 404 });
    trial = published.trial;
  }

  // Photos are private by default. Only the owner can see them unless the
  // owner has explicitly set photos to public.
  if (!isOwner && trial.photosVisibility !== 'public') {
    return new NextResponse(null, { status: 404 });
  }

  const blobUrl =
    trial.captures.find((c) => c.id === photoId)?.blobUrl ??
    trial.captures.flatMap((c) => c.extraPhotos ?? []).find((p) => p.id === photoId)?.url ??
    null;
  if (!blobUrl) return new NextResponse(null, { status: 404 });

  try {
    const result = await get(blobUrl, { access: 'private' });
    // No `ifNoneMatch` is ever sent, so this is always the 200 branch — the
    // check is here only to satisfy the type (statusCode 304 carries a null
    // stream and contentType).
    if (!result || result.statusCode !== 200) return new NextResponse(null, { status: 404 });
    return new NextResponse(result.stream, {
      headers: {
        'content-type': result.blob.contentType,
        // Private, not public/CDN: the URL shape is the same for a stranger
        // as for the owner, and only this handler's auth check tells them
        // apart, so a shared cache must never serve one viewer's fetch to
        // another.
        'cache-control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
