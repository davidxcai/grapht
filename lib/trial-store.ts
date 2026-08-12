import 'server-only';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getSql } from '@/lib/db';
import { degraded } from '@/lib/log';
import { DEMO_USER } from '@/lib/auth';
import { validateConcerns } from '@/lib/concerns';
import type { BaselineEntry, Capture, Frequency, Intervention, Trial } from '@/lib/trials';
import type { Provenance, RankedConcern } from '@/lib/routines';

/**
 * Trials the user created, in Neon. The reference series stays in
 * `fixtures/trials.json` and is read by `getFixtureTrials()`; `loadTrials()`
 * unions the two so a missing DATABASE_URL costs saved trials and leaves the
 * demo path whole.
 *
 * Everything that touches Neon takes the owner as its first argument, for the
 * reason spelled out in lib/routines.ts: this is where ownership is enforced,
 * and an unscoped query should be a type error rather than a leak. The fixture
 * belongs to nobody and is readable signed out — it is a published sample, and
 * the demo has to run with no keys at all (BRIEF.md).
 */

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
    timeOfDay: t.timeOfDay ?? 'am',
    // The reference series is a published sample and already reads signed out.
    visibility: t.visibility ?? 'public',
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
export const INTERVENTION_COLUMNS = `v.id, v.trial_id, v.position, v.direction, v.brand, v.name,
   v.started_on, v.targets::text[] as targets, v.ranked, v.provenance,
   v.classifier, v.product_key, v.dosage, v.catalog_product_id, cp.image_url as image`;

/** Every read of `trial_interventions` joins this in for `INTERVENTION_COLUMNS`'
 *  `cp.image_url` — left, not inner, since most interventions (typed name,
 *  barcode, ingredient photo) have no catalog row at all. Mirrors
 *  `CATALOG_JOIN` in lib/routines.ts. */
export const CATALOG_JOIN = `left join catalog_products cp on cp.id = v.catalog_product_id`;

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
    dosage: (row.dosage as string | null) ?? null,
    catalogProductId: (row.catalog_product_id as string | null) ?? null,
    image: (row.image as string | null) ?? null,
  };
}

