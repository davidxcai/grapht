/**
 * The capture guide: where the face has to be, and whether it is there yet.
 *
 * Pure geometry — no DOM, no camera, no model — so the thresholds can be read
 * and argued with in one place instead of being buried in a render loop.
 *
 * **The frame is fixed and the user moves.** Every capture is cropped to the same
 * window: the largest 3:4 portrait rectangle centred in the camera's frame. The
 * guide is drawn at `TARGET_FACE_FRACTION` and `FACE_CENTER_Y` inside that
 * window, so a capture that passes is *already normalised* — `computeCropBox()`
 * never has to clamp it afterwards, and pixels-per-cm of skin is constant by
 * construction rather than by correction (`docs/capture-quality.md` §5).
 *
 * That is also why nothing here crops to fix a problem. A face that is too small
 * means step closer; cropping in to hit 0.55 would throw away exactly the
 * resolution that texture and pore are measured from (CLAUDE.md rule 3).
 */

// Relative rather than `@/src/...` so `scripts/test-capture-guide.mjs` can import
// this file directly under Node's type stripping, which does not read tsconfig
// paths. Nothing else in here needs a bundler either.
import {
  FACE_CENTER_Y,
  FACE_FRACTION_TOLERANCE,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  TARGET_FACE_FRACTION,
} from '../src/face-geometry.mjs';

export { FACE_CENTER_Y, TARGET_FACE_FRACTION };

/** The analysis needs this on the short side for HD; below it, nothing works. */
export const MIN_SHORT_SIDE = 1080;

/**
 * Head pose limits, in the frame's own terms.
 *
 * **Inferred, not measured** — `docs/capture-quality.md` §5 is explicit that all
 * 20 reference photos are deliberate, well-posed selfies, so their range
 * (roll −3.4°…+4.9°, yaw −0.08…+0.03) shows what good looks like and says
 * nothing about where the boundary is. These are that document's proposed
 * starting points. They are deliberately loose: the cost of being generous is a
 * slightly turned head, and the cost of being strict is a camera nobody can
 * satisfy, which is the failure the Camera Kit shipped with.
 */
export const MAX_ROLL_DEGREES = 10;
export const MAX_YAW_RATIO = 0.15;

/**
 * How far the face centre may sit from the guide, as a fraction of the window.
 *
 * Relaxed from 0.06 to 0.20 for better UX and to reduce button flickering.
 * Unlike the others this is an affordance rather than a measurement threshold,
 * and it is worth being honest about which is which. The crop window is fixed,
 * so a face off-centre produces a photo with the face off-centre — the API
 * scores the face it finds and does not care where in the frame it sat. What
 * this actually defends is consistency between one day and the next.
 */
export const MAX_CENTER_OFFSET = 0.20;

/** BlazeFace's six landmarks, in the order the model returns them. */
export const Landmark = {
  RightEye: 0,
  LeftEye: 1,
  Nose: 2,
  Mouth: 3,
  RightEar: 4,
  LeftEar: 5,
} as const;

