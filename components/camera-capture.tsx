'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  type Detection,
  type GuideState,
  type LightingReading,
  cropWindow,
  describeHint,
  describeLighting,
  gradeFrame,
  guideOval,
  isAnalysable,
  MIN_SHORT_SIDE,
} from '@/lib/capture-guide';
import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from '@/src/face-geometry.mjs';

/**
 * The live camera, for the daily photo.
 *
 * Standardised capture *is* the measurement — varying lighting alone took
 * texture noise from 2.1 to 57.6 points on photos 39 seconds apart, larger than
 * 18 months of real change — so this screen's job is to make one day's photo
 * comparable to the next, not to take a nice picture.
 *
 * **The frame is fixed and the user moves.** Every capture is the same crop: the
 * largest 3:4 window in the camera's frame, with the guide drawn at
 * `TARGET_FACE_FRACTION` and `FACE_CENTER_Y` inside it. A capture that passes is
 * already normalised, so `computeCropBox()` never re-crops it and pixels-per-cm
 * of skin is constant by construction (`docs/capture-quality.md` §5). Nothing
 * here crops to fix a problem: a face too small means step closer, because
 * cropping in would discard the resolution texture and pore are measured from.
 *
 * **The shutter is manual, and disabled until the frame passes.** Framing, scale
 * and pose gate it; lighting is reported and never blocks, because its threshold
 * is the user's own baseline and there isn't one yet. The predecessor here was
 * Perfect Corp's Camera Kit, which auto-fired 800ms after its own checks passed
 * and demanded the face fill 0.75 of frame — it was slow to load, hard to
 * satisfy, took the moment away from the user, and looked nothing like the rest
 * of the app. Git has it if the pose maths ever needs a second opinion.
 *
 * **There is no upload path.** An existing photo carries whatever framing, light
 * and face scale it was taken under, and every one of those is part of the
 * measurement rather than a property of the picture. The guide only means
 * something if the frame goes through it.
 */

/**
 * Vendored rather than fetched from tfhub.dev, which now 302s to a signed Kaggle
 * URL — a redirect, a third party, and an expiry on the critical path of opening
 * the camera. 460KB, served from our own origin, cached like anything else.
 */
const MODEL_URL = '/models/blazeface/model.json';

/**
 * Detection runs on a downscaled copy of the crop window. BlazeFace resizes to
 * 128×128 internally, so anything above this buys nothing and costs frame time.
 */
const DETECT_WIDTH = 288;
const DETECT_HEIGHT = Math.round((DETECT_WIDTH * OUTPUT_HEIGHT) / OUTPUT_WIDTH);

/** ~8Hz. Fast enough to feel live, slow enough to leave the phone some battery. */
const DETECT_INTERVAL_MS = 120;

/**
 * Requested in this order. iOS honours an exact-ish request by scaling, but some
 * cameras only advertise landscape modes, so the portrait ask gets a second try
 * on its side before we conclude the device cannot produce an analysable frame.
 */
const RESOLUTIONS = [
  { width: 1920, height: 2560 },
  { width: 2560, height: 1920 },
] as const;

/** How long a stream may stay dark before we stop calling it a camera. */
const FRAME_TIMEOUT_MS = 5000;

/**
 * Camera acquisition is serialised across the whole module.
 *
 * React mounts an effect, tears it down and mounts it again in development, so
 * two sessions ask for the camera before either has finished. Chrome gives each
 * its own track and the abandoned one can be stopped harmlessly. **Safari gives
 * the second request the same underlying source**, so when the abandoned session
 * calls `track.stop()` it takes the live session's video down with it — the
 * camera indicator stays lit and the frame stays empty, with no error anywhere.
 *
 * Serialising means an abandoned session has already released the device before
 * the next one asks for it, which is the only ordering where Safari's behaviour
 * is harmless.
 */
let cameraLock: Promise<unknown> = Promise.resolve();

function claimCamera<T>(acquire: () => Promise<T>): Promise<T> {
  const run = cameraLock.then(acquire, acquire);
  // Swallowed so one session's failure cannot reject the next session's turn.
  cameraLock = run.then(
    () => {},
    () => {},
  );
  return run;
}