function toCapture(row: Record<string, unknown>): Capture {
  return {
    id: row.id as string,
    capturedAt: new Date(row.captured_at as string).toISOString(),
    device: (row.device as string | null) ?? '',
    concerns: (row.concerns as Capture['concerns']) ?? null,
    blobUrl: (row.blob_url as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    extraPhotos: [],
  };
}

function toTrial(
  t: Record<string, unknown>,
  interventions: Intervention[],
  captures: Capture[],
  applications: string[],
): Trial {
  return {
    id: t.id as string,
    name: t.name as string,
    status: t.status as Trial['status'],
    visibility: (t.visibility as Trial['visibility']) ?? 'private',
    window: {
      startDate: asDay(t.start_date),
      endDate: t.end_date ? asDay(t.end_date) : null,
      endDateSource: (t.end_date_source as Trial['window']['endDateSource']) ?? null,
    },
    timeOfDay: (t.time_of_day as Trial['timeOfDay']) ?? 'am',
    frequency: t.frequency as Frequency,
    routine: {
      baseline: (t.baseline as BaselineEntry[]) ?? [],
      interventions,
    },
    captures,
    applications,
    commentsEnabled: (t.comments_enabled as boolean) ?? true,
    viewCount: (t.view_count as number) ?? 0,
    summary: t.summary
      ? {
          text: t.summary as string,
          model: (t.summary_model as string | null) ?? '',
          generatedAt: t.summary_generated_at
            ? new Date(t.summary_generated_at as string).toISOString()
            : '',
        }
      : null,
    userReview: (t.user_review as string | null) ?? null,
  };
}

/**
 * Assemble whole trials from rows already scoped to their owner (or to the
 * public set). Shared by the owner list and the community reads so a trial is
 * the same object however it was reached.
 */
export function assembleTrials(
  trialRows: Record<string, unknown>[],
  interventionRows: Record<string, unknown>[],
  captureRows: Record<string, unknown>[],
  applicationRows: Record<string, unknown>[],
  extraPhotoRows: Record<string, unknown>[],
): Trial[] {
  const interventions = new Map<string, Intervention[]>();
  for (const row of interventionRows) {
    const key = row.trial_id as string;
    interventions.set(key, [...(interventions.get(key) ?? []), toIntervention(row)]);
  }

  const captures = new Map<string, Capture[]>();
  const byCapture = new Map<string, Capture>();
  for (const row of captureRows) {
    const key = row.trial_id as string;
    const capture = toCapture(row);
    captures.set(key, [...(captures.get(key) ?? []), capture]);
    byCapture.set(capture.id, capture);
  }

  for (const row of extraPhotoRows) {
    const capture = byCapture.get(row.capture_id as string);
    capture?.extraPhotos?.push({ id: row.id as string, url: row.blob_url as string });
  }

  const applications = new Map<string, string[]>();
  for (const row of applicationRows) {
    const key = row.trial_id as string;
    applications.set(key, [
      ...(applications.get(key) ?? []),
      new Date(row.applied_at as string).toISOString(),
    ]);
  }

  return trialRows.map((t) =>
    toTrial(
      t,
      interventions.get(t.id as string) ?? [],
      captures.get(t.id as string) ?? [],
      applications.get(t.id as string) ?? [],
    ),
  );
}

/** The five row sets behind `assembleTrials()`, scoped by an arbitrary trial filter. */
async function fetchTrialRows(
  where: string,
  params: unknown[],
): Promise<
  [
    Record<string, unknown>[],
    Record<string, unknown>[],
    Record<string, unknown>[],
    Record<string, unknown>[],
    Record<string, unknown>[],
  ]
> {
  const sql = getSql();
  return Promise.all([
    sql.query(`select t.* from trials t where ${where} order by t.created_at desc`, params),
    sql.query(
      `select ${INTERVENTION_COLUMNS} from trial_interventions v
       join trials t on t.id = v.trial_id
       ${CATALOG_JOIN}
       where ${where}
       order by v.position asc`,
      params,
    ),
    sql.query(
      `select c.* from trial_captures c
       join trials t on t.id = c.trial_id
       where ${where}
       order by c.captured_at asc`,
      params,
    ),
    sql.query(
      `select a.* from trial_applications a
       join trials t on t.id = a.trial_id
       where ${where}
       order by a.applied_at asc`,
      params,
    ),
    sql.query(
      `select p.* from trial_capture_photos p
       join trial_captures c on c.id = p.capture_id
       join trials t on t.id = c.trial_id
       where ${where}
       order by p.position asc, p.created_at asc`,
      params,
    ),
  ]) as Promise<
    [
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
    ]
  >;
}

export async function listStoredTrials(userId: string): Promise<Trial[]> {
  const rows = await fetchTrialRows('t.user_id = $1', [userId]);
  return assembleTrials(...rows);
}

/**
 * Every trial this reader may call theirs.
 *
 * A null `userId` is the signed-out visitor, and they get the fixture alone —
 * no database round trip, because there is no owner to scope it to. That is the
 * whole demo path: the reference series is a published sample and reads without
 * an account. The keyless build's implicit `DEMO_USER` keeps the fixture too,
 * because that build has to behave as it did before accounts existed.
 *
 * A real account gets only what it created. The fixture belongs to nobody, and
 * listing it here made a fresh account's dashboard open on trials it never ran
 * — pre-seeded data, not a sample. It stays reachable by id (`/trials/[id]`)
 * and on the community surfaces, where it is presented as the sample it is.
 *
 * The database failure is caught rather than thrown, exactly as `listRoutines()`
 * is on the dashboard. A missing or unreachable `DATABASE_URL` must never cost
 * the fixture — running end-to-end with no key and no network is a hackathon
 * requirement (BRIEF.md), not a nicety.
 */
export async function loadTrials(
  userId: string | null,
): Promise<{ trials: Trial[]; storeError: string | null }> {
  const fixture = getFixtureTrials();
  if (!userId) return { trials: fixture, storeError: null };

  const sample = userId === DEMO_USER ? fixture : [];
  try {
    return { trials: [...(await listStoredTrials(userId)), ...sample], storeError: null };
  } catch (error) {
    degraded('loadTrials', error, 'stored trials omitted; storeError returned');
    return { trials: sample, storeError: (error as Error).message };
  }
}

/* ---------- writes ---------- */

export interface InterventionInput {
  brand?: string | null;
  name: string;
  targets: string[];
  dosage?: string | null;
  ranked?: RankedConcern[];
  provenance?: Provenance;
  classifier?: { model: string; promptVersion: string } | null;
  productKey?: string | null;
  catalogProductId?: string | null;
}

/**
 * The measurement half of a capture. `concerns`/`zones` are null for a daily
 * log that was never analysed — only the initial and final capture of a trial
 * carry real scores since the pivot away from analysing every photo.
 */
export interface CaptureInput {
  device: string | null;
  resolution: string;
  blobUrl: string | null;
  blobPathname: string | null;
  concerns: Record<string, unknown> | null;
  zones: Record<string, unknown> | null;
  skinAge: number | null;
}

export interface CreateTrialInput {
  name: string;
  startDate: string;
  endDate: string | null;
  endDateSource: Trial['window']['endDateSource'];
  timeOfDay: Trial['timeOfDay'];
  visibility: Trial['visibility'];
  frequency: Frequency;
  baseline: BaselineEntry[];
  interventions: InterventionInput[];
  capture: CaptureInput;
}

/**
 * Mark a trial finished, with today as its end date.
 *
 * Returns false when no row was updated: the id belongs to the committed
 * fixture, or to someone else, or the trial is already finished. The caller says
 * so rather than reporting a success that changed nothing. The fixture is
 * read-only by construction.
 *
 * The `status = 'active'` guard is what makes ending irreversible: a second call
 * matches no rows, so an already-ended trial can never be re-ended or have its
 * end date moved (`docs/trial-model.md`).
 */
export async function closeTrial(userId: string, id: string): Promise<boolean> {
  const sql = getSql();
  const rows = (await sql`
    update trials
       set status = 'completed', end_date = current_date
     where id = ${id} and user_id = ${userId} and status = 'active'
     returning id`) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * Just enough of a stored trial to decide whether a capture may be taken, read
 * before the photo is analysed — and to check an edited end date against the
 * day the trial actually started.
 *
 * Null covers "no such trial", "that id is the fixture", and "that trial is
 * someone else's". None can accept a capture, and the caller must learn it while
 * a rejection still costs nothing.
 */
export async function getTrialHeader(
  userId: string,
  id: string,
): Promise<{ name: string; status: Trial['status']; startDate: string } | null> {
  if (!UUID.test(id)) return null;
  const sql = getSql();
  const rows = (await sql`
    select name, status, start_date from trials
     where id = ${id} and user_id = ${userId}`) as Record<string, unknown>[];
  const row = rows[0];
  return row
    ? {
        name: row.name as string,
        status: row.status as Trial['status'],
        startDate: asDay(row.start_date),
      }
    : null;
}

/**
 * The settings an edit is allowed to move.
 *
 * Products, their `targets[]`, the start date and the captures are absent on
 * purpose. Targets freeze at trial creation: rewriting them later would rewrite
 * attribution for photos already taken, with no new measurement behind it
 * (CLAUDE.md rule 9, `docs/trial-model.md`).
 */
export interface TrialSettingsInput {
  name: string;
  endDate: string | null;
  endDateSource: Trial['window']['endDateSource'];
  timeOfDay: Trial['timeOfDay'];
  visibility: Trial['visibility'];
  frequency: Frequency;
  commentsEnabled: boolean;
}

/**
 * Change a trial's settings.
 *
 * On a **completed** trial only the name and visibility move. The window,
 * frequency and time of day describe logging that has already happened, and the
 * end date in particular is what `closeTrial()` wrote when it closed — ending is
 * irreversible precisely so a published summary can't drift out of step with its
 * own data (`docs/app-ui.md` §5). Visibility stays editable either way, because
 * publishing and unpublishing are the user's to do at any time, running or
 * finished (`lib/trials.ts`, `TrialVisibility`).
 *
 * The `case when status = 'active'` is what enforces that, and it rides inside
 * the write rather than sitting in a read the caller does first: a trial ended
 * in between would otherwise have its end date moved off the day it closed.
 *
 * Returns false when no row matched — someone else's id, or the fixture, which
 * has no row to update.
 */
export async function updateTrialSettings(
  userId: string,
  id: string,
  input: TrialSettingsInput,
): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const sql = getSql();
  const rows = (await sql`
    update trials
       set name = ${input.name.trim()},
           visibility = ${input.visibility}::trial_visibility,
           comments_enabled = ${input.commentsEnabled},
           end_date = case when status = 'active'
                        then ${input.endDate}::date else end_date end,
           end_date_source = case when status = 'active'
                        then ${input.endDateSource}::end_date_source else end_date_source end,
           time_of_day = case when status = 'active'
                        then ${input.timeOfDay}::trial_time_of_day else time_of_day end,
           frequency = case when status = 'active'
                        then ${JSON.stringify(input.frequency)}::jsonb else frequency end,
           updated_at = now()
     where id = ${id} and user_id = ${userId}
     returning id`) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * Flip who can see a trial — the one setting the header's quick toggle needs,
 * without the rest of `TrialSettingsInput` a caller would otherwise have to
 * round-trip just to change one column. Never touches an ended trial's window
 * or schedule, same as `updateTrialSettings` — there's nothing in this write
 * that could anyway.
 */
export async function updateTrialVisibility(
  userId: string,
  id: string,
  visibility: Trial['visibility'],
): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const sql = getSql();
  const rows = (await sql`
    update trials
       set visibility = ${visibility}::trial_visibility,
           updated_at = now()
     where id = ${id} and user_id = ${userId}
     returning id`) as Record<string, unknown>[];
  return rows.length > 0;
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
  userId: string,
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
      userId,
    ],
  )) as Record<string, unknown>[];
  return rows[0] ? (rows[0].id as string) : null;
}

