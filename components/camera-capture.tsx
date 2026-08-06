'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * The live camera, for the daily photo.
 *
 * Two capture constraints are enforced here, before a unit is spent, because
 * both are free to check and neither is recoverable afterwards:
 *
 * **Short side ≥ 1080px.** A capture below the HD floor is not a valid HD
 * measurement, and the whole series has to be HD — SD and HD are different
 * models for acne, texture and pore and differ by 13–18 points, several times
 * any real biological change. Most laptop webcams top out at 720p, so this
 * fires often and offers the upload path rather than a broken shutter.
 *
 * **Long side ≤ 2560px.** The model works at 1920×2560; anything larger is
 * discarded. Downscaling here beats finding out from a wasted task.
 *
 * The preview is mirrored, because an unmirrored preview of your own face is
 * disorienting. **The file is not** — `drawImage` reads the raw video track, so
 * every capture in a series has the same handedness. Consistency is the point;
 * which way round it is matters much less than that it never changes mid-trial.
 */

const MIN_SHORT_SIDE = 1080;
const MAX_LONG_SIDE = 2560;

interface Props {
  onCapture: (file: File) => void;
  onCancel: () => void;
  /** Offered whenever the camera can't be used, so there is always a way through. */
  onUpload: () => void;
}

export function CameraCapture({ onCapture, onCancel, onUpload }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tooSmall, setTooSmall] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    let opened: MediaStream | null = null;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser has no camera access. Upload a photo instead.');
        return;
      }
      try {
        opened = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1440 },
            height: { ideal: 1920 },
          },
          audio: false,
        });
      } catch (cause) {
        setError(describeCameraFailure(cause));
        return;
      }

      if (!live) {
        opened.getTracks().forEach((t) => t.stop());
        return;
      }
      setStream(opened);

      const settings = opened.getVideoTracks()[0]?.getSettings() ?? {};
      const width = settings.width ?? 0;
      const height = settings.height ?? 0;
      if (Math.min(width, height) < MIN_SHORT_SIDE) {
        setTooSmall(width && height ? `${width}×${height}` : 'too low');
      }
    })();

    // A camera left running after the user navigates away is its own bug.
    return () => {
      live = false;
      opened?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const el = video.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
  }, [stream]);

  const take = useCallback(() => {
    const el = video.current;
    if (!el || !el.videoWidth || !el.videoHeight) return;
    setBusy(true);

    const scale = Math.min(1, MAX_LONG_SIDE / Math.max(el.videoWidth, el.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(el.videoWidth * scale);
    canvas.height = Math.round(el.videoHeight * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setBusy(false);
      setError('This browser could not read a frame from the camera.');
      return;
    }
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        setBusy(false);
        if (!blob) {
          setError('That frame could not be saved. Try again.');
          return;
        }
        onCapture(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  }, [onCapture]);

  if (error) {
    return (
      <div className="rounded-xl border border-dashed px-5 py-8 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={onUpload}>
            Upload a photo
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl bg-muted">
        <video
          ref={video}
          playsInline
          muted
          className="aspect-[3/4] w-full -scale-x-100 object-cover"
        />

        {/* Holds face scale roughly constant between captures — the crop
            fraction drives pixels-per-cm of skin, which drives texture and pore.
            The API also rejects a face under 0.55 of frame height outright. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[68%] w-[52%] rounded-[50%] border-2 border-dashed border-white/70" />
        </div>

        <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-10 text-center text-xs text-white/85">
          Fill the oval with your face, in the same light as last time.
        </p>
      </div>

      {tooSmall && (
        <p className="mt-3 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          This camera records at {tooSmall}, below the 1080px minimum an HD skin
          analysis needs. Use your phone, or upload a photo taken on one.
        </p>
      )}

      <div className="mt-4 flex items-center justify-center gap-2">
        <Button onClick={take} disabled={!stream || busy || tooSmall !== null}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Camera aria-hidden />}
          Take photo
        </Button>
        <Button variant="outline" onClick={onUpload}>
          Upload instead
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function describeCameraFailure(cause: unknown): string {
  const name = (cause as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow it in your browser, or upload a photo instead.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found. Upload a photo instead.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is in use by another app. Close it, or upload a photo instead.';
  }
  return `The camera could not be opened — ${(cause as Error)?.message ?? 'unknown error'}.`;
}
