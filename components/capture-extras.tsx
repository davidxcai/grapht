'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ImagePlus, Loader2, Pencil, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { addCapturePhotos, removeCapturePhoto, saveCaptureNote } from '@/app/trials/actions';
import type { Capture } from '@/lib/trials';

/**
 * Everything attached to one day's photo besides the measurement: the note and
 * the extra angles (ideas.md). Renders under the carousel for whichever frame
 * is showing.
 *
 * The extra photos are never analysed — no scores, no units — and stack
 * vertically so the day's full set reads as one scroll.
 */

export function CaptureExtras({
  trialId,
  capture,
  canEdit,
}: {
  trialId: string;
  capture: Capture;
  canEdit: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const note = capture.note ?? null;
  const extras = capture.extraPhotos ?? [];

  const run = (work: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error ?? 'Something went wrong.');
      else {
        setEditing(false);
        router.refresh();
      }
    });
  };

  const upload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const form = new FormData();
    for (const file of Array.from(files)) form.append('photos', file);
    run(() => addCapturePhotos(trialId, capture.id, form));
  };

  return (
    <div className="mt-4 space-y-4">
      {/* ---- note ---- */}
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Anything worth remembering about this day — sunburn, travel, a bad night…"
            aria-label="Photo note"
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => saveCaptureNote(trialId, capture.id, draft))}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Save
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {note && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                className="ml-auto text-muted-foreground"
                onClick={() => run(() => saveCaptureNote(trialId, capture.id, ''))}
              >
                Remove note
              </Button>
            )}
          </div>
        </div>
      ) : (
        canEdit && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setDraft(note ?? '');
                setEditing(true);
              }}
            >
              <Pencil aria-hidden />
              {note ? 'Edit note' : 'Add a note'}
            </Button>
          </div>
        )
      )}

      {/* ---- extra photos ---- */}
      {extras.length > 0 && (
        <div className="space-y-3">
          {extras.map((photo) => (
            <div key={photo.id} className="relative overflow-hidden rounded-xl bg-muted">
              <Image
                src={photo.url}
                alt="Additional photo for this day"
                width={1050}
                height={1400}
                className="w-full object-cover"
                sizes="(max-width: 42rem) 100vw, 42rem"
              />
              {canEdit && (
                <button
                  type="button"
                  aria-label="Remove this photo"
                  disabled={pending}
                  onClick={() => run(() => removeCapturePhoto(trialId, photo.id))}
                  className="absolute right-3 top-3 rounded-full bg-black/60 p-1.5 text-white transition-colors hover:bg-black/80"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="flex justify-center">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png"
            multiple
            className="sr-only"
            onChange={(e) => {
              upload(e.target.files);
              e.target.value = '';
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => fileInput.current?.click()}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />}
            Add more angles
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