/**
 * Write analysis results onto a capture that was stored earlier without any —
 * the "use my latest photo" end-trial path. The trial is still `active` at the
 * moment this runs (it's called just before `closeTrial()`), so the guard only
 * needs to check ownership, not status.
 */
export async function updateCaptureAnalysis(
  userId: string,
  trialId: string,
  captureId: string,
  scores: { concerns: Record<string, unknown>; zones: Record<string, unknown>; skinAge: number | null },
): Promise<boolean> {
  if (!UUID.test(trialId) || !UUID.test(captureId)) return false;
  const sql = getSql();
  const rows = (await sql`
    update trial_captures c
       set concerns = ${JSON.stringify(scores.concerns)}::jsonb,
           zones = ${JSON.stringify(scores.zones)}::jsonb,
           skin_age = ${scores.skinAge}::numeric
      from trials t
     where c.id = ${captureId}::uuid and c.trial_id = ${trialId}::uuid
       and t.id = c.trial_id and t.user_id = ${userId}
     returning c.id`) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * The one exception to "ended is immutable": an **inconclusive** trial
 * (ended with only its initial photo ever analysed — `isInconclusive()` in
 * lib/trials.ts) gets one more chance at a real result. The guard is the
 * enforcement — it only inserts when the trial is `completed` *and* fewer
 * than two of its captures carry scores, so a second call (or a call against
 * an already-conclusive trial) matches no rows and closes the door for good.
 */
export async function addFollowUpCapture(
  userId: string,
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
        select 1 from trials t
         where t.id = $1::uuid and t.user_id = $9 and t.status = 'completed'
           and (select count(*) from trial_captures where trial_id = t.id and concerns is not null) < 2
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
      userId,
    ],
  )) as Record<string, unknown>[];
  return rows[0] ? (rows[0].id as string) : null;
}

