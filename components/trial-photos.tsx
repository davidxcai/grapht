'use client';

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Camera, Loader2 } from 'lucide-react';

import { CameraCapture } from '@/components/camera-capture';
import { Button } from '@/components/ui/button';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';
import { logCapture } from '@/app/trials/actions';
import { concernLabel } from '@/lib/concerns';
import { readingAtCapture, type MetricChange, type Reading } from '@/lib/trial-detail';
import type { Capture } from '@/lib/trials';
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
 * **Today is a frame in the roll, not a card beneath it.** When today has no
 * photo the last slot is an empty frame carrying the camera and upload buttons,
 * and the tab opens on it — so what you land on is the thing you came to do,
 * with yesterday's face one swipe back. It keeps the day counter, because it *is*
 * today, and carries no metric overlay, because nothing has been measured yet.
 *
 * The roll is Embla (`components/ui/carousel`) rather than a scroll-snap
 * container we drive ourselves. The hand-rolled version landed on the opening
 * frame by writing `scrollLeft` after mount, which lost the race against layout
 * often enough that the caption said "Today" over the day-1 photograph. Embla
 * takes the opening frame as an option, so there is no landing to lose.
 */

interface Props {
  trialId: string;
  captures: Capture[];
  changes: MetricChange[];
  startDate: string;
  totalDays: number | null;
  /** Today's day number, computed server-side so the counter can't drift. */
  dayNumber: number;
  /** An active trial offers a today slot; an ended one is a closed record. */
  canCapture: boolean;
  loggedToday: boolean;
}

type Slot = { kind: 'capture'; capture: Capture } | { kind: 'today' };

const MS_PER_DAY = 86_400_000;

function dayOf(startDate: string, capturedAt: string): number {
  return Math.round((Date.parse(capturedAt.slice(0, 10)) - Date.parse(startDate)) / MS_PER_DAY) + 1;
}

/**
 * The overlay sits on a photograph, so it cannot use the theme's foreground
 * colours — it is always light-on-dark over a scrim.
 */
const OVERLAY_TONE = {
  improved: 'text-emerald-300',
  declined: 'text-rose-300',
  flat: 'text-white/70',
} as const;