/**
 * The model is a module-level singleton: reopening the camera should not
 * re-download and re-compile shaders. Nothing here holds a camera or a canvas,
 * so it is safe to outlive the component.
 */
let modelPromise: Promise<BlazeFaceModel> | null = null;

interface BlazeFaceModel {
  estimateFaces(
    input: HTMLCanvasElement,
    returnTensors: false,
  ): Promise<
    {
      topLeft: [number, number] | number[];
      bottomRight: [number, number] | number[];
      landmarks: [number, number][] | number[][];
    }[]
  >;
}

async function loadModel(): Promise<BlazeFaceModel> {
  modelPromise ??= (async () => {
    // Imported here rather than at module scope so tfjs lands in its own chunk
    // and never reaches anyone who does not open the camera.
    const [tf, blazeface] = await Promise.all([
      import('@tensorflow/tfjs-core'),
      import('@tensorflow-models/blazeface'),
    ]);
    await import('@tensorflow/tfjs-backend-webgl');
    await tf.setBackend('webgl');
    await tf.ready();

    const model = (await blazeface.load({ modelUrl: MODEL_URL })) as unknown as BlazeFaceModel;

    // First inference compiles shaders and takes far longer than the rest. Doing
    // it against a blank canvas means the cost lands before the user is waiting
    // on the hint to update rather than during their first frame.
    const warmup = document.createElement('canvas');
    warmup.width = DETECT_WIDTH;
    warmup.height = DETECT_HEIGHT;
    await model.estimateFaces(warmup, false);

    return model;
  })();
  // A failed load should not poison every later attempt.
  modelPromise.catch(() => {
    modelPromise = null;
  });
  return modelPromise;
}

/**
 * Mean luma either side of the face's vertical midline.
 *
 * Measured on the un-mirrored frame, matching the convention the archive photos
 * were measured under — the preview is flipped for the user's benefit and the
 * measurement must not inherit that.
 */
function readLighting(
  ctx: CanvasRenderingContext2D,
  face: Detection,
): LightingReading | null {
  const x = Math.max(0, Math.round(face.x));
  const y = Math.max(0, Math.round(face.y));
  const w = Math.min(Math.round(face.width), ctx.canvas.width - x);
  const h = Math.min(Math.round(face.height), ctx.canvas.height - y);
  if (w < 8 || h < 8) return null;

  const { data } = ctx.getImageData(x, y, w, h);
  const half = Math.floor(w / 2);
  let left = 0;
  let right = 0;
  let leftCount = 0;
  let rightCount = 0;

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = (row * w + col) * 4;
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (col < half) {
        left += luma;
        leftCount++;
      } else {
        right += luma;
        rightCount++;
      }
    }
  }
  if (!leftCount || !rightCount) return null;

  const leftMean = left / leftCount;
  const rightMean = right / rightCount;
  return {
    ratio: rightMean < 1 ? 1 : leftMean / rightMean,
    level: (leftMean + rightMean) / 2 / 255,
  };
}

interface Props {
  onCapture: (file: File) => void;
  onCancel: () => void;
}