/**
 * Record an "applied products" check-in, stamped server-side like `captured_at`
 * and for the same reason: the hours-since-applying figure on a photo is only
 * worth showing if neither end of it can be edited after the fact.
 *
 * Active trials only — an ended log has no routine left to check in against.
 */
export async function logApplication(userId: string, trialId: string): Promise<boolean> {
  if (!UUID.test(trialId)) return false;
  const sql = getSql();
  const rows = (await sql`
    insert into trial_applications (trial_id)
    select ${trialId}::uuid
     where exists (
       select 1 from trials
        where id = ${trialId}::uuid and user_id = ${userId} and status = 'active'
     )
    returning id`) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * Set, change, or clear (null) the note on one capture. The one part of a
 * capture that stays editable: it is the user's own words, not a measurement.
 */
export async function setCaptureNote(
  userId: string,
  trialId: string,
  captureId: string,
  note: string | null,
): Promise<boolean> {
  if (!UUID.test(trialId) || !UUID.test(captureId)) return false;
  const sql = getSql();
  const rows = (await sql`
    update trial_captures c
       set note = ${note}
      from trials t
     where c.id = ${captureId}::uuid and c.trial_id = ${trialId}::uuid
       and t.id = c.trial_id and t.user_id = ${userId}
     returning c.id`) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * Attach an already-uploaded extra photo to a capture. The blob is uploaded by
 * the action *after* this ownership test passes, then recorded here — the same
 * "refuse while refusing is free" ordering as the analysis path.
 */
export async function captureOwnedBy(
  userId: string,
  trialId: string,
  captureId: string,
): Promise<boolean> {
  if (!UUID.test(trialId) || !UUID.test(captureId)) return false;
  const sql = getSql();
  const rows = (await sql`
    select 1 from trial_captures c
      join trials t on t.id = c.trial_id
     where c.id = ${captureId}::uuid and c.trial_id = ${trialId}::uuid
       and t.user_id = ${userId}`) as unknown[];
  return rows.length > 0;
}

export async function addCapturePhoto(
  userId: string,
  captureId: string,
  photo: { blobUrl: string; blobPathname: string },
): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`
    insert into trial_capture_photos (capture_id, position, blob_url, blob_pathname)
    select ${captureId}::uuid,
           coalesce((select max(position) + 1 from trial_capture_photos
                      where capture_id = ${captureId}::uuid), 0),
           ${photo.blobUrl}, ${photo.blobPathname}
     where exists (
       select 1 from trial_captures c
         join trials t on t.id = c.trial_id
        where c.id = ${captureId}::uuid and t.user_id = ${userId}
     )
    returning id`) as Record<string, unknown>[];
  return rows[0] ? (rows[0].id as string) : null;
}

