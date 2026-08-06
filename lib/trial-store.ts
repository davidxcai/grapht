import 'server-only';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getSql } from '@/lib/db';
import { validateConcerns } from '@/lib/concerns';
import type { BaselineEntry, Capture, Frequency, Intervention, Trial } from '@/lib/trials';
import type { Provenance, RankedConcern } from '@/lib/routines';

/**
 * Trials the user created, in Neon. The reference series stays in
 * `fixtures/trials.json` and is read by `getFixtureTrials()`; `loadTrials()`
 * unions the two so a missing DATABASE_URL costs saved trials and leaves the
 * demo path whole.
 */

const LOCAL_USER = 'local';

/**
 * The committed reference series. Read straight off disk — no key, no network,
 * no database, which is what keeps the demo path runnable anywhere (BRIEF.md).
 *
 * This lives here rather than in `lib/trials.ts` because that module is imported
 * by client components; a Node built-in in it breaks the client bundle.
 *
 * `frequency` and a nullable `endDate` are filled in for older fixtures rather
 * than by regenerating. `seed-trials.mjs` owns that file and it is never
 * hand-edited.
 */
export function getFixtureTrials(): Trial[] {
  const path = resolve(process.cwd(), 'fixtures/trials.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Trial[];
  return raw.map((t) => ({
    ...t,
    frequency: t.frequency ?? { kind: 'daily' },
    window: { ...t.window, endDate: t.window.endDate ?? null },
  }));
}

/**
 * Whether an id belongs to the committed reference series rather than to
 * something the user created.
 *
 * Worth a free lookup because the alternative is finding out from a write that
 * matched no rows — and a capture only discovers that *after* it has spent
 * YouCam units analysing the photo.
 */
export function isFixtureTrial(id: string): boolean {
  return getFixtureTrials().some((t) => t.id === id);
}

/** Fixture ids are slugs (`accutane-2024`); a stored one is always a uuid. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `targets` cast to `text[]`, for the same load-bearing reason as
 * `ITEM_COLUMNS` in lib/routines.ts: the Neon driver only parses arrays of
 * built-in types, so an `analysis_concern[]` arrives as the raw literal
 * `"{acne,texture}"` — a string. Nothing throws; the targets just silently
 * render empty.
 */
const INTERVENTION_COLUMNS = `v.id, v.trial_id, v.position, v.direction, v.brand, v.name,
   v.started_on, v.targets::text[] as targets, v.ranked, v.provenance,
   v.classifier, v.product_key`;

function asDay(value: unknown): string {
  if (value instanceof Date) {
    const offset = value.getTimezoneOffset() * 60_000;
    return new Date(value.getTime() - offset).toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function toIntervention(row: Record<string, unknown>): Intervention {
  return {
    direction: row.direction as 'add' | 'remove',
    brand: (row.brand as string | null) ?? null,
    name: row.name as string,
    startedOn: asDay(row.started_on),
    targets: (row.targets as string[]) ?? [],
  };
}

function toCapture(row: Record<string, unknown>): Capture {
  return {
    id: row.id as string,
    capturedAt: new Date(row.captured_at as string).toISOString(),
    device: (row.device as string | null) ?? '',
    concerns: (row.concerns as Capture['concerns']) ?? null,
    blobUrl: (row.blob_url as string | null) ?? null,
  };
}

export async function listStoredTrials(): Promise<Trial[]> {
  const sql = getSql();
  const [trialRows, interventionRows, captureRows] = await Promise.all([
    sql`select * from trials where user_id = ${LOCAL_USER} order by created_at desc`,
    sql.query(
      `select ${INTERVENTION_COLUMNS} from trial_interventions v
       join trials t on t.id = v.trial_id
       where t.user_id = $1
       order by v.position asc`,
      [LOCAL_USER],
    ),
    sql.query(
      `select c.* from trial_captures c
       join trials t on t.id = c.trial_id
       where t.user_id = $1
       order by c.captured_at asc`,
      [LOCAL_USER],
    ),
  ]);

  const interventions = new Map<string, Intervention[]>();
  for (const row of interventionRows as Record<string, unknown>[]) {
    const key = row.trial_id as string;
    interventions.set(key, [...(interventions.get(key) ?? []), toIntervention(row)]);
  }

  const captures = new Map<string, Capture[]>();
  for (const row of captureRows as Record<string, unknown>[]) {
    const key = row.trial_id as string;
    captures.set(key, [...(captures.get(key) ?? []), toCapture(row)]);
  }

  return (trialRows as Record<string, unknown>[]).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    status: t.status as Trial['status'],
    window: {
      startDate: asDay(t.start_date),
      endDate: t.end_date ? asDay(t.end_date) : null,
      endDateSource: (t.end_date_source as Trial['window']['endDateSource']) ?? null,
    },
    frequency: t.frequency as Frequency,
    routine: {
      baseline: (t.baseline as BaselineEntry[]) ?? [],
      interventions: interventions.get(t.id as string) ?? [],
    },
    captures: captures.get(t.id as string) ?? [],
  }));
}