export function CameraCapture({ onCapture, onCancel }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const detect = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const model = useRef<BlazeFaceModel | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [guide, setGuide] = useState<GuideState>({
    hint: 'searching',
    ready: false,
    lighting: null,
    faceFraction: null,
    rollDegrees: null,
    yawRatio: null,
  });
  const [capturing, setCapturing] = useState(false);

  // Kept in a ref so the detection loop can depend on nothing, and a parent
  // re-render can never tear the camera down mid-frame.
  const handlers = useRef({ onCapture, onCancel });
  handlers.current = { onCapture, onCancel };

  useEffect(() => {
    let live = true;
    let timer = 0;
    let watchdog = 0;

    const stop = () => {
      window.clearTimeout(timer);
      window.clearInterval(watchdog);
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };

    const fail = (message: string) => {
      if (!live) return;
      stop();
      setError(message);
    };

    /**
     * Acquire a stream this device can actually be measured from, or say why not.
     * Runs inside the module lock, so nothing else holds the camera meanwhile.
     */
    const acquire = async (): Promise<
      { stream: MediaStream } | { message: string } | { abandoned: true }
    > => {
      let best: { width: number; height: number } | null = null;

      for (const size of RESOLUTIONS) {
        let candidate: MediaStream;
        try {
          candidate = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: size.width },
              height: { ideal: size.height },
            },
            audio: false,
          });
        } catch (cause) {
          return { message: describeCameraFailure(cause) };
        }

        const release = () => candidate.getTracks().forEach((t) => t.stop());
        if (!live) {
          release();
          return { abandoned: true };
        }

        const { width = 0, height = 0 } = candidate.getVideoTracks()[0]?.getSettings() ?? {};
        if (isAnalysable(cropWindow(width, height))) return { stream: candidate };

        if (!best || width * height > best.width * best.height) best = { width, height };
        // Released before the next attempt rather than after, so the two asks
        // never overlap on the same device.
        release();
      }

      const across = best ? Math.min(cropWindow(best.width, best.height).width, best.width) : 0;
      return {
        message: best
          ? `This camera gives ${best.width}×${best.height}, which leaves only ${across}px across the face — an HD skin analysis needs ${MIN_SHORT_SIDE}px. A phone camera clears this; on a Mac, so does using your iPhone as the webcam (Continuity Camera).`
          : 'No usable camera was found. Open Grapht on your phone instead.',
      };
    };

    const open = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        fail('This browser cannot open a camera. Open Grapht on your phone instead.');
        return;
      }

      const result = await claimCamera(acquire);
      if ('abandoned' in result) return;
      if ('message' in result) {
        fail(result.message);
        return;
      }
      if (!live) {
        result.stream.getTracks().forEach((t) => t.stop());
        return;
      }

      stream.current = result.stream;
      const element = video.current;
      if (!element) {
        stop();
        return;
      }
      element.srcObject = result.stream;
      // `playsInline` is set on the element too; iOS otherwise takes the video
      // fullscreen the moment it plays and the guide goes with it.
      try {
        await element.play();
      } catch {
        // A muted inline stream is allowed to autoplay everywhere we support. If
        // it is refused anyway the watchdog below is what notices.
      }

      // A stream that never yields a frame looks identical, from the outside, to
      // a camera that never opened — an empty rectangle and no error. Say which.
      let waited = 0;
      watchdog = window.setInterval(() => {
        if (!live || video.current?.videoWidth) {
          window.clearInterval(watchdog);
          return;
        }
        waited += 250;
        if (waited >= FRAME_TIMEOUT_MS) {
          window.clearInterval(watchdog);
          fail(
            'The camera opened but sent no picture. Close anything else using it — another tab, Photo Booth, FaceTime — then try again.',
          );
        }
      }, 250);

      try {
        model.current = await loadModel();
      } catch {
        fail('The face detector could not be loaded. Check your connection, then try again.');
        return;
      }
      if (!live) return;
      setTracking(true);
      loop();
    };

    const loop = () => {
      if (!live) return;
      timer = window.setTimeout(() => {
        void step().finally(loop);
      }, DETECT_INTERVAL_MS);
    };

    const step = async () => {
      const element = video.current;
      const canvas = detect.current;
      const engine = model.current;
      if (!live || !element || !canvas || !engine) return;
      if (!element.videoWidth || !element.videoHeight) return;

      const window_ = cropWindow(element.videoWidth, element.videoHeight);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      // Only the crop window is drawn, so detections come back in the same
      // coordinate space the guide is expressed in — no second mapping to get
      // wrong, and the model never wastes pixels on what will be cropped away.
      ctx.drawImage(
        element,
        window_.x,
        window_.y,
        window_.width,
        window_.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      let raw;
      try {
        raw = await engine.estimateFaces(canvas, false);
      } catch {
        // A dropped WebGL context or a frame that arrived mid-teardown. The next
        // tick re-reads the video; one bad frame is not worth an error screen.
        return;
      }
      if (!live) return;

      const faces: Detection[] = raw.map((face) => ({
        x: face.topLeft[0],
        y: face.topLeft[1],
        width: face.bottomRight[0] - face.topLeft[0],
        height: face.bottomRight[1] - face.topLeft[1],
        landmarks: face.landmarks as [number, number][],
      }));

      const largest = faces.length
        ? [...faces].sort((a, b) => b.width * b.height - a.width * a.height)[0]
        : null;

      setGuide(
        gradeFrame(
          faces,
          { x: 0, y: 0, width: canvas.width, height: canvas.height },
          largest ? readLighting(ctx, largest) : null,
        ),
      );
    };

    void open();
    return () => {
      live = false;
      stop();
    };
  }, []);

  const capture = useCallback(() => {
    const element = video.current;
    if (!element || capturing) return;
    setCapturing(true);

    const window_ = cropWindow(element.videoWidth, element.videoHeight);

    // Never upscale: the API works at 1920×2560 and will resize anything else
    // itself, so inventing pixels here would only inflate the upload.
    const scale = Math.min(1, OUTPUT_WIDTH / window_.width, OUTPUT_HEIGHT / window_.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(window_.width * scale);
    canvas.height = Math.round(window_.height * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCapturing(false);
      setError('That frame could not be saved. Try again.');
      return;
    }
    // Drawn unflipped. The preview is mirrored because that is what a person
    // expects of a front camera; the photograph is not, so it matches every
    // other capture in the series and the archive it is compared against.
    ctx.drawImage(
      element,
      window_.x,
      window_.y,
      window_.width,
      window_.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCapturing(false);
          setError('That frame could not be saved. Try again.');
          return;
        }
        handlers.current.onCapture(
          new File([blob], 'capture.jpg', { type: 'image/jpeg' }),
        );
      },
      'image/jpeg',
      0.92,
    );
  }, [capturing]);

  if (error) {
    return (
      <div className="rounded-xl border border-dashed px-5 py-8 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const oval = guideOval({ x: 0, y: 0, width: 300, height: 400 });
  const lighting = describeLighting(guide.lighting);

  return (
    <div>
      {/*
        `transform-gpu` is not an optimisation. Safari does not reliably clip a
        transformed child — the mirrored video — to a rounded `overflow-hidden`
        parent, and can drop it from the paint entirely; giving the parent its own
        compositing layer is the long-standing fix. Removing it risks a camera
        that runs with nothing on screen.
      */}
      <div className="relative aspect-3/4 transform-gpu overflow-hidden rounded-xl bg-muted">
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 size-full -scale-x-100 object-cover"
        />

        <svg
          viewBox="0 0 300 400"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
          aria-hidden
        >
          <defs>
            <mask id="capture-guide-mask">
              <rect width="300" height="400" fill="white" />
              <ellipse cx={oval.cx} cy={oval.cy} rx={oval.rx} ry={oval.ry} fill="black" />
            </mask>
          </defs>
          <rect
            width="300"
            height="400"
            fill="black"
            opacity={0.45}
            mask="url(#capture-guide-mask)"
          />
          <ellipse
            cx={oval.cx}
            cy={oval.cy}
            rx={oval.rx}
            ry={oval.ry}
            fill="none"
            strokeWidth={2}
            className={
              guide.ready ? 'stroke-primary' : 'stroke-white/70'
            }
          />
        </svg>

        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 p-4">
          <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
            {tracking ? describeHint(guide.hint) : 'Starting the camera'}
          </span>
          {lighting && (
            <span className="rounded-full bg-black/50 px-3 py-1 text-xs text-white/90">
              {lighting}
            </span>
          )}
        </div>
      </div>

      <canvas ref={detect} width={DETECT_WIDTH} height={DETECT_HEIGHT} className="hidden" />

      <div className="mt-4 flex items-center justify-center gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={capture} disabled={!guide.ready || capturing}>
          {capturing ? 'Saving' : 'Take photo'}
        </Button>
      </div>
    </div>
  );
}

function describeCameraFailure(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow it in your browser, then try again.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'The camera could not be opened. It may be in use by another app — close it, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No usable camera was found. Open Grapht on your phone instead.';
  }
  return 'The camera could not be opened. Try again, or open Grapht on your phone.';
}