/** Delete one extra photo; returns its blob pathname so the caller can drop the
 *  blob too. Null when the row isn't the caller's to delete. */
export async function deleteCapturePhoto(userId: string, photoId: string): Promise<string | null> {
  if (!UUID.test(photoId)) return null;
  const sql = getSql();
  const rows = (await sql`
    delete from trial_capture_photos p
     using trial_captures c, trials t
     where p.id = ${photoId}::uuid and c.id = p.capture_id
       and t.id = c.trial_id and t.user_id = ${userId}
     returning p.blob_pathname`) as Record<string, unknown>[];
  return rows[0] ? (rows[0].blob_pathname as string) : null;
}

/**
 * Permanently delete a trial and everything under it. `on delete cascade`
 * (scripts/migrate-trials.mjs) takes care of interventions, captures, extra
 * photos, applications, comments and saves — one row delete is enough.
 *
 * Postgres can't reach into Blob storage, so the blob pathnames are read out
 * *before* the delete removes the rows that named them, and handed back for
 * the caller to clean up. Ownership is checked twice — once implicitly by
 * scoping the select, once explicitly in the delete's `where` — so a stranger's
 * id costs nothing and deletes nothing.
 *
 * Returns null when no row matched: someone else's id, or the fixture, which
 * has no row here at all.
 */
