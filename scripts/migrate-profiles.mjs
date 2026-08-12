/**
 * Create the profile table. Idempotent — safe to re-run.
 *
 *   node --env-file=.env.local scripts/migrate-profiles.mjs
 *
 * Costs no YouCam units and makes no Gemini call. Neon only.
 *
 * Clerk owns the account: email, password, Google, and the avatar. This table
 * owns only what Clerk has no opinion about — the fields docs/app-ui.md §2 asks
 * for. `user_id` is the Clerk id and is the same value `routines.user_id` and
 * `trials.user_id` carry, which is what makes a profile row the marker for "this
 * account finished signing up".
 *
 * **Nothing here may enter the measurement path.** Skin type and birthday shape
 * who a reader compares themselves to and at most a sentence of framing. They
 * may never adjust, weight, or normalise a score — the noise floor is per-user
 * and empirical, and a demographic prior would corrupt it invisibly (§2).
 */

import { neon } from '@neondatabase/serverless';

const STATEMENTS = [
  // Fitzpatrick is more clinically precise, but most people don't know their
  // number and it answers a UV question this product isn't asking (§2).
  `do $$ begin
     create type skin_type as enum ('oily', 'dry', 'combination', 'normal', 'sensitive');
   exception when duplicate_object then null; end $$`,

  // Collected at onboarding, stored, and not yet enforced anywhere — nothing
  // in the community surfaces reads it. It exists so the field isn't asked for
  // twice once the gating logic is built.
  `do $$ begin
     create type profile_visibility as enum ('public', 'private');
   exception when duplicate_object then null; end $$`,

  // No email column: Clerk holds it, and a copy here would go stale the moment
  // someone changes it. `username` is the only identity this table adds.
  `create table if not exists profiles (
     user_id     text primary key,
     username    text not null,
     skin_type   skin_type not null,
     birthday    date not null,
     visibility  profile_visibility not null default 'public',
     created_at  timestamptz not null default now(),
     updated_at  timestamptz not null default now()
   )`,

  // `create table if not exists` skips the column on a database that already
  // had the table before `visibility` existed.
  `alter table profiles add column if not exists visibility profile_visibility not null default 'public'`,

  // Case-insensitive, so "Ada" and "ada" are the same person's claim. Matches
  // how `routines_user_name_idx` treats a routine name.
  `create unique index if not exists profiles_username_idx
     on profiles (lower(username))`,

  // Track whether an existing user's routine/trial products have already been
  // copied into their My Products collection.
  `alter table profiles add column if not exists my_products_seeded boolean not null default false`,
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

const [{ count }] = await sql`select count(*)::int as count from profiles`;
const [{ unclaimed }] = await sql`
  select (select count(*) from routines where user_id = 'local')
       + (select count(*) from trials   where user_id = 'local') as unclaimed`;

console.log(`\nprofile table ready — ${count} account(s)`);
if (Number(unclaimed) > 0) {
  console.log(
    `${unclaimed} row(s) still owned by 'local' — the next account to finish sign-up claims them`,
  );
}