/**
 * Every trial the app knows about: saved ones first, then the reference series.
 *
 * The database failure is caught rather than thrown, exactly as `listRoutines()`
 * is on the dashboard. A missing or unreachable `DATABASE_URL` must never cost
 * the fixture — running end-to-end with no key and no network is a hackathon
 * requirement (BRIEF.md), not a nicety.
 */
export async function loadTrials(): Promise<{ trials: Trial[]; storeError: string | null }> {
  const fixture = getFixtureTrials();
  try {
    return { trials: [...(await listStoredTrials()), ...fixture], storeError: null };
  } catch (error) {
    return { trials: fixture, storeError: (error as Error).message };
  }
}

/* ---------- writes ---------- */

export interface InterventionInput {
  brand?: string | null;
  name: string;
  targets: string[];
  ranked?: RankedConcern[];
  provenance?: Provenance;
  classifier?: { model: string; promptVersion: string } | null;
  productKey?: string | null;
}

/** The measurement half of the first capture, already analysed. */
export interface CaptureInput {
  device: string | null;
  resolution: string;
  blobUrl: string | null;
  blobPathname: string | null;
  concerns: Record<string, unknown>;
  zones: Record<string, unknown>;
  skinAge: number | null;
}

export interface CreateTrialInput {
  name: string;
  startDate: string;
  endDate: string | null;
  endDateSource: Trial['window']['endDateSource'];
  frequency: Frequency;
  baseline: BaselineEntry[];
  interventions: InterventionInput[];
  capture: CaptureInput;
}

/**
 * Mark a trial finished, with today as its end date.
 *
 * Returns false when no row was updated — which means the id belongs to the
 * committed fixture rather than to something the user created. The fixture is
 * read-only by construction, and the caller says so rather than reporting a
 * success that changed nothing.
 *
 * The `status = 'active'` guard is what makes ending irreversible: a second call
 * matches no rows, so an already-ended trial can never be re-ended or have its
 * end date moved (`docs/trial-model.md`).
 */
