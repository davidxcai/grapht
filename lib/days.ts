/**
 * Calendar-day arithmetic, shared by everything that speaks in `YYYY-MM-DD`.
 *
 * A trial is logged in local calendar days, never instants: "did I log today?"
 * has to answer in the user's own timezone, and the server clock runs UTC on
 * Vercel. Keeping one implementation of the offset shift is the point — the
 * copies of it that used to sit in each store, page and editor were free to
 * drift a day apart from each other.
 *
 * Pure and client-safe, so a client component can import it without dragging
 * the database in.
 */

export const MS_PER_DAY = 86_400_000;

/** Local calendar day as `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** A `YYYY-MM-DD` back to a Date at local midnight. */
export function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

/** Whole days from one day to another, exclusive of the start. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / MS_PER_DAY);
}

/** Counting both ends, so it matches the `n/total` a day counter shows. */
export function daysInclusive(from: string, to: string): number {
  return daysBetween(from, to) + 1;
}

/**
 * A day column read back from Neon. The driver hands `date` columns over as a
 * `Date` at UTC midnight, which `toISOString()` alone would shift backwards
 * for anyone west of UTC; anything else already arrives as a string.
 */
export function asDay(value: unknown): string {
  return value instanceof Date ? localDay(value) : String(value).slice(0, 10);
}
