import { orderConcerns } from '@/lib/concerns';
import type { RoutineSnapshot } from '@/lib/routines';

/**
 * Types and pure helpers only — **no Node built-ins in this file.**
 *
 * Client components import `interventionLabel` and the `Trial` type from here.
 * A single `node:fs` import anywhere in the module drags the whole thing into
 * the browser bundle and fails the Turbopack build with a chunking error that
 * names the route rather than the cause. Reading the fixture off disk lives in
 * `lib/trial-store.ts`, which is marked `server-only`.
 */

export type TrialStatus = 'active' | 'completed';

/**
 * One line of the baseline routine.
 *
 * A bare string is a product typed straight into the trial. A `RoutineSnapshot`
 * is a saved routine the user picked — copied in at creation, never referenced
 * live, so editing that routine later cannot reach back and change what this
 * trial attributed (docs/trial-model.md, and the same rule as `targets[]`).
 */
export type BaselineEntry = string | RoutineSnapshot;

export interface Intervention {
  direction: 'add' | 'remove';
  brand?: string | null;
  name: string;
  startedOn: string;
  targets: string[];
}

export interface Capture {
  id: string;
  capturedAt: string;
  device: string;
  /**
   * Per-concern scores. `raw` is the measurement and the only thing the app
   * computes with — `ui` is Perfect Corp's consumer compression, whose local
   * steepness varies about 3× across the range, so a change derived from it
   * would shrink or exaggerate depending on where the score happens to sit.
   *
   * `synthetic` marks a value that was never measured. The reference series
   * covers seven concerns; the other seven are invented by `seed-trials.mjs` so
   * the UI has fourteen to lay out. Never strip the flag.
   */
  concerns?: Record<string, { raw: number; ui: number | null; synthetic?: boolean }> | null;
  /** Live captures, in private Vercel Blob. Needs a signed URL to render. */
  blobUrl?: string | null;
  /** Fixture captures, under gitignored `public/captures/`. */
  photoUrl?: string | null;
}

/**
 * How often the user intends to log.
 *
 * Drives reminders and what counts as a missed day. It never enters the maths:
 * `se(slope)` reads the real capture timestamps, not the plan, so logging more
 * often than promised always helps and a sparse schedule changes only the error
 * bars (docs/app-ui.md §4).
 *
 * `every-n-days` carries "every other day" (n=2) and "weekly" (n=7) — those are
 * presets on one control, not separate kinds.
 */
export type Frequency =
  | { kind: 'daily' }
  | { kind: 'every-n-days'; n: number }
  | { kind: 'weekdays'; days: number[] }
  | { kind: 'none' };

export interface Trial {
  id: string;
  name: string;
  status: TrialStatus;
  window: {
    startDate: string;
    /** Null is open-ended. A date here is a marker to count toward, never a
     *  lock — the trial ends when the user ends it (docs/trial-model.md). */
    endDate: string | null;
    endDateSource: 'clinician' | 'product-claim' | 'user-chosen' | null;
  };
  frequency: Frequency;
  routine: {
    baseline: BaselineEntry[];
    interventions: Intervention[];
  };
  captures: Capture[];
}

/** What the dashboard card renders. Everything else waits for the detail page. */
export interface TrialCardData {
  trial: Trial;
  /** Days elapsed in the window, 1-indexed. Advances on its own, logged or not. */
  dayNumber: number;
  /** Null on an open-ended trial. The absent denominator *is* the signal — the
   *  card renders `4 Days`, and the ring has nothing to fill toward. */
  totalDays: number | null;
  /** Distinct days with at least one capture. Never resets on a miss. */
  daysLogged: number;
  loggedToday: boolean;
}

const MS_PER_DAY = 86_400_000;

/** Local calendar day as YYYY-MM-DD. Captures are compared by day, not instant. */
function localDay(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / MS_PER_DAY);
}

export function toCardData(trial: Trial, now = new Date()): TrialCardData {
  const { startDate, endDate } = trial.window;
  const totalDays = endDate ? daysBetween(startDate, endDate) + 1 : null;
  const today = localDay(now);

  const elapsed = daysBetween(startDate, today) + 1;
  // An open-ended trial has no ceiling to clamp against; it just keeps counting.
  const dayNumber = Math.max(0, totalDays === null ? elapsed : Math.min(elapsed, totalDays));

  const capturedDays = new Set(trial.captures.map((c) => localDay(new Date(c.capturedAt))));

  return {
    trial,
    dayNumber: trial.status === 'completed' && totalDays !== null ? totalDays : dayNumber,
    totalDays,
    daysLogged: capturedDays.size,
    loggedToday: capturedDays.has(today),
  };
}

/** "+ Acne medication", "− Vitamin C serum". Removals are first-class. */
export function interventionLabel(i: Intervention): string {
  return `${i.direction === 'add' ? '+' : '−'} ${i.name}`;
}

/** Display names for the baseline, whether typed in or carried by a routine. */
export function baselineNames(trial: Trial): string[] {
  return trial.routine.baseline.flatMap((entry) =>
    typeof entry === 'string' ? [entry] : entry.items.map((i) => i.name),
  );
}

/**
 * Every metric the untracked routine already touches.
 *
 * This is the `confounded` column of the attribution table: a metric in here
 * that no intervention targets gets its change *reported* with credit withheld,
 * because something in the background is a live explanation for it. A bare
 * string carries no targets, so a hand-typed baseline confounds nothing — which
 * is precisely the gap saved routines close.
 */
export function baselineTargets(trial: Trial): string[] {
  return orderConcerns(
    trial.routine.baseline.flatMap((entry) => (typeof entry === 'string' ? [] : entry.coverage)),
  );
}
