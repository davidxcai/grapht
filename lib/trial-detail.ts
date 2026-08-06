import offsetTable from '@/fixtures/device-offsets.json';

import { CONCERNS, orderConcerns } from '@/lib/concerns';
import type { Capture, Trial } from '@/lib/trials';

/**
 * What the trial detail page renders: per-metric change, the photo series, and
 * the logging record.
 *
 * Two decisions from the product spec are implemented here rather than in the
 * components, because getting either wrong changes what the app claims.
 *
 * **The headline number is today minus day one.** Not a fitted slope. A slope is
 * the less noisy estimate, but showing "+7" next to "improved by 3" is
 * incoherent to anyone who isn't running an experiment for a living — and the
 * question people actually ask is "how do I look now versus when I started,"
 * which is a two-point question. The slope still appears, as the trend line on
 * the graph, where it reads as shape rather than as a competing number.
 *
 * **Scores run 0–100 and higher is healthier** (rule 1). A drop in `acne` means
 * acne got worse. Every direction in this file derives from the sign of the
 * change, never from the metric's name.
 */

export type Direction = 'improved' | 'declined' | 'flat';

const MS_PER_DAY = 86_400_000;

/**
 * Imported rather than read off disk on purpose. The metric types in this module
 * are shared with client components, and a `node:fs` call anywhere in the file
 * drags the whole module into the browser bundle and fails the build.
 */
const OFFSETS = offsetTable as {
  baseline: string;
  offsetToBaseline: Record<string, Record<string, number | null>>;
};

/**
 * Rule 6: raw scores from different cameras are not comparable. The offsets
 * reach 87 points on pore between an iPad Pro and an iPhone 16e, so a series
 * that changes phones mid-way must be corrected or every number after the switch
 * is fiction.
 *
 * Rule 7: the correction is additive and deliberately **not** clamped to 0–100.
 * Corrected pore legitimately reaches −5.9 in the reference data. Clipping would
 * hide precisely the cases where the correction is least trustworthy.
 *
 * A concern with no measured offset — the seven synthesised ones — passes
 * through unchanged.
 */
function correct(raw: number, metric: string, device: string): number {
  const offset = OFFSETS.offsetToBaseline[device]?.[metric];
  return offset === null || offset === undefined ? raw : raw + offset;
}

/**
 * Per-metric measurement wobble, in points, derived from the two clean burst
 * pairs in the reference dataset — photos 9 and 31 seconds apart under held
 * lighting, where any difference is the instrument rather than the face.
 *
 * Observed spreads: acne 6.3–7.5, pore 9.2–10.6, redness 5.8–10.4,
 * oiliness 3.9–7.9, radiance 0.8–2.3, texture 0.1–2.1, age_spot 0.4–0.9.
 *
 * These are doubled here. Instrument noise understates real day-to-day scatter
 * by 1.1–3.4× (`docs/measurements.md`, Finding 5), and CLAUDE.md requires the
 * conservative figure, so 2× the burst spread lands inside the measured band
 * without needing a calibration step the user would have to pay for in units.
 *
 * The third burst in the dataset is excluded on purpose: its lighting was varied
 * deliberately and it produced a 57.6-point texture spread in 39 seconds. That
 * is a capture failure, not a noise floor, and `docs/capture-quality.md` owns it.
 *
 * The synthesised seven have no measured basis at all. Their values here are
 * placeholders in the same spirit as their scores.
 */
export const WOBBLE: Record<string, number> = {
  acne: 14,
  texture: 2,
  redness: 16,
  oiliness: 12,
  radiance: 3,
  age_spot: 1.5,
  pore: 20,
  moisture: 8,
  wrinkle: 3,
  dark_circle_v2: 6,
  eye_bag: 5,
  firmness: 4,
  droopy_upper_eyelid: 3,
  droopy_lower_eyelid: 3,
};

export interface MetricChange {
  concern: string;
  /** Device-corrected day-one value. */
  first: number;
  /** Device-corrected most-recent value. */
  latest: number;
  /** `latest - first`. Positive is always healthier, whatever the metric. */
  change: number;
  /** Green / red / white. `flat` means it moved less than the camera's wobble. */
  direction: Direction;
  /** How much this metric has to move before we are willing to call it. */
  wobble: number;
  /**
   * Every capture, for the graph — and for the per-photo overlay, which needs
   * the value *at the photo being looked at* rather than the trial total.
   */
  series: { day: number; date: string; value: number; captureId: string }[];
  /** True when the trial's interventions name this concern. */
  tracked: boolean;
  /** True when the untracked baseline routine already covers it. */
  confounded: boolean;
  /** True when no measurement exists and the number is invented. */
  synthetic: boolean;
}

function dayIndex(from: string, at: string): number {
  return Math.round((Date.parse(at.slice(0, 10)) - Date.parse(from)) / MS_PER_DAY);
}

function valueOf(capture: Capture, metric: string): number | null {
  const entry = capture.concerns?.[metric];
  if (!entry || typeof entry.raw !== 'number') return null;
  return correct(entry.raw, metric, capture.device);
}

/**
 * The direction shown to the user.
 *
 * A metric that moved less than its wobble is reported as no measurable change —
 * a statement about the camera, never a verdict on the product being trialled.
 * The number is still displayed; only the colour and the word are withheld.
 */
