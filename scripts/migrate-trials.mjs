/**
 * Create the trial tables. Idempotent — safe to re-run.
 *
 *   node --env-file=.env.local scripts/migrate-trials.mjs
 *
 * Costs no YouCam units and makes no Gemini call. Neon only.
 *
 * Depends on `analysis_concern` and `target_provenance` from
 * migrate-routines.mjs, which is why that script runs first. Both are created
 * with the same `duplicate_object` guard, so re-running either is harmless.
 *
 * Trials created in the app live here; the twenty-photo reference series stays
 * in fixtures/trials.json and is read straight off disk. `lib/trials.ts` unions
 * the two, so a missing DATABASE_URL costs saved trials and leaves the demo
 * path intact (BRIEF.md requires it to run with no network at all).
 */

import { neon } from '@neondatabase/serverless';

const STATEMENTS = [
  `do $$ begin
     create type trial_status as enum ('active', 'completed');
   exception when duplicate_object then null; end $$`,

  // 'user-chosen' covers the 30-day default. Null means open-ended, which is
  // also what `end_date` null means — the two travel together.
  `do $$ begin
     create type end_date_source as enum ('clinician', 'product-claim', 'user-chosen');
   exception when duplicate_object then null; end $$`,

  // Which routine this trial sits on — morning and night are separate logs
  // (docs/app-ui.md, "One routine, and what that costs"). Defaults to 'am'.
  `do $$ begin
     create type trial_time_of_day as enum ('am', 'pm');
   exception when duplicate_object then null; end $$`,

  // Whether the community can watch this trial. Private is the default and the
  // column default, so a trial is never published by omission.
  `do $$ begin
     create type trial_visibility as enum ('private', 'public');
   exception when duplicate_object then null; end $$`,

  // `end_date` is nullable on purpose: the window is a marker, not a lock
  // (docs/trial-model.md). A trial ends when the user ends it, which is what
  // `ended_at` records — passing `end_date` changes nothing on its own.
  //
  // `baseline` is jsonb rather than a foreign key to `routines`. That is the
  // whole point of `snapshotRoutine()`: editing [Night] in October must not
  // move a metric between `confounded` and `unexplained` in a trial that
  // started in August, and deleting the routine must leave it standing.
  `create table if not exists trials (
     id              uuid primary key default gen_random_uuid(),
     user_id         text not null default 'local',
     name            text not null,
     status          trial_status not null default 'active',
     start_date      date not null,
     end_date        date,
     end_date_source end_date_source,
     time_of_day     trial_time_of_day not null default 'am',
     visibility      trial_visibility not null default 'private',
     frequency       jsonb not null default '{"kind":"daily"}',
     baseline        jsonb not null default '[]',
     ended_at        timestamptz,
     created_at      timestamptz not null default now(),
     updated_at      timestamptz not null default now()
   )`,

  // Runs against tables created before `time_of_day` existed; a no-op once the
  // column is there.
  `alter table trials
     add column if not exists time_of_day trial_time_of_day not null default 'am'`,

  // Existing rows were created before the toggle existed and become private,
  // which is the only safe way to backfill it.
  `alter table trials
     add column if not exists visibility trial_visibility not null default 'private'`,

  `create index if not exists trials_user_idx
     on trials (user_id, created_at desc)`,

  // Mirrors `routine_items` — same classifier output, same provenance ladder.
  // `direction` is always 'add' from the new-trial form: a removal is filed as
  // its own trial with an empty intervention list, because starting and
  // stopping inside one log leaves the series ambiguous about which regime a
  // capture belongs to (docs/trial-model.md). The column keeps 'remove' because
  // the dashboard already renders it and the model has always allowed it.
  `create table if not exists trial_interventions (
     id           uuid primary key default gen_random_uuid(),
     trial_id     uuid not null references trials(id) on delete cascade,
     position     integer not null default 0,
     direction    text not null default 'add',
     brand        text,
     name         text not null,
     started_on   date not null,
     targets      analysis_concern[] not null default '{}',
     ranked       jsonb not null default '[]',
     provenance   target_provenance not null default 'user-edited',
     classifier   jsonb,
     product_key  text,
     created_at   timestamptz not null default now()
   )`,

  `create index if not exists trial_interventions_trial_idx
     on trial_interventions (trial_id, position)`,

  // `captured_at` defaults to now() and is never accepted from the client.
  // Backdating would misreport adherence *and* silently move the error bars,
  // since minimum detectable effect is computed from real timestamps
  // (docs/app-ui.md §5).
  //
  // `resolution` is stored so a series can be checked for the SD/HD mix that
  // rule 4 warns about. Nothing guards a series automatically; this at least
  // makes the violation visible after the fact.
  `create table if not exists trial_captures (
     id            uuid primary key default gen_random_uuid(),
     trial_id      uuid not null references trials(id) on delete cascade,
     captured_at   timestamptz not null default now(),
     device        text,
     resolution    text not null default 'hd',
     blob_url      text,
     blob_pathname text,
     concerns      jsonb,
     zones         jsonb,
     skin_age      numeric,
     created_at    timestamptz not null default now()
   )`,

  `create index if not exists trial_captures_trial_idx
     on trial_captures (trial_id, captured_at)`,

  // How much of the product goes on per use ("2 pumps", "0.5 mg"). Display and
  // summary framing only — it never enters the measurement path.
  `alter table trial_interventions
     add column if not exists dosage text`,

  // The user's own words on one photo — context a picture can't carry
  // ("sunburned", "slept badly"). Editable, unlike the capture itself.
  `alter table trial_captures
     add column if not exists note text`,

  // FK into `catalog_products`, set only when the intervention came from a
  // catalog pick — mirrors `routine_items.catalog_product_id` (see that
  // migration's comment). Read-only enrichment for display (a thumbnail);
  // `targets[]` stay the frozen identity the item was added under and never
  // re-derive from this, so `on delete set null` rather than cascade.
  //
  // README's setup order runs this migration before migrate-catalog.mjs, so
  // catalog_products may not exist yet on a fresh install — add the column
  // plain in that case and skip the constraint rather than failing the script.
  `do $$ begin
     if to_regclass('catalog_products') is not null then
       alter table trial_interventions
         add column if not exists catalog_product_id
           uuid references catalog_products(id) on delete set null;
     else
       alter table trial_interventions
         add column if not exists catalog_product_id uuid;
     end if;
   end $$`,

  // Whether readers of a public trial may comment. The owner's switch.
  `alter table trials
     add column if not exists comments_enabled boolean not null default true`,

  // Photo privacy is separate from trial visibility. A public trial shows
  // metrics and routine by default; photos are shared only when the owner
  // explicitly opts in. The column default is 'private', then existing public
  // trials are left public so already-shared records don't silently change.
  `alter table trials
     add column if not exists photos_visibility trial_visibility not null default 'private'`,

  `update trials
      set photos_visibility = 'public'
    where visibility = 'public'`,

  // How many signed-in non-owners have opened a public trial. The only
  // popularity signal the community shows, deliberately (ideas.md): no likes,
  // no hearts, nothing to optimise a feed against the product's premise.
  `alter table trials
     add column if not exists view_count integer not null default 0`,

  // The narrative layer, written by Gemini when the user asks for it after the
  // trial ends, plus the user's own review. The gate is applied before the
  // model ever sees a number (docs/app-ui.md §6).
  `alter table trials
     add column if not exists summary text`,
  `alter table trials
     add column if not exists summary_model text`,
  `alter table trials
     add column if not exists summary_generated_at timestamptz`,
  `alter table trials
     add column if not exists user_review text`,

  // "Applied products" check-ins. Each press is a row; a capture reports the
  // hours since the most recent one before it. Timestamps are server-side for
  // the same reason captured_at is.
  `create table if not exists trial_applications (
     id          uuid primary key default gen_random_uuid(),
     trial_id    uuid not null references trials(id) on delete cascade,
     applied_at  timestamptz not null default now()
   )`,

  `create index if not exists trial_applications_trial_idx
     on trial_applications (trial_id, applied_at)`,

  // Extra photos attached to one day's capture — different angles the analysis
  // API doesn't support. Never analysed, so they cost no units; qualitative
  // context only.
  `create table if not exists trial_capture_photos (
     id            uuid primary key default gen_random_uuid(),
     capture_id    uuid not null references trial_captures(id) on delete cascade,
     position      integer not null default 0,
     blob_url      text not null,
     blob_pathname text not null,
     created_at    timestamptz not null default now()
   )`,

  `create index if not exists trial_capture_photos_capture_idx
     on trial_capture_photos (capture_id, position)`,

  // Comments on public trials. Body only — no votes, no threads.
  `create table if not exists trial_comments (
     id          uuid primary key default gen_random_uuid(),
     trial_id    uuid not null references trials(id) on delete cascade,
     user_id     text not null,
     body        text not null,
     created_at  timestamptz not null default now()
   )`,

  `create index if not exists trial_comments_trial_idx
     on trial_comments (trial_id, created_at)`,

  // A reader bookmarking someone else's public trial.
  `create table if not exists trial_saves (
     user_id     text not null,
     trial_id    uuid not null references trials(id) on delete cascade,
     created_at  timestamptz not null default now(),
     primary key (user_id, trial_id)
   )`,
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run: vercel env pull .env.local --yes');
  process.exit(1);
}

const sql = neon(url);

for (const statement of STATEMENTS) {
  await sql.query(statement);
  console.log(`  ok  ${statement.split('\n')[0].trim().slice(0, 68)}`);
}

const [{ count }] = await sql`select count(*)::int as count from trials`;
console.log(`\ntrial tables ready — ${count} trial(s) stored`);
