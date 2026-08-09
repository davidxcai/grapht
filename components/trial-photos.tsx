'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Camera, ChevronLeft, ChevronRight, Loader2, ScanFace } from 'lucide-react';
import { toast } from 'sonner';

import { CameraCapture } from '@/components/camera-capture';
import { CaptureExtras } from '@/components/capture-extras';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { logCapture } from '@/app/trials/actions';
import { hoursLabel, timeSinceApplied, type Capture } from '@/lib/trials';
import { cn } from '@/lib/utils';

/**
 * The photo timeline — the main surface of a running trial.
 *
 * The point of the product is that skin changes too slowly to see day to day, so
 * the photo alone proves nothing. What makes it worth looking at is the numbers
 * over it: this is your face on this day, and here is what had moved by then.
 *
 * **The overlay is per photo, not per trial.** It reports day 1 → *this* capture.
 * Showing the trial total on every frame made the day-1 photo claim an
 * improvement it could not have contained.
 *
 * **It shows both scores, not just the difference.** The whole point of putting
 * numbers on a face is that the user can check one against the other, and a bare
 * "−12" gives them nothing to check. Within-wobble frames are the case that
 * matters: this used to print "no change" and hide the measurement entirely, so a
 * visible breakout read as the app disagreeing with the user's own eyes. It was
 * agreeing — the score had dropped 12 — it just wasn't willing to call a move
 * that small. The scores say so; the colour is what stays withheld.
 *
 * **Today is a frame in the grid, not a card beneath it.** When today has no
 * photo it takes the first tile and carries the camera button directly — no
 * separate "come back tomorrow" panel to contradict it.
 *
 * **The grid is one layout, not two.** Mobile and desktop used to fork into a
 * single-frame carousel versus a four-across grid; both are now the same grid
 * at 1 or 4 columns, paginated at 16 tiles so a long trial doesn't turn into an
 * endless scroll. The roll survives as a lightbox: clicking a tile opens the
 * same swipeable Embla carousel the mobile view used to be, now reached on
 * demand instead of being the default view. It still browses every capture in
 * the trial, independent of which grid page you opened it from.
 */

interface Props {
  trialId: string;
  captures: Capture[];
  startDate: string;
  totalDays: number | null;
  /** Today's day number, computed server-side so the counter can't drift. */
  dayNumber: number;
  /** An active trial offers a today slot; an ended one is a closed record. */
  canCapture: boolean;
  loggedToday: boolean;
  /** The owner may edit notes and extra photos; a community reader may not. */
  canEdit: boolean;
  /** "Applied products" check-ins, for the hours-since line on each photo. */
  applications: string[];
}

type Slot = { kind: 'capture'; capture: Capture } | { kind: 'today' };

const MS_PER_DAY = 86_400_000;
const PAGE_SIZE = 16;

function dayOf(startDate: string, capturedAt: string): number {
  return Math.round((Date.parse(capturedAt.slice(0, 10)) - Date.parse(startDate)) / MS_PER_DAY) + 1;
}

