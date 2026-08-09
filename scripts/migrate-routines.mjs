
  `create index if not exists routine_items_routine_idx
     on routine_items (routine_id, position)`,

  // Nullable, unlike `product_key`: only a catalog-sourced pick has a row to
  // point at (typed names, barcode scans and ingredient-photo reads never
  // touch catalog_products). `targets`/`brand`/`name` stay the frozen identity
  // this item was added under — this FK is read-only enrichment (the image),
  // never a source of truth for attribution, so `on delete set null` rather
  // than cascade: a catalog row disappearing must not delete someone's routine
  // item, just its picture.
  //
  // README's setup order runs this migration before migrate-catalog.mjs, so
  // catalog_products may not exist yet on a fresh install — add the column
  // plain in that case and skip the constraint rather than failing the whole
  // script. Re-running this file after migrate-catalog.mjs has run will not
  // retrofit the constraint, but the column and the join both work without it.
  `do $$ begin
     if to_regclass('catalog_products') is not null then
       alter table routine_items
         add column if not exists catalog_product_id
           uuid references catalog_products(id) on delete set null;
     else
       alter table routine_items
         add column if not exists catalog_product_id uuid;
     end if;
   end $$`,
];

const url = process.env.DATABASE_URL;