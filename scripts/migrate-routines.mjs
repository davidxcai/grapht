/**
 * Create the routine tables. Idempotent — safe to re-run.
 *
 *   node --env-file=.env.local scripts/migrate-routines.mjs
 *
 * Costs no YouCam units and makes no Gemini call. Neon only.
 *
 * The concern enum is generated from `src/concerns.mjs` rather than typed out
 * here, so the database vocabulary cannot drift from the canonical one (rule 5).
 * The 14 keys are fixed by the analysis API, so an enum is the honest encoding:
 * a bad target key is rejected by the database as well as by
 * `normalizeConcerns()`, and neither layer can silently accept `pores`.
 */

import { neon } from '@neondatabase/serverless';
import { ANALYSIS_CONCERNS } from '../src/concerns.mjs';
import { PROVENANCE } from '../src/products.mjs';

const CONCERN_ENUM = ANALYSIS_CONCERNS.map((c) => `'${c}'`).join(', ');
const PROVENANCE_ENUM = Object.values(PROVENANCE)
  .map((p) => `'${p}'`)
  .join(', ');

const STATEMENTS = [
  `do $$ begin
     create type analysis_concern as enum (${CONCERN_ENUM});
   exception when duplicate_object then null; end $$`,

  `do $$ begin
     create type target_provenance as enum (${PROVENANCE_ENUM});
   exception when duplicate_object then null; end $$`,

  // `user_id` has no auth behind it yet — sign-up is designed, not built
  // (docs/app-ui.md §2). It defaults to 'local' so routines are already scoped
  // when accounts land, rather than needing a migration then.
  `create table if not exists routines (
     id          uuid primary key default gen_random_uuid(),
     user_id     text not null default 'local',
     name        text not null,
     position    integer not null default 0,
     created_at  timestamptz not null default now(),
     updated_at  timestamptz not null default now()
   )`,

  // One [Night] per person. Two routines with the same name are indistinguishable
  // in the trial-creation picker, which is the one place the name has to be
  // unambiguous.
  `create unique index if not exists routines_user_name_idx
     on routines (user_id, lower(name))`,

  // `ranked`, `provenance` and `classifier` mirror a product cache record
  // (src/products.mjs buildRecord). Keeping the classifier's full ranked list
  // means the editor can offer the medium/low-confidence concerns as
  // suggestions without paying for the call again, and a later reader can see
  // what was considered and rejected.
  `create table if not exists routine_items (
     id           uuid primary key default gen_random_uuid(),
     routine_id   uuid not null references routines(id) on delete cascade,
     position     integer not null default 0,
     brand        text,
     name         text not null,
     targets      analysis_concern[] not null default '{}',
     ranked       jsonb not null default '[]',
     provenance   target_provenance not null default 'user-edited',
     classifier   jsonb,
     product_key  text,
     created_at   timestamptz not null default now(),
     updated_at   timestamptz not null default now()
   )`,

  `create index if not exists routine_items_routine_idx
     on routine_items (routine_id, position)`,
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

const [{ count }] = await sql`select count(*)::int as count from routines`;
console.log(`\nroutine tables ready — ${count} routine(s) stored`);