/** "August 9, 2026" — the long-form date shown under a photo, in place of a weekday-bearing caption. */
function formatLongDate(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Marks a photo that spent YouCam units — the initial and final capture, never a daily log. */
function AnalyzedBadge() {
  return (
    <Badge
      variant="secondary"
      className="pointer-events-none absolute left-2 top-2 z-10 gap-1 bg-black/60 text-white backdrop-blur-sm"
    >
      <ScanFace aria-hidden />
      Skin Analyzed
    </Badge>
  );
}

export function TrialPhotos({
  trialId,
  captures,
  startDate,
  totalDays,
  dayNumber,
  canCapture,
  loggedToday,
  canEdit,
  applications,
}: Props) {
  const showToday = canCapture && !loggedToday;

  const slots: Slot[] = useMemo(
    () => [
      ...(showToday ? [{ kind: 'today' as const }] : []),
      ...[...captures]
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
        .map((capture) => ({ kind: 'capture' as const, capture })),
    ],
    [captures, showToday],
  );

  // `slots[0]` is today when there is a today slot, the most recent capture
  // otherwise — the array is newest-first. That's the default landing tile.
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);

  const pageCount = Math.max(1, Math.ceil(slots.length / PAGE_SIZE));
  const [page, setPage] = useState(0);
  const currentPage = Math.min(page, pageCount - 1);
  const pageSlots = slots.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStart, setLightboxStart] = useState(0);
  const openLightbox = (i: number) => {
    setIndex(i);
    setLightboxStart(i);
    setLightboxOpen(true);
  };
  // The Carousel only exists while the dialog is mounted, so `startIndex` only
  // needs to be right at mount time — no reinit juggling required.
  const lightboxOpts = useMemo(
    () => ({ startIndex: lightboxStart, align: 'start' as const }),
    [lightboxStart],
  );

  useEffect(() => {
    if (!api) return;
    const sync = () => setIndex(api.selectedScrollSnap());
    sync();
    api.on('select', sync);
    api.on('reInit', sync);
    return () => {
      api.off('select', sync);
      api.off('reInit', sync);
    };
  }, [api]);

  /* ---------------------------------------------------------- capturing */

  const [mode, setMode] = useState<'roll' | 'camera' | 'review'>('roll');
  const [noteDraft, setNoteDraft] = useState('');
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

  const cancel = () => {
    setPhoto(null);
    setNoteDraft('');
    setMode('roll');
  };

  /**
   * The shutter never spends units — this does. A frame nobody looked at costs
   * ~20 units against a metered quota *and* joins the series either way, and a
   * mis-framed photo is a bad measurement long before it is a bad picture.
   */
  const save = () => {
    if (!photo) return;
    setError(null);
    startTransition(async () => {
      const result = await logCapture(trialId, photo, navigator.userAgent, noteDraft);
      if (result.ok) {
        cancel();
        toast.success('Photo logged');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  // Capturing takes over the whole area rather than living inside a frame: the
  // roll's drag handler and a live camera would be fighting for the same
  // pointer, and there is nothing to browse mid-capture anyway.
  if (mode === 'camera') {
    return <CameraCapture onCapture={accept} onCancel={cancel} />;
  }

  if (mode === 'review' && preview) {
    return (
      <div>
        <div className="overflow-hidden rounded-xl bg-muted">
          {/* A local object URL, not a remote asset the Image loader could optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Today's photo, before you keep it" className="w-full" />
        </div>

        {/* The note is optional and rides along with the capture — context a
            picture can't carry, editable later from the roll. */}
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Add a note (optional) — sunburn, travel, a bad night…"
          aria-label="Note for today's photo"
          className="mt-3 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-center gap-2">
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {pending ? 'Logging your photo…' : 'Keep this photo'}
          </Button>
          <Button variant="outline" onClick={() => setMode('camera')} disabled={pending}>
            Retake
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------------- roll */

  if (slots.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-6 py-16 text-center text-sm text-muted-foreground">
        No photos yet.
      </p>
    );
  }

  const slotDay = (slot: Slot) =>
    slot.kind === 'today' ? dayNumber : dayOf(startDate, slot.capture.capturedAt);

  // Fixture captures (the reference series) ship their photo as a static file
  // under public/captures/, addressed by `photoUrl`. Live captures upload to a
  // *private* Vercel Blob store, so `blobUrl` 403s if rendered directly — it
  // has to go through the proxy route, which re-checks ownership and streams
  // the bytes server-side (see app/trials/[id]/photo/[photoId]/route.ts).
  const slotSrc = (slot: Slot): string | null => {
    if (slot.kind !== 'capture') return null;
    const { capture } = slot;
    if (capture.photoUrl) return capture.photoUrl;
    if (capture.blobUrl) return `/trials/${trialId}/photo/${capture.id}`;
    return null;
  };

  // Hours between the last "applied products" press and this photo — the
  // check-in feature's whole payoff. "assumed" marks the forgot-to-press
  // fallback, projected from the last press's clock time.
  const slotSinceApplied = (slot: Slot) =>
    slot.kind === 'capture' ? timeSinceApplied(applications, slot.capture.capturedAt) : null;

  // A capture carries `concerns` only if it spent YouCam units — the initial
  // and final photo, never a daily log. Today's empty frame is never analyzed.
  const slotAnalyzed = (slot: Slot) => slot.kind === 'capture' && Boolean(slot.capture.concerns);

  const current = slots[index] ?? slots[slots.length - 1];
  const currentDay = slotDay(current);
  const sinceApplied = slotSinceApplied(current);
  const analyzed = slotAnalyzed(current);

  return (
    <div>
      {/* Up to four tiles per row, four rows per page — a trial with more than
          sixteen captures paginates rather than growing the page forever. One
          column on mobile, so a page is the same sixteen tiles stacked instead
          of spread across a grid. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {pageSlots.map((slot, localIndex) => {
          const i = currentPage * PAGE_SIZE + localIndex;
          const day = slotDay(slot);
          const selected = i === index;

          if (slot.kind === 'today') {
            return (
              <div
                key="today-grid"
                className={cn(
                  'relative flex aspect-[3/4] min-w-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-muted px-3 text-center ring-2 ring-transparent',
                  selected && 'ring-primary',
                )}
              >
                <Camera className="size-5 text-muted-foreground" aria-hidden />
                <p className="text-xs text-muted-foreground">Log today&apos;s photo</p>
                <Button size="sm" onClick={() => setMode('camera')}>
                  Open camera
                </Button>
                <p className="absolute right-2 top-2 text-xs font-medium text-muted-foreground">
                  Day {day}
                  {totalDays !== null && ` / ${totalDays}`}
                </p>
                <p className="absolute bottom-2 text-xs text-muted-foreground">{formatLongDate(new Date())}</p>
              </div>
            );
          }

          const { capture } = slot;
          const src = slotSrc(slot);

          return (
            <button
              key={capture.id}
              type="button"
              onClick={() => openLightbox(i)}
              aria-current={selected}
              aria-label={`Day ${day}`}
              className={cn(
                'relative aspect-[3/4] min-w-0 overflow-hidden rounded-xl bg-muted text-left ring-2 ring-transparent transition-colors',
                selected && 'ring-primary',
              )}
            >
              {src ? (
                <Image
                  src={src}
                  alt={`Day ${day}`}
                  width={1050}
                  height={1400}
                  className="pointer-events-none h-full w-full select-none object-cover"
                  sizes="(min-width: 48rem) 25vw, 100vw"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  Photo not available locally.
                </div>
              )}

              {slotAnalyzed(slot) && <AnalyzedBadge />}

              <p className="pointer-events-none absolute right-2 top-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                Day {day}
                {totalDays !== null && ` / ${totalDays}`}
              </p>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-8 text-center">
                <p className="text-sm font-semibold text-white">{formatLongDate(capture.capturedAt)}</p>
              </div>
            </button>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="icon"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <p className="text-sm text-muted-foreground tabular-nums">
            Page {currentPage + 1} of {pageCount}
          </p>
          <Button
            variant="outline"
            size="icon"
            disabled={currentPage === pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
            aria-label="Next page"
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}

      {/* The lightbox: the old single-frame roll, now reached by clicking a
          tile instead of being the default mobile view. It browses every
          capture in the trial, not just the page the tile came from. */}
      <Dialog
        open={lightboxOpen}
        onOpenChange={(open) => {
          setLightboxOpen(open);
          if (!open) setApi(undefined);
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogTitle className="sr-only">Trial photos</DialogTitle>
          <DialogClose
            aria-label="Close"
            className="absolute right-3 top-3 z-10 rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70"
          />

          <Carousel
            setApi={setApi}
            opts={lightboxOpts}
            className="overflow-hidden rounded-xl bg-muted"
            aria-label="Trial photos"
          >
            <CarouselContent className="ml-0">
              {slots.map((slot, i) => {
                if (slot.kind === 'today') {
                  return (
                    <CarouselItem key="today" className="pl-0">
                      <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 px-6 text-center">
                        <Camera className="size-6 text-muted-foreground" aria-hidden />
                        <p className="text-sm text-muted-foreground">Log today&apos;s photo</p>
                        <div className="mt-1">
                          <Button onClick={() => setMode('camera')}>Open camera</Button>
                        </div>
                      </div>
                    </CarouselItem>
                  );
                }

                const { capture } = slot;
                const src = slotSrc(slot);
                return (
                  <CarouselItem key={capture.id} className="pl-0">
                    {src ? (
                      <Image
                        src={src}
                        alt={`Day ${dayOf(startDate, capture.capturedAt)}`}
                        width={1050}
                        height={1400}
                        className="pointer-events-none w-full select-none object-cover"
                        sizes="24rem"
                        priority={i === lightboxStart}
                        draggable={false}
                      />
                    ) : (
                      <div className="flex aspect-[3/4] items-center justify-center px-8 text-center text-sm text-muted-foreground">
                        This capture&rsquo;s photo isn&rsquo;t available locally.
                      </div>
                    )}
                  </CarouselItem>
                );
              })}
            </CarouselContent>

            {analyzed && <AnalyzedBadge />}

            {/* The day counter rides over every frame, today's included — an empty
                slot is still a day of the trial. It sits top right, clear of the
                dialog's close control, and the scrim below carries the date instead. */}
            <p
              className={cn(
                'pointer-events-none absolute right-16 top-3 z-10 rounded-full px-2 py-0.5 text-xs font-medium backdrop-blur-sm',
                current.kind === 'today' ? 'bg-background/80 text-foreground' : 'bg-black/60 text-white',
              )}
            >
              Day {currentDay}
              {totalDays !== null && ` / ${totalDays}`}
            </p>

            <div
              className={cn(
                'pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4 pt-12 text-center',
                current.kind === 'today'
                  ? 'bg-gradient-to-t from-background to-transparent'
                  : 'bg-gradient-to-t from-black/70 to-transparent',
              )}
            >
              {/* The note sits at the bottom of the picture, right above the date —
                  the photo's own caption, not the app's. */}
              {current.kind === 'capture' && current.capture.note && (
                <p className="mx-auto mb-1 max-w-prose text-sm italic text-white/85">
                  {current.capture.note}
                </p>
              )}

              <p
                className={cn(
                  'text-base font-semibold',
                  current.kind === 'today' ? 'text-foreground' : 'text-white',
                )}
              >
                {current.kind === 'today' ? formatLongDate(new Date()) : formatLongDate(current.capture.capturedAt)}
              </p>

              {sinceApplied && (
                <p className="text-xs text-white/70">
                  {hoursLabel(sinceApplied.hours)} after applying
                  {sinceApplied.assumed && ' (going by your usual time)'}
                </p>
              )}

              {/* The dot is 8px; the button around it is not, or the roll can only be
                  driven by dragging. */}
              {slots.length > 1 && (
                <div className="pointer-events-auto mt-1 flex items-center justify-center">
                  {slots.map((slot, i) => (
                    <button
                      key={slot.kind === 'today' ? 'today' : slot.capture.id}
                      type="button"
                      onClick={() => api?.scrollTo(i)}
                      aria-label={
                        slot.kind === 'today'
                          ? 'Today, no photo yet'
                          : `Day ${dayOf(startDate, slot.capture.capturedAt)}`
                      }
                      aria-current={i === index}
                      className="flex size-6 items-center justify-center"
                    >
                      <span
                        className={cn(
                          'size-2 rounded-full transition-all',
                          current.kind === 'today' ? 'bg-foreground/25' : 'bg-white/45',
                          i === index &&
                            (current.kind === 'today' ? 'scale-150 bg-foreground' : 'scale-150 bg-white'),
                        )}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Carousel>
        </DialogContent>
      </Dialog>

      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-destructive">
          {error}
        </p>
      )}

      {/* The day's note and extra angles, for whichever frame is selected —
          the last one by default, or whichever tile/slide was picked. The
          fixture has neither and canEdit is false there, so it renders nothing. */}
      {current.kind === 'capture' && (
        <CaptureExtras trialId={trialId} capture={current.capture} canEdit={canEdit} />
      )}
    </div>
  );
}