export function directionOf(change: number, wobble: number): Direction {
  if (Math.abs(change) <= wobble) return 'flat';
  return change > 0 ? 'improved' : 'declined';
}

export interface Reading {
  /** Device-corrected day-one value. */
  first: number;
  /** Device-corrected value at this capture. */
  value: number;
  /** `value - first`. Null on the baseline capture, which is not a change. */
  change: number | null;
  direction: Direction;
}

/**
 * One metric as measured at one specific capture, with the change from day one.
 *
 * The photo overlay must use this rather than `MetricChange.change`, which is
 * always first-to-latest. Showing the trial total on top of the day-1 photo
 * reads as though that photo already contained the improvement.
 *
 * Both endpoints come back, not just the difference, because a bare "−12" over a
 * face is unverifiable — the user cannot tell whether the app is reading the
 * photo they are looking at. `50 → 37` they can check against the picture.
 *
 * `change` is null on the baseline capture: there is nothing to compare against
 * at the point the measuring started, and rendering `0` would imply otherwise.
 */
export function readingAtCapture(metric: MetricChange, captureId: string): Reading | null {
  const first = metric.series[0];
  const point = metric.series.find((p) => p.captureId === captureId);
  if (!first || !point) return null;
  if (point.captureId === first.captureId) {
    return { first: first.value, value: point.value, change: null, direction: 'flat' };
  }
  const change = point.value - first.value;
  return {
    first: first.value,
    value: point.value,
    change,
    direction: directionOf(change, metric.wobble),
  };
}

export function metricChanges(trial: Trial): MetricChange[] {
  const captures = [...trial.captures].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  if (captures.length === 0) return [];

  const tracked = new Set(trial.routine.interventions.flatMap((i) => i.targets));
  const confounded = new Set(
    trial.routine.baseline.flatMap((entry) => (typeof entry === 'string' ? [] : entry.coverage)),
  );
  const start = trial.window.startDate;

  return CONCERNS.map((concern) => {
    const series = captures
      .map((capture) => {
        const value = valueOf(capture, concern);
        return value === null
          ? null
          : {
              day: dayIndex(start, capture.capturedAt),
              date: capture.capturedAt.slice(0, 10),
              value,
              captureId: capture.id,
            };
      })
      .filter((p): p is MetricChange['series'][number] => p !== null);

    const first = series[0]?.value ?? 0;
    const latest = series[series.length - 1]?.value ?? 0;
    const change = latest - first;
    const wobble = WOBBLE[concern] ?? 5;

    return {
      concern,
      first,
      latest,
      change,
      // A single capture is a starting point, not a change. Never call it flat —
      // that would read as "nothing happened" when nothing has been asked yet.
      direction: series.length < 2 ? 'flat' : directionOf(change, wobble),
      wobble,
      series,
      tracked: tracked.has(concern),
      confounded: confounded.has(concern),
      synthetic: captures[0].concerns?.[concern] !== undefined &&
        (captures[0].concerns[concern] as { synthetic?: boolean }).synthetic === true,
    };
  }).filter((m) => m.series.length > 0);
}

/* ------------------------------------------------------------- the record */

export interface LogRecord {
  /** Every day in the window, oldest first, for the calendar. */
  days: { date: string; captures: Capture[]; inWindow: boolean }[];
  daysLogged: number;
  dayNumber: number;
  totalDays: number | null;
  /** Null when open-ended or already finished. */
  daysRemaining: number | null;
  loggedToday: boolean;
}

function localDay(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function logRecord(trial: Trial, now = new Date()): LogRecord {
  const { startDate, endDate } = trial.window;
  const today = localDay(now);

  const byDay = new Map<string, Capture[]>();
  for (const capture of trial.captures) {
    const key = localDay(new Date(capture.capturedAt));
    byDay.set(key, [...(byDay.get(key) ?? []), capture]);
  }

  const totalDays = endDate ? dayIndex(startDate, endDate) + 1 : null;
  const elapsed = dayIndex(startDate, today) + 1;
  const dayNumber =
    trial.status === 'completed' && totalDays !== null
      ? totalDays
      : Math.max(1, totalDays === null ? elapsed : Math.min(elapsed, totalDays));

  // The calendar runs to whichever is later: the marker, or the last capture.
  // Logging past your own end date is allowed and those captures are real data.
  const lastDay = [...byDay.keys()].sort().pop() ?? startDate;
  const finalDay = endDate && endDate > lastDay ? endDate : lastDay;

  const days: LogRecord['days'] = [];
  for (let i = 0; i <= dayIndex(startDate, finalDay); i++) {
    const cursor = new Date(`${startDate}T00:00:00`);
    cursor.setDate(cursor.getDate() + i);
    const date = localDay(cursor);
    days.push({ date, captures: byDay.get(date) ?? [], inWindow: true });
  }

  const remaining = totalDays === null ? null : totalDays - dayNumber;

  return {
    days,
    daysLogged: byDay.size,
    dayNumber,
    totalDays,
    daysRemaining: trial.status === 'completed' || remaining === null ? null : Math.max(0, remaining),
    loggedToday: byDay.has(today),
  };
}

/** The metrics the trial's interventions name, in canonical order. */
export function trackedConcerns(trial: Trial): string[] {
  return orderConcerns(trial.routine.interventions.flatMap((i) => i.targets));
}
