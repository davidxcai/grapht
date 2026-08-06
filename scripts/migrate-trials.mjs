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
     frequency       jsonb not null default '{"kind":"daily"}',
     baseline        jsonb not null default '[]',
     ended_at        timestamptz,
     created_at      timestamptz not null default now(),
     updated_at      timestamptz not null default now()
   )`,

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
