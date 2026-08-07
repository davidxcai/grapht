'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2, Lock, Moon, Sun, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Choice } from '@/components/choice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { saveTrialSettings } from '@/app/trials/actions';
import type { Frequency, TimeOfDay, Trial, TrialStatus, TrialVisibility } from '@/lib/trials';

/**
 * Editing a trial after it has started.
 *
 * The tracked products are not here and never will be: `targets[]` freeze at
 * creation, so an edit cannot reach back and change what the photos already
 * taken were attributed to (CLAUDE.md rule 9). Nor is the start date, which is
 * the day the window actually opened.
 *
 * What is left is the trial's own settings, and on an **ended** trial only the
 * name and who can see it — the window and the schedule describe logging that
 * has already finished.
 */

interface Settings {
  name: string;
  endDate: string | null;
  endDateSource: Trial['window']['endDateSource'];
  timeOfDay: TimeOfDay;
  visibility: TrialVisibility;
  frequency: Frequency;
  commentsEnabled: boolean;
}

interface Props {
  trialId: string;
  status: TrialStatus;
  startDate: string;
  settings: Settings;
}

const DURATIONS = [14, 30, 60];

type DurationMode = 'open' | 'preset' | 'custom';
type DurationUnit = 'days' | 'weeks' | 'months' | 'years';

const DURATION_UNITS: { id: DurationUnit; label: string; days: number }[] = [
  { id: 'days', label: 'days', days: 1 },
  { id: 'weeks', label: 'weeks', days: 7 },
  { id: 'months', label: 'months', days: 30 },
  { id: 'years', label: 'years', days: 365 },
];

type FrequencyPreset = 'daily' | 'other-day' | 'custom' | 'none';

const FREQUENCIES: { id: FrequencyPreset; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'other-day', label: 'Every Other Day' },
  { id: 'custom', label: 'Custom' },
  { id: 'none', label: 'Whenever' },
];

const TIMES_OF_DAY: { id: TimeOfDay; label: string; icon: typeof Sun }[] = [
  { id: 'am', label: 'AM', icon: Sun },
  { id: 'pm', label: 'PM', icon: Moon },
];

const VISIBILITIES: { id: TrialVisibility; label: string; icon: typeof Sun }[] = [
  { id: 'private', label: 'Private', icon: Lock },
  { id: 'public', label: 'Public', icon: Users },
];

const MS_PER_DAY = 86_400_000;