export async function deleteTrial(userId: string, id: string): Promise<string[] | null> {
  if (!UUID.test(id)) return null;
  const sql = getSql();

  const pathnames = (await sql`
    select blob_pathname from trial_captures
     where trial_id = ${id}::uuid and blob_pathname is not null
       and exists (select 1 from trials where id = ${id}::uuid and user_id = ${userId})
    union all
    select p.blob_pathname from trial_capture_photos p
      join trial_captures c on c.id = p.capture_id
     where c.trial_id = ${id}::uuid
       and exists (select 1 from trials where id = ${id}::uuid and user_id = ${userId})
  `) as Record<string, unknown>[];

  const rows = (await sql`
    delete from trials
     where id = ${id}::uuid and user_id = ${userId}
     returning id`) as Record<string, unknown>[];

  return rows.length > 0 ? pathnames.map((r) => r.blob_pathname as string) : null;
}

/**
 * Store the generated summary. Completed trials only — the summary is a
 * retrospective on a closed window, never a mid-trial verdict.
 */
export async function setSummary(
  userId: string,
  trialId: string,
  summary: { text: string; model: string },
): Promise<boolean> {
  if (!UUID.test(trialId)) return false;
  const sql = getSql();
  const rows = (await sql`
    update trials
       set summary = ${summary.text},
           summary_model = ${summary.model},
           summary_generated_at = now(),
           updated_at = now()
     where id = ${trialId} and user_id = ${userId} and status = 'completed'
     returning id`) as Record<string, unknown>[];
  return rows.length > 0;
}

/** The user's own words on a finished trial. Null clears them. */
export async function setUserReview(
  userId: string,
  trialId: string,
  review: string | null,
): Promise<boolean> {
  if (!UUID.test(trialId)) return false;
  const sql = getSql();
  const rows = (await sql`
    update trials
       set user_review = ${review}, updated_at = now()
     where id = ${trialId} and user_id = ${userId} and status = 'completed'
     returning id`) as Record<string, unknown>[];
  return rows.length > 0;
}

export async function createTrial(userId: string, input: CreateTrialInput): Promise<string> {
  const sql = getSql();
  const id = randomUUID();

  // One transaction: a trial whose baseline capture failed to land would show a
  // day counter with nothing measured under it, and the user would have paid
  // YouCam units for a row that isn't there.
  await sql.transaction([
    sql`insert into trials
          (id, user_id, name, start_date, end_date, end_date_source, time_of_day,
           visibility, frequency, baseline)
        values (
          ${id}, ${userId}, ${input.name.trim()},
          ${input.startDate}::date,
          ${input.endDate}::date,
          ${input.endDateSource}::end_date_source,
          ${input.timeOfDay}::trial_time_of_day,
          ${input.visibility}::trial_visibility,
          ${JSON.stringify(input.frequency)}::jsonb,
          ${JSON.stringify(input.baseline)}::jsonb
        )`,

    ...input.interventions.map((item, position) => {
      const targets = validateConcerns(item.targets);
      return sql`
        insert into trial_interventions
          (id, trial_id, position, direction, brand, name, started_on,
           targets, ranked, provenance, classifier, product_key, dosage, catalog_product_id)
        values (
          ${randomUUID()}, ${id}, ${position}, 'add',
          ${item.brand?.trim() || null}, ${item.name.trim()},
          ${input.startDate}::date,
          ${targets}::analysis_concern[],
          ${JSON.stringify(item.ranked ?? [])}::jsonb,
          ${item.provenance ?? 'user-edited'}::target_provenance,
          ${item.classifier ? JSON.stringify(item.classifier) : null}::jsonb,
          ${item.productKey ?? null},
          ${item.dosage?.trim() || null},
          ${item.catalogProductId ?? null}
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