export interface Detection {
  /** Face box, in the crop window's pixel coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Six [x, y] pairs, same coordinate space as the box. */
  landmarks: [number, number][];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the user is told to do next, worst problem first. */
export type Hint =
  | 'searching'
  | 'multiple-faces'
  | 'move-closer'
  | 'move-back'
  | 'center-face'
  | 'level-head'
  | 'face-forward'
  | 'ready';

export interface GuideState {
  hint: Hint;
  /** Framing and pose all pass — the shutter may fire. */
  ready: boolean;
  /** Left/right face brightness. Advisory; see `describeLighting`. */
  lighting: LightingReading | null;
  faceFraction: number | null;
  rollDegrees: number | null;
  yawRatio: number | null;
}

/**
 * The largest 3:4 portrait window centred in a camera frame.
 *
 * Fixed for the whole session, because it is the crop: deriving it per frame
 * from where the face happens to be is what makes face scale drift across a
 * series.
 */
export function cropWindow(frameWidth: number, frameHeight: number): Rect {
  const aspect = OUTPUT_WIDTH / OUTPUT_HEIGHT;
  let width = frameWidth;
  let height = width / aspect;
  if (height > frameHeight) {
    height = frameHeight;
    width = height * aspect;
  }
  return {
    x: Math.round((frameWidth - width) / 2),
    y: Math.round((frameHeight - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Whether a window can produce a photo the HD analysis will accept at all. */
export function isAnalysable(window: Rect): boolean {
  return Math.min(window.width, window.height) >= MIN_SHORT_SIDE;
}

/**
 * The guide oval, in window pixels.
 *
 * Ellipse rather than box because a face is one, and because an outline the user
 * fills reads as a target where a rectangle reads as a crop mark. The width
 * comes from the same face box the checks use, so what is drawn and what is
 * measured cannot disagree.
 */
export function guideOval(window: Rect): { cx: number; cy: number; rx: number; ry: number } {
  const faceHeight = window.height * TARGET_FACE_FRACTION;
  return {
    cx: window.width / 2,
    cy: window.height * FACE_CENTER_Y,
    // BlazeFace boxes run appreciably taller than wide; 0.78 traces a head at
    // the scale the box implies rather than a circle around it.
    rx: (faceHeight * 0.78) / 2,
    ry: faceHeight / 2,
  };
}

export interface LightingReading {
  /** Mean luma of the left half of the face over the right half. */
  ratio: number;
  /** Mean luma across the face box, 0–1. Low means the room is too dark. */
  level: number;
}

/**
 * Head roll from the eye line, in degrees. Positive is head tilted to their left.
 */
export function rollDegrees(landmarks: [number, number][]): number {
  const [rx, ry] = landmarks[Landmark.RightEye];
  const [lx, ly] = landmarks[Landmark.LeftEye];
  return (Math.atan2(ly - ry, lx - rx) * 180) / Math.PI;
}

/**
 * Yaw proxy: how far the nose sits from the midpoint of the eyes, in eye-widths.
 *
 * A ratio rather than an angle because it needs no camera intrinsics and no head
 * model, and because the reference range in `docs/capture-quality.md` is
 * expressed the same way.
 */
export function yawRatio(landmarks: [number, number][]): number {
  const [rx] = landmarks[Landmark.RightEye];
  const [lx] = landmarks[Landmark.LeftEye];
  const [nx] = landmarks[Landmark.Nose];
  const eyeDistance = Math.abs(lx - rx);
  if (eyeDistance < 1) return 0;
  return (nx - (rx + lx) / 2) / eyeDistance;
}

/**
 * Grade a frame. One hint at a time, worst first — a camera that lists four
 * problems at once is a camera nobody reads.
 */
export function gradeFrame(
  faces: Detection[],
  window: Rect,
  lighting: LightingReading | null,
): GuideState {
  const idle: GuideState = {
    hint: 'searching',
    ready: false,
    lighting,
    faceFraction: null,
    rollDegrees: null,
    yawRatio: null,
  };

  if (faces.length === 0) return idle;

  // Largest wins, so a reflection or someone in the background cannot steal the
  // frame — the same rule `detectFace()` applies server-side.
  const sorted = [...faces].sort((a, b) => b.width * b.height - a.width * a.height);
  const face = sorted[0];

  // Only a second face of comparable size is a real ambiguity. Anything much
  // smaller is the background, which is not a reason to refuse to capture.
  const second = sorted[1];
  if (second && second.height > face.height * 0.6) {
    return { ...idle, hint: 'multiple-faces' };
  }

  const faceFraction = face.height / window.height;
  const roll = rollDegrees(face.landmarks);
  const yaw = yawRatio(face.landmarks);
  const measured = { ...idle, faceFraction, rollDegrees: roll, yawRatio: yaw };

  if (faceFraction < TARGET_FACE_FRACTION - FACE_FRACTION_TOLERANCE) {
    return { ...measured, hint: 'move-closer' };
  }
  if (faceFraction > TARGET_FACE_FRACTION + FACE_FRACTION_TOLERANCE) {
    return { ...measured, hint: 'move-back' };
  }

  const centerX = (face.x + face.width / 2) / window.width;
  const centerY = (face.y + face.height / 2) / window.height;
  const offCentre =
    Math.abs(centerX - 0.5) > MAX_CENTER_OFFSET ||
    Math.abs(centerY - FACE_CENTER_Y) > MAX_CENTER_OFFSET;
  if (offCentre) return { ...measured, hint: 'center-face' };

  if (Math.abs(roll) > MAX_ROLL_DEGREES) return { ...measured, hint: 'level-head' };
  if (Math.abs(yaw) > MAX_YAW_RATIO) return { ...measured, hint: 'face-forward' };

  return { ...measured, hint: 'ready', ready: true };
}

export function describeHint(hint: Hint): string {
  switch (hint) {
    case 'searching':
      return 'Looking for your face';
    case 'multiple-faces':
      return 'More than one face in frame';
    case 'move-closer':
      return 'Move a little closer';
    case 'move-back':
      return 'Move back a little';
    case 'center-face':
      return 'Line your face up with the outline';
    case 'level-head':
      return 'Level your head';
    case 'face-forward':
      return 'Look straight at the camera';
    case 'ready':
      return 'Hold still';
  }
}

/**
 * Lighting is reported, never enforced.
 *
 * `docs/capture-quality.md` measured the left/right ratio as the single best
 * discriminator of bad lighting it tested — but the baseline is **the user's
 * own** (≈1.12 for the reference subject, not 1.0), so there is no universal
 * band to gate on, and that document's own lean on the open question is warn
 * rather than block. Blocking on an unvalidated constant is how a camera becomes
 * impossible to satisfy.
 *
 * The numbers below are therefore chosen to be quiet: they fire on the varied
 * burst's extremes (0.88 and 1.51) and on nothing in the controlled set
 * (1.09–1.16). Once a user has a capture history this should compare against
 * their own rolling median instead, which is the check as designed.
 */
export function describeLighting(reading: LightingReading | null): string | null {
  if (!reading) return null;
  if (reading.level < 0.18) return 'The room is quite dark — more light gives a cleaner reading';
  if (reading.ratio < 0.9 || reading.ratio > 1.25) {
    return 'The light is stronger on one side of your face';
  }
  return null;
}
