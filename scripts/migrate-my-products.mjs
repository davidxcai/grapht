/**
 * Create the user_products table. Idempotent — safe to re-run.
 *
 *   node --env-file=.env.local scripts/migrate-my-products.mjs
 *
 * Costs no YouCam units and makes no Gemini call. Neon only.
 *
 * Depends on catalog_products (for the optional FK) and profiles (for the
 * my_products_seeded backfill flag). Run this after migrate-catalog.mjs and
 * migrate-profiles.mjs.
 */

import { neon } from '@neondatabase/serverless';

const STATEMENTS = [
  `create table if not exists user_products (
     id                  uuid primary key default gen_random_uuid(),
     user_id             text not null,
     catalog_product_id  uuid,
     brand               text,
     name                text not null,
     created_at          timestamptz not null default now(),
     updated_at          timestamptz not null default now()
   )`,

  `create index if not exists user_products_user_idx
     on user_products (user_id, created_at desc)`,

  // A user can only save a catalog product once.
  `create unique index if not exists user_products_catalog_idx
     on user_products (user_id, catalog_product_id)
     where catalog_product_id is not null`,

  // Typed/scanned products (no catalog row) are unique by brand+name.
  `create unique index if not exists user_products_name_idx
     on user_products (user_id, lower(coalesce(brand, '')), lower(name))
     where catalog_product_id is null`,

  // Optional FK into catalog_products. The conditional block keeps this
  // migration from failing when run before migrate-catalog.mjs on a fresh
  // install; re-running it after catalog exists will retrofit the constraint.
  `do $$
   begin
     if to_regclass('catalog_products') is not null
        and not exists (
          select 1 from pg_constraint
           where conname = 'user_products_catalog_fk'
        ) then
       alter table user_products
         add constraint user_products_catalog_fk
         foreign key (catalog_product_id) references catalog_products(id) on delete set null;
     end if;
   end $$`,

  // Track whether an existing user's routine/trial products have already been
  // copied into their collection. This column is also added by
  // migrate-profiles.mjs; the duplicate `if not exists` keeps either script
  // safe to run first.
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

const [{ count }] = await sql`select count(*)::int as count from user_products`;
console.log(`\nmy products table ready — ${count} saved product(s) stored`);
