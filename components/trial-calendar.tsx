'use client';

import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { localDay, parseDay } from '@/lib/days';
import { cn } from '@/lib/utils';

/**
 * The logging record, as a month grid with a dot under every day that has a
 * capture.
 *
 * **A missed day is not a failure state and must never be drawn as one.** No red
 * squares, no broken-streak marker. A gap is simply a day without a dot — legible
 * without being a reprimand, and consistent with the project-wide rule that the
 * app is not a supervisor (`docs/app-ui.md` §3).
 *
 * The full date range sits above the grid, and every month in the window is
 * reachable from one select. A six-month trial is eight clicks away from its own
 * first month if arrows are the only control.
 */

interface Props {
  startDate: string;
  /** Days with at least one capture, as `YYYY-MM-DD`. */
  loggedDays: string[];
  /** Null when open-ended. */
  endDate: string | null;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function monthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`;
}

function longDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function TrialCalendar({ startDate, loggedDays, endDate }: Props) {
  const logged = new Set(loggedDays);
  // A capture can predate `startDate` (a baseline logged before a server
  // clock in a different timezone stamped the trial's start) — the grid must
  // still reach back far enough to show it rather than clipping the month.
  const firstLogged = loggedDays.length ? loggedDays[0] : startDate;
  const start = parseDay(firstLogged < startDate ? firstLogged : startDate);
  const lastLogged = loggedDays.length ? parseDay(loggedDays[loggedDays.length - 1]) : start;
  const end = endDate && endDate > localDay(lastLogged) ? parseDay(endDate) : lastLogged;

  // Open on the month holding the most recent activity, not the first month —
  // on a six-month trial that is the one worth seeing.
  const [cursor, setCursor] = useState(
    () => new Date(lastLogged.getFullYear(), lastLogged.getMonth(), 1),
  );

  const months: Date[] = [];
  for (
    let m = new Date(start.getFullYear(), start.getMonth(), 1);
    m <= new Date(end.getFullYear(), end.getMonth(), 1);
    m = new Date(m.getFullYear(), m.getMonth() + 1, 1)
  ) {
    months.push(m);
  }

  const position = months.findIndex((m) => monthValue(m) === monthValue(cursor));
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const leadingBlanks = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();

  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1),
    ),
  ];

  const today = localDay(new Date());
  const endIso = localDay(end);

  return (
    <div>
      <p className="pb-2 text-lg text-muted-foreground">
        {endDate ? `${longDate(start)} – ${longDate(parseDay(endDate))}` : `Since ${longDate(start)}`}
      </p>

      <div className="rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCursor(months[position - 1])}
            disabled={position <= 0}
            aria-label="Previous month"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>

          <div className="relative flex items-center gap-1">
            <span className="text-sm font-medium">
              {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
            <select
              value={monthValue(cursor)}
              onChange={(event) => {
                const next = months.find((m) => monthValue(m) === event.target.value);
                if (next) setCursor(next);
              }}
              aria-label="Jump to month"
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              {months.map((month) => (
                <option key={monthValue(month)} value={monthValue(month)}>
                  {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setCursor(months[position + 1])}
            disabled={position < 0 || position >= months.length - 1}
            aria-label="Next month"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-y-1">
          {WEEKDAYS.map((day) => (
            <div key={day} className="pb-1 text-center text-[11px] text-muted-foreground">
              {day}
            </div>
          ))}

          {cells.map((date, i) => {
            if (!date) return <div key={`blank-${i}`} />;
            const key = localDay(date);
            const inTrial = key >= startDate && key <= endIso;
            const hasCapture = logged.has(key);
            const isFinalDay = endDate !== null && key === endDate;

            return (
              <div key={key} className="flex flex-col items-center gap-1 py-1">
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full text-[13px] tabular-nums',
                    key === today && 'bg-foreground font-medium text-background',
                    key !== today && inTrial && 'text-foreground',
                    key !== today && !inTrial && 'text-muted-foreground/35',
                  )}
                >
                  {date.getDate()}
                </span>
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    isFinalDay && 'bg-[var(--complete)]',
                    !isFinalDay && hasCapture && 'bg-[var(--progress)]',
                    !isFinalDay && !hasCapture && 'bg-transparent',
                  )}
                  aria-hidden
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