/** Sign taken from the rounded figure, so a −0.4 never renders as "−0". */
function signed(change: number): string {
  const n = Math.round(change);
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '−'}${Math.abs(n)}`;
}

export function TrialPhotos({
  trialId,
  captures,
  changes,
  startDate,
  totalDays,
  dayNumber,
  canCapture,
  loggedToday,
}: Props) {
  const showToday = canCapture && !loggedToday;

  const slots: Slot[] = useMemo(
    () => [
      ...[...captures]
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
        .map((capture) => ({ kind: 'capture' as const, capture })),
      ...(showToday ? [{ kind: 'today' as const }] : []),
    ],
    [captures, showToday],
  );

  const last = Math.max(0, slots.length - 1);
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(last);

  // `startIndex` opens the roll on the last slot — today's frame when there is
  // one, the most recent photo otherwise. It is also re-applied on every reinit,
  // which is what moves the roll onto today's photo once it has been logged.
  const opts = useMemo(() => ({ startIndex: last, align: 'start' as const }), [last]);

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
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
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
      const result = await logCapture(trialId, photo, navigator.userAgent);
      if (result.ok) {
        cancel();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  const filePicker = (
    <input
      ref={fileInput}
      type="file"
      accept="image/jpeg,image/png"
      className="sr-only"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) accept(file);
      }}
    />
  );

  // Capturing takes over the whole area rather than living inside a frame: the
  // roll's drag handler and a live camera would be fighting for the same
  // pointer, and there is nothing to browse mid-capture anyway.
  if (mode === 'camera') {
    return (
      <div>
        {filePicker}
        <CameraCapture
          onCapture={accept}
          onCancel={cancel}
          onUpload={() => fileInput.current?.click()}
        />
      </div>
    );
  }

  if (mode === 'review' && preview) {
    return (
      <div>
        {filePicker}
        <div className="overflow-hidden rounded-xl bg-muted">
          {/* A local object URL, not a remote asset the Image loader could optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Today's photo, before you keep it" className="w-full" />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-center gap-2">
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {pending ? 'Analysing your photo…' : 'Keep this photo'}
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

  const current = slots[index] ?? slots[slots.length - 1];
  const currentDay =
    current.kind === 'today' ? dayNumber : dayOf(startDate, current.capture.capturedAt);

  // Only the tracked metrics go on the photo. All fourteen are collected and all
  // fourteen are on Progress; three is what fits over a face. Today's empty
  // frame gets none — nothing has been measured yet.
  const overlay =
    current.kind === 'capture'
      ? changes
          .filter((m) => m.tracked)
          .slice(0, 3)
          .map((metric) => ({ metric, at: readingAtCapture(metric, current.capture.id) }))
          .filter((row): row is { metric: MetricChange; at: Reading } => row.at !== null)
      : [];

  return (
    <div>
      {filePicker}

      <Carousel
        setApi={setApi}
        opts={opts}
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
                    <p className="text-sm text-muted-foreground">No photo for today.</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Button onClick={() => setMode('camera')}>Open camera</Button>
                      <Button variant="outline" onClick={() => fileInput.current?.click()}>
                        Upload
                      </Button>
                    </div>
                  </div>
                </CarouselItem>
              );
            }

            const { capture } = slot;
            const src = capture.photoUrl ?? capture.blobUrl ?? null;
            return (
              <CarouselItem key={capture.id} className="pl-0">
                {src ? (
                  <Image
                    src={src}
                    alt={`Day ${dayOf(startDate, capture.capturedAt)}`}
                    width={1050}
                    height={1400}
                    className="pointer-events-none w-full select-none object-cover"
                    sizes="(max-width: 42rem) 100vw, 42rem"
                    priority={i === slots.length - 1}
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

        {overlay.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/65 to-transparent px-4 pb-10 pt-4">
            {/* A grid rather than rows so the scores line up under each other when
                a trial tracks more than one metric. */}
            <div className="grid w-fit grid-cols-[auto_auto_auto] items-baseline gap-x-3 gap-y-0.5 text-sm">
              {overlay.map(({ metric, at }) => (
                <Fragment key={metric.concern}>
                  <span className="text-white/85">{concernLabel(metric.concern)}</span>
                  <span className="tabular-nums text-white/75">
                    {at.change === null
                      ? Math.round(at.value)
                      : `${Math.round(at.first)} → ${Math.round(at.value)}`}
                  </span>
                  <span className={cn('font-medium tabular-nums', OVERLAY_TONE[at.direction])}>
                    {at.change === null ? '' : signed(at.change)}
                  </span>
                </Fragment>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-white/55">
              {index === 0 ? 'where you started' : `day 1 → day ${currentDay}`}
            </p>
          </div>
        )}

        {/* The day counter rides over every frame, today's included — an empty
            slot is still a day of the trial. On that frame the scrim also has to
            work against the theme background rather than a photograph, which is
            why the label carries its own contrast. */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4 pt-12 text-center',
            current.kind === 'today'
              ? 'bg-gradient-to-t from-background to-transparent'
              : 'bg-gradient-to-t from-black/70 to-transparent',
          )}
        >
          <p
            className={cn(
              'text-base font-semibold',
              current.kind === 'today' ? 'text-foreground' : 'text-white',
            )}
          >
            Day {currentDay}
            {totalDays !== null && ` / ${totalDays}`}
          </p>

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

      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="mt-3 text-center text-xs text-muted-foreground">
        {current.kind === 'today'
          ? 'Today'
          : new Date(current.capture.capturedAt).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
      </p>
    </div>
  );
}