function localDay(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Inclusive of both ends, so it matches the `n/total` the day counter shows. */
function lengthInDays(startDate: string, endDate: string): number {
  const span = Date.parse(`${endDate}T00:00:00`) - Date.parse(`${startDate}T00:00:00`);
  return Math.round(span / MS_PER_DAY) + 1;
}

function longDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * `weekdays` lands on Daily, because no screen can produce it and there is no
 * control here that would round-trip it. Everything else maps exactly.
 */
function frequencyPreset(frequency: Frequency): FrequencyPreset {
  switch (frequency.kind) {
    case 'every-n-days':
      return frequency.n === 2 ? 'other-day' : 'custom';
    case 'none':
      return 'none';
    default:
      return 'daily';
  }
}

export function TrialSettingsEditor({ trialId, status, startDate, settings }: Props) {
  const router = useRouter();
  const isActive = status === 'active';

  const initialLength = settings.endDate ? lengthInDays(startDate, settings.endDate) : null;

  const [name, setName] = useState(settings.name);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(settings.timeOfDay);
  const [visibility, setVisibility] = useState<TrialVisibility>(settings.visibility);
  const [commentsEnabled, setCommentsEnabled] = useState(settings.commentsEnabled);

  const [durationMode, setDurationMode] = useState<DurationMode>(
    initialLength === null ? 'open' : DURATIONS.includes(initialLength) ? 'preset' : 'custom',
  );
  const [presetDays, setPresetDays] = useState(
    initialLength !== null && DURATIONS.includes(initialLength) ? initialLength : 30,
  );
  const [customDays, setCustomDays] = useState(String(initialLength ?? 45));
  const [customUnit, setCustomUnit] = useState<DurationUnit>('days');

  // Kept as it was until a duration control is touched — the detail page notes
  // an end date that came from a clinician or a label, and a date the user has
  // since moved is neither.
  const [endDateSource, setEndDateSource] = useState(settings.endDateSource);

  const [frequency, setFrequency] = useState<FrequencyPreset>(frequencyPreset(settings.frequency));
  const [everyN, setEveryN] = useState(
    String(settings.frequency.kind === 'every-n-days' ? settings.frequency.n : 3),
  );

  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function pickDuration(next: DurationMode, days?: number) {
    setDurationMode(next);
    if (days !== undefined) setPresetDays(days);
    setEndDateSource(next === 'open' ? null : 'user-chosen');
  }

  function durationDays(): number | null {
    switch (durationMode) {
      case 'open':
        return null;
      case 'custom': {
        const unitDays = DURATION_UNITS.find((u) => u.id === customUnit)?.days ?? 1;
        return Math.max(1, Number(customDays) || 30) * unitDays;
      }
      default:
        return presetDays;
    }
  }

  /** Counted from the day the trial started, not from today — the window it has
   *  always had is what is being lengthened or shortened. */
  function endDate(): string | null {
    const days = durationDays();
    if (days === null) return null;
    const end = new Date(`${startDate}T00:00:00`);
    end.setDate(end.getDate() + days - 1);
    return localDay(end);
  }

  function frequencyValue(): Frequency {
    switch (frequency) {
      case 'other-day':
        return { kind: 'every-n-days', n: 2 };
      case 'custom':
        return { kind: 'every-n-days', n: Math.max(2, Number(everyN) || 3) };
      case 'none':
        return { kind: 'none' };
      default:
        return { kind: 'daily' };
    }
  }

  function save() {
    setError(null);
    startSaving(async () => {
      const result = await saveTrialSettings(trialId, {
        name,
        endDate: endDate(),
        endDateSource,
        timeOfDay,
        visibility,
        frequency: frequencyValue(),
        commentsEnabled,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/trials/${trialId}`);
      router.refresh();
    });
  }

  const ends = endDate();

  return (
    <div className="mt-8 space-y-8">
      {/* ---- name ---- */}
      <section className="space-y-3">
        <Label htmlFor="trial-name">Name</Label>
        <Input
          id="trial-name"
          value={name}
          placeholder="Trial name"
          onChange={(e) => setName(e.target.value)}
        />
      </section>

      {isActive && (
        <>
          <Separator />

          {/* ---- time of day ---- */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Time of day</h2>
            <div className="flex gap-1.5">
              {TIMES_OF_DAY.map((t) => (
                <Choice
                  key={t.id}
                  on={timeOfDay === t.id}
                  onClick={() => setTimeOfDay(t.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 py-2"
                >
                  <t.icon className="size-3.5" />
                  {t.label}
                </Choice>
              ))}
            </div>
          </section>

          <Separator />

          {/* ---- duration ---- */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">How long are we tracking?</h2>

            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((d) => (
                <Choice
                  key={d}
                  on={durationMode === 'preset' && presetDays === d}
                  onClick={() => pickDuration('preset', d)}
                  className="flex-1 justify-center text-center"
                >
                  {d} days
                </Choice>
              ))}

              <Choice
                on={durationMode === 'custom'}
                onClick={() => pickDuration('custom')}
                className="flex-1 justify-center text-center"
              >
                Custom
              </Choice>

              <Choice
                on={durationMode === 'open'}
                onClick={() => pickDuration('open')}
                className="flex-1 justify-center text-center"
              >
                Open-ended
              </Choice>
            </div>

            {durationMode === 'custom' && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={customDays}
                  aria-label="Duration"
                  className="flex-1"
                  onChange={(e) => setCustomDays(e.target.value)}
                />
                <Select
                  value={customUnit}
                  onValueChange={(next: unknown) => setCustomUnit(next as DurationUnit)}
                >
                  <SelectTrigger aria-label="Duration unit" className="h-9 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    {DURATION_UNITS.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {ends ? `Ends ${longDate(ends)}.` : 'Runs until you end it.'}
            </p>
          </section>

          <Separator />

          {/* ---- frequency ---- */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">How often are you applying?</h2>

            <div className="flex flex-wrap gap-1.5">
              {FREQUENCIES.map((f) => (
                <Choice
                  key={f.id}
                  on={frequency === f.id}
                  onClick={() => setFrequency(f.id)}
                  className="flex-1 justify-center text-center"
                >
                  {f.label}
                </Choice>
              ))}
            </div>

            {frequency === 'custom' && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                Every
                <Input
                  type="number"
                  min={2}
                  inputMode="numeric"
                  value={everyN}
                  aria-label="Days between logs"
                  className="max-w-20"
                  onChange={(e) => setEveryN(e.target.value)}
                />
                days
              </div>
            )}
          </section>
        </>
      )}

      <Separator />

      {/* ---- visibility ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Who can see this?</h2>

        <div className="flex gap-1.5">
          {VISIBILITIES.map((v) => (
            <Choice
              key={v.id}
              on={visibility === v.id}
              onClick={() => setVisibility(v.id)}
              className="flex flex-1 items-center justify-center gap-1.5 py-2"
            >
              <v.icon className="size-3.5" />
              {v.label}
            </Choice>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {visibility === 'public'
            ? 'The community can read this trial. You can make it private again at any time.'
            : 'Only you can see this trial. You can share it with the community at any time.'}
        </p>

        {visibility === 'public' && (
          <div className="flex items-center justify-between pt-1">
            <Label htmlFor="comments-enabled" className="text-sm">
              Allow comments
            </Label>
            <Switch
              id="comments-enabled"
              checked={commentsEnabled}
              onCheckedChange={(on: boolean) => setCommentsEnabled(on)}
            />
          </div>
        )}
      </section>

      <Separator />

      {/* ---- commit ---- */}
      <section className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={saving}
            onClick={() => router.push(`/trials/${trialId}`)}
          >
            Cancel
          </Button>
          <Button className="flex-1" onClick={save} disabled={saving}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </section>
    </div>
  );
}