export async function closeTrial(id: string): Promise<boolean> {
  const sql = getSql();
  const rows = (await sql`
    update trials
       set status = 'completed', end_date = current_date
     where id = ${id} and user_id = ${LOCAL_USER} and status = 'active'
     returning id`) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * Just enough of a stored trial to decide whether a capture may be taken, read
 * before the photo is analysed.
 *
 * Null covers both "no such trial" and "that id is the fixture." Neither can
 * accept a capture, and the caller must learn it while a rejection still costs
 * nothing.
 */
export async function getTrialHeader(
  id: string,
): Promise<{ name: string; status: Trial['status'] } | null> {
  if (!UUID.test(id)) return null;
  const sql = getSql();
  const rows = (await sql`
    select name, status from trials
     where id = ${id} and user_id = ${LOCAL_USER}`) as Record<string, unknown>[];
  const row = rows[0];
  return row ? { name: row.name as string, status: row.status as Trial['status'] } : null;
}

/**
 * Add a capture to a running trial — the daily log.
 *
 * `captured_at` is left to the column default, so the instant is the server's
 * and never the client's. No backdating, ever: a compliance record that can be
 * edited after the fact is worth nothing, and minimum detectable effect is
 * computed from the real timestamps, so a moved photo silently moves the error
 * bars too (`docs/app-ui.md` §5).
 *
 * The `status = 'active'` test rides inside the insert rather than sitting in a
 * separate read. Ending a trial is irreversible precisely because its summary
 * describes a closed window; a capture landing after the close would let a
 * published retrospective drift out of step with its own data. Returns null
 * when nothing was written, which means the trial ended in between.
 *
 * **Same-day captures are not blocked.** Nothing in the model forbids them and
 * consecutive captures are how the per-user instrument noise floor gets refined
 * (`docs/app-ui.md` §4). The UI simply stops asking once today is logged.
 */
export async function addCapture(
  trialId: string,
  capture: CaptureInput,
): Promise<string | null> {
  if (!UUID.test(trialId)) return null;
  const sql = getSql();
  const rows = (await sql.query(
    `insert into trial_captures
       (trial_id, device, resolution, blob_url, blob_pathname, concerns, zones, skin_age)
     select $1::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::numeric
      where exists (
        select 1 from trials
         where id = $1::uuid and user_id = $9 and status = 'active'
      )
     returning id`,
    [
      trialId,
      capture.device,
      capture.resolution,
      capture.blobUrl,
      capture.blobPathname,
      JSON.stringify(capture.concerns),
      JSON.stringify(capture.zones),
      capture.skinAge,
      LOCAL_USER,
    ],
  )) as Record<string, unknown>[];
  return rows[0] ? (rows[0].id as string) : null;
}

export async function createTrial(input: CreateTrialInput): Promise<string> {
  const sql = getSql();
  const id = randomUUID();

  // One transaction: a trial whose baseline capture failed to land would show a
  // day counter with nothing measured under it, and the user would have paid
  // YouCam units for a row that isn't there.
  await sql.transaction([
    sql`insert into trials
          (id, user_id, name, start_date, end_date, end_date_source, frequency, baseline)
        values (
          ${id}, ${LOCAL_USER}, ${input.name.trim()},
          ${input.startDate}::date,
          ${input.endDate}::date,
          ${input.endDateSource}::end_date_source,
          ${JSON.stringify(input.frequency)}::jsonb,
          ${JSON.stringify(input.baseline)}::jsonb
        )`,

    ...input.interventions.map((item, position) => {
      const targets = validateConcerns(item.targets);
      return sql`
        insert into trial_interventions
          (id, trial_id, position, direction, brand, name, started_on,
           targets, ranked, provenance, classifier, product_key)
        values (
          ${randomUUID()}, ${id}, ${position}, 'add',
          ${item.brand?.trim() || null}, ${item.name.trim()},
          ${input.startDate}::date,
          ${targets}::analysis_concern[],
          ${JSON.stringify(item.ranked ?? [])}::jsonb,
          ${item.provenance ?? 'user-edited'}::target_provenance,
          ${item.classifier ? JSON.stringify(item.classifier) : null}::jsonb,
          ${item.productKey ?? null}
        )`;
    }),

    // `captured_at` is left to the column default — server-side now(), never a
    // client-supplied instant. No backdating, ever (docs/app-ui.md §5).
    sql`insert into trial_captures
          (id, trial_id, device, resolution, blob_url, blob_pathname, concerns, zones, skin_age)
        values (
          ${randomUUID()}, ${id}, ${input.capture.device}, ${input.capture.resolution},
          ${input.capture.blobUrl}, ${input.capture.blobPathname},
          ${JSON.stringify(input.capture.concerns)}::jsonb,
          ${JSON.stringify(input.capture.zones)}::jsonb,
          ${input.capture.skinAge}
        )`,
  ]);

  return id;
}
