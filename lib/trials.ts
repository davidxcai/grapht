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
 * Who can read this trial. `private` is the default everywhere — in the form, in
 * the column default, and in the backfill — so a trial is never published by
 * omission. `public` opens the whole trial to the community, running or
 * finished; the user can move it either way at any time.
 */
export type TrialVisibility = 'private' | 'public';

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
  /** How much per use ("2 pumps", "0.5 mg"). Display only — never the maths. */
  dosage?: string | null;
  /** FK into `catalog_products`, set only when this item came from a catalog
   *  pick. Read-only enrichment — never a source for `targets[]`, which stay
   *  the frozen identity the item was added under. */
  catalogProductId?: string | null;
  /** Joined live from `catalog_products.image_url` via `catalogProductId`,
   *  never stored. Null for an item with no catalog match. */
  image?: string | null;
}

/** An extra angle attached to one day's capture. Never analysed, so it costs
 *  no units and carries no scores — qualitative context only. */
export interface ExtraPhoto {
  id: string;
  url: string;
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
   * covers seven concerns; the other eight are invented by `seed-trials.mjs` so
   * the UI has fifteen to lay out. Never strip the flag.
   */
  concerns?: Record<string, { raw: number; ui: number | null; synthetic?: boolean }> | null;
  /** Live captures, in private Vercel Blob. Needs a signed URL to render. */
  blobUrl?: string | null;
  /** Fixture captures, under gitignored `public/captures/`. */
  photoUrl?: string | null;
  /** The user's note on this photo — context the picture can't carry. */
  note?: string | null;
  /** Additional angles for this day, below the analysed photo. */
  extraPhotos?: ExtraPhoto[];
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

/**
 * Which routine this trial sits on — morning and night are separate logs
 * (docs/app-ui.md, "One routine, and what that costs"). Defaults to `'am'`.
 */
export type TimeOfDay = 'am' | 'pm';

export interface Trial {
  id: string;
  name: string;
  status: TrialStatus;
  visibility: TrialVisibility;
  /** Photos are private by default, even when the trial is public. */
  photosVisibility: TrialVisibility;
  window: {
    startDate: string;
    /** Null is open-ended. A date here is a marker to count toward, never a
     *  lock — the trial ends when the user ends it (docs/trial-model.md). */
    endDate: string | null;
    endDateSource: 'clinician' | 'product-claim' | 'user-chosen' | null;
  };
  timeOfDay: TimeOfDay;
  frequency: Frequency;
  routine: {
    baseline: BaselineEntry[];
    interventions: Intervention[];
  };
  captures: Capture[];
  /** "Applied products" check-ins, ISO instants, oldest first. Server-stamped. */
  applications?: string[];
  /** Whether readers of a public trial may comment. The owner's switch. */
  commentsEnabled?: boolean;
  /** Signed-in non-owners who opened this trial while public. */
  viewCount?: number;
  /** The Gemini-written retrospective, once the owner asks for one. */
  summary?: { text: string; model: string; generatedAt: string } | null;
  /** The owner's own words on the finished trial. */
  userReview?: string | null;
}

/** How long after applying products a photo was taken. */
export interface TimeSinceApplied {
  hours: number;
  /**
   * True when no check-in landed in the 24h before this capture and the gap is
   * projected from the last check-in's clock time — the "you forgot to press
   * the button" fallback, and it says so rather than passing as measured.
   */
  assumed: boolean;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Hours between the routine application and a capture.
 *
 * The nearest check-in at or before the capture wins. If it is more than 24
 * hours old the user likely forgot to check in, so the gap is computed against
 * that check-in's clock time on the most recent day before the capture — the
 * ideas.md rule: pressed at 10pm once, a 7am photo two days later still reads
 * as 9 hours, flagged as assumed. No check-ins at all means nothing to report.
 */
export function timeSinceApplied(
  applications: string[] | undefined,
  capturedAt: string,
): TimeSinceApplied | null {
  const at = Date.parse(capturedAt);
  const before = (applications ?? [])
    .map((a) => Date.parse(a))
    .filter((t) => Number.isFinite(t) && t <= at)
    .sort((a, b) => a - b);
  const last = before[before.length - 1];
  if (last === undefined) return null;

  const gap = (at - last) / MS_PER_HOUR;
  if (gap <= 24) return { hours: gap, assumed: false };

  // Project the last check-in's clock time forward to the last occurrence
  // before the capture.
  const projected = last + Math.floor((at - last) / (24 * MS_PER_HOUR)) * 24 * MS_PER_HOUR;
  return { hours: (at - projected) / MS_PER_HOUR, assumed: true };
}

/** "8 h", "3.5 h" — halves are the finest anyone can honestly claim here. */
export function hoursLabel(hours: number): string {
  const rounded = Math.round(hours * 2) / 2;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} h`;
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
  // 1-indexed (see the field doc above) — a trial that exists is on at least day 1.
  const dayNumber = Math.max(1, totalDays === null ? elapsed : Math.min(elapsed, totalDays));

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

/**
 * The union of every intervention's `targets[]` — what the trial can actually
 * attribute a change to, as opposed to `baselineTargets()`, which it can only
 * confound. This is the dashboard card's "what it tracks" (docs/app-ui.md §3).
 */
export function interventionTargets(trial: Trial): string[] {
  return orderConcerns(trial.routine.interventions.flatMap((i) => i.targets));
}

/**
 * How many of this trial's captures were actually analysed by YouCam.
 *
 * Since the pivot away from analysing every daily log, this is at most two: the
 * initial capture (always analysed, at trial creation) and the final capture
 * (analysed at trial end — fresh, or retroactively from the latest logged
 * photo). Everything else is a stored-but-unscored daily log.
 */
export function analyzedCaptureCount(trial: Trial): number {
  return trial.captures.filter((c) => c.concerns).length;
}

/**
 * A trial that ended with only its initial photo ever analysed — no final
 * measurement, so there is nothing to compare it against.
 *
 * Deliberately computed rather than stored: `status` stays a plain
 * `'active' | 'completed'`, and the moment a follow-up photo is analysed
 * (`addFinalPhoto` in app/trials/actions.ts, the one exception to "ended is
 * immutable"), this flips to `false` on its own — no separate flag to update.
 */
export function isInconclusive(trial: Trial): boolean {
  return trial.status === 'completed' && analyzedCaptureCount(trial) < 2;
}

/** Which role a capture played: the trial's first photo, its final analysed
 *  photo (fresh or retroactive), or an in-between daily log with no score. */
export function captureRole(trial: Trial, captureId: string): 'initial' | 'final' | 'log' {
  const sorted = [...trial.captures].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  if (sorted[0]?.id === captureId) return 'initial';
  const capture = trial.captures.find((c) => c.id === captureId);
  return capture?.concerns ? 'final' : 'log';
}
