import 'server-only';

import { getSql } from '@/lib/db';
import { clerkConfigured } from '@/lib/auth';
import { getProfile, setMyProductsSeeded } from '@/lib/profile-store';
import { orderConcerns } from '@/lib/concerns';

/**
 * A user's personal collection of skincare products.
 *
 * Products can come from the catalog (via `catalog_product_id`) or be plain
 * brand+name entries for items that were typed, scanned, or imported from a
 * routine/trial before they had a catalog row. The collection is the one place
 * a user can browse and remove their saved products; whether a product is
 * currently "in use" is derived from `routine_items` and `trial_interventions`.
 */

export interface MyProduct {
  id: string;
  userId: string;
  catalogProductId: string | null;
  brand: string | null;
  name: string;
  image: string | null;
  concernTags: string[];
  inUse: boolean;
}

export interface MyProductIdentity {
  catalogProductId?: string | null;
  brand?: string | null;
  name: string;
}

interface MyProductRow {
  id: string;
  user_id: string;
  catalog_product_id: string | null;
  brand: string | null;
  name: string;
  image: string | null;
  concern_tags: string[];
}

interface UsageRow {
  catalog_product_id: string | null;
  brand: string | null;
  name: string;
}

function productSlug(brand: string | null, name: string): string {
  return [brand, name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeBrandName(brand: string | null, name: string) {
  return {
    brand: (brand ?? '').trim().toLowerCase(),
    name: name.trim().toLowerCase(),
  };
}

function productIdentitiesMatch(
  a: { catalogProductId: string | null; brand: string | null; name: string },
  b: { catalogProductId: string | null; brand: string | null; name: string },
): boolean {
  if (a.catalogProductId && b.catalogProductId && a.catalogProductId === b.catalogProductId) {
    return true;
  }
  const aKey = normalizeBrandName(a.brand, a.name);
  const bKey = normalizeBrandName(b.brand, b.name);
  return aKey.brand === bKey.brand && aKey.name === bKey.name;
}

function toMyProductRow(row: Record<string, unknown>): MyProductRow {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    catalog_product_id: (row.catalog_product_id as string | null) ?? null,
    brand: (row.brand as string | null) ?? null,
    name: row.name as string,
    image: (row.image as string | null) ?? null,
    concern_tags: (row.concern_tags as string[]) ?? [],
  };
}

function toMyProduct(row: MyProductRow, inUse: boolean): MyProduct {
  return {
    id: row.id,
    userId: row.user_id,
    catalogProductId: row.catalog_product_id,
    brand: row.brand,
    name: row.name,
    image: row.image,
    concernTags: orderConcerns(row.concern_tags ?? []),
    inUse,
  };
}

async function getUsageItems(userId: string): Promise<UsageRow[]> {
  const sql = getSql();
  const rows = (await sql.query(
    `select i.catalog_product_id, i.brand, i.name
       from routine_items i
       join routines r on r.id = i.routine_id
      where r.user_id = $1
      union all
     select v.catalog_product_id, v.brand, v.name
       from trial_interventions v
       join trials t on t.id = v.trial_id
      where t.user_id = $1`,
    [userId],
  )) as UsageRow[];
  return rows;
}

async function getSavedItems(userId: string): Promise<UsageRow[]> {
  const sql = getSql();
  const rows = (await sql`
    select catalog_product_id, brand, name
      from user_products
     where user_id = ${userId}`) as UsageRow[];
  return rows;
}

function productInUse(
  product: MyProductIdentity,
  usageItems: UsageRow[],
): boolean {
  return usageItems.some((item) =>
    productIdentitiesMatch(
      { catalogProductId: product.catalogProductId ?? null, brand: product.brand ?? null, name: product.name },
      { catalogProductId: item.catalog_product_id, brand: item.brand, name: item.name },
    ),
  );
}

function productSaved(
  product: MyProductIdentity,
  savedItems: UsageRow[],
): boolean {
  return savedItems.some((item) =>
    productIdentitiesMatch(
      { catalogProductId: product.catalogProductId ?? null, brand: product.brand ?? null, name: product.name },
      { catalogProductId: item.catalog_product_id, brand: item.brand, name: item.name },
    ),
  );
}

async function seedFromUsage(userId: string): Promise<void> {
  const sql = getSql();
  await sql.query(
    `insert into user_products (user_id, catalog_product_id, brand, name)
     select $1, i.catalog_product_id,
            coalesce(cp.brand_name, i.brand),
            coalesce(cp.name, i.name)
       from routine_items i
       join routines r on r.id = i.routine_id
       left join catalog_products cp on cp.id = i.catalog_product_id
      where r.user_id = $1
        and (i.catalog_product_id is not null or i.name is not null)
      on conflict do nothing`,
    [userId],
  );
  await sql.query(
    `insert into user_products (user_id, catalog_product_id, brand, name)
     select $1, v.catalog_product_id,
            coalesce(cp.brand_name, v.brand),
            coalesce(cp.name, v.name)
       from trial_interventions v
       join trials t on t.id = v.trial_id
       left join catalog_products cp on cp.id = v.catalog_product_id
      where t.user_id = $1
        and (v.catalog_product_id is not null or v.name is not null)
      on conflict do nothing`,
    [userId],
  );
}

async function shouldSeed(userId: string): Promise<boolean> {
  // Keyless demo users have no profile; seed once from routines/trials if the
  // collection is empty, with the understanding that removing the last product
  // will re-seed on the next visit. Real users track the seed in `profiles`.
  if (!clerkConfigured) {
    const sql = getSql();
    const rows = (await sql`
      select count(*)::int as n from user_products where user_id = ${userId}`) as { n: number }[];
    return rows[0].n === 0;
  }

  const profile = await getProfile(userId).catch(() => null);
  if (!profile) return false;
  if (profile.myProductsSeeded) return false;

  const sql = getSql();
  const rows = (await sql`
    select count(*)::int as n from user_products where user_id = ${userId}`) as { n: number }[];
  if (rows[0].n === 0) return true;

  // If rows already exist (added before this feature), mark seeded and stop.
  await setMyProductsSeeded(userId);
  return false;
}

async function maybeSeed(userId: string): Promise<void> {
  if (await shouldSeed(userId)) {
    await seedFromUsage(userId);
    if (clerkConfigured) {
      await setMyProductsSeeded(userId);
    }
  }
}

export async function listMyProducts(userId: string): Promise<MyProduct[]> {
  await maybeSeed(userId);
  const sql = getSql();
  const [rawRows, usage] = await Promise.all([
    sql.query(
      `select up.id, up.user_id, up.catalog_product_id, up.brand, up.name,
              cp.image_url as image, cp.concern_tags::text[] as concern_tags
         from user_products up
         left join catalog_products cp on cp.id = up.catalog_product_id
        where up.user_id = $1
        order by up.created_at desc`,
      [userId],
    ),
    getUsageItems(userId),
  ]);

  const rows = (rawRows as Record<string, unknown>[]).map(toMyProductRow);
  return rows.map((row) =>
    toMyProduct(row, productInUse({ catalogProductId: row.catalog_product_id, brand: row.brand, name: row.name }, usage)),
  );
}

export async function getMyProduct(userId: string, id: string): Promise<MyProduct | null> {
  const sql = getSql();
  const [rawRows, usage] = await Promise.all([
    sql.query(
      `select up.id, up.user_id, up.catalog_product_id, up.brand, up.name,
              cp.image_url as image, cp.concern_tags::text[] as concern_tags
         from user_products up
         left join catalog_products cp on cp.id = up.catalog_product_id
        where up.id = $1 and up.user_id = $2`,
      [id, userId],
    ),
    getUsageItems(userId),
  ]);

  const rows = (rawRows as Record<string, unknown>[]).map(toMyProductRow);
  const row = rows[0];
  if (!row) return null;
  return toMyProduct(row, productInUse({ catalogProductId: row.catalog_product_id, brand: row.brand, name: row.name }, usage));
}

export async function addMyProduct(
  userId: string,
  identity: MyProductIdentity,
): Promise<MyProduct> {
  const name = identity.name.trim();
  if (!name) throw new Error('Product name is required.');

  let brand = (identity.brand?.trim() || null) ?? null;
  let catalogProductId = identity.catalogProductId ?? null;

  const sql = getSql();

  // If a catalog id was given, normalise brand/name against the catalog so the
  // saved entry stays in sync with the canonical identity. If the id does not
  // resolve, fall back to a brand+name entry.
  if (catalogProductId) {
    const catalogRows = (await sql`
      select brand_name, name from catalog_products where id = ${catalogProductId}`) as {
      brand_name: string | null;
      name: string;
    }[];
    if (catalogRows[0]) {
      brand = catalogRows[0].brand_name ?? brand;
      const catalogName = catalogRows[0].name.trim();
      if (catalogName) {
        await sql.query(
          `insert into user_products (user_id, catalog_product_id, brand, name)
           values ($1, $2, $3, $4)
           on conflict do nothing`,
          [userId, catalogProductId, catalogRows[0].brand_name, catalogName],
        );
      }
    } else {
      catalogProductId = null;
    }
  }

  if (!catalogProductId) {
    await sql.query(
      `insert into user_products (user_id, catalog_product_id, brand, name)
       values ($1, $2, $3, $4)
       on conflict do nothing`,
      [userId, null, brand, name],
    );
  }

  const rawRows = await sql.query(
    `select up.id, up.user_id, up.catalog_product_id, up.brand, up.name,
            cp.image_url as image, cp.concern_tags::text[] as concern_tags
       from user_products up
       left join catalog_products cp on cp.id = up.catalog_product_id
      where up.user_id = $1
        and (
          ($2::uuid is not null and up.catalog_product_id = $2::uuid)
          or ($2::uuid is null
              and lower(coalesce(up.brand, '')) = lower(coalesce($3, ''))
              and lower(up.name) = lower($4))
        )`,
    [userId, catalogProductId, brand, name],
  );
  const rows = (rawRows as Record<string, unknown>[]).map(toMyProductRow);

  const row = rows[0];
  if (!row) throw new Error('Product could not be saved.');

  const usage = await getUsageItems(userId);
  return toMyProduct(row, productInUse({ catalogProductId: row.catalog_product_id, brand: row.brand, name: row.name }, usage));
}

export async function removeMyProduct(userId: string, id: string): Promise<void> {
  const sql = getSql();
  await sql`delete from user_products where id = ${id} and user_id = ${userId}`;
}

export async function removeMyProductByIdentity(
  userId: string,
  identity: MyProductIdentity,
): Promise<void> {
  const name = identity.name.trim();
  const brand = (identity.brand?.trim() || null) ?? null;
  const catalogProductId = identity.catalogProductId ?? null;
  const sql = getSql();
  await sql.query(
    `delete from user_products
      where user_id = $1
        and (
          ($2::uuid is not null and catalog_product_id = $2::uuid)
          or ($2::uuid is null
              and lower(coalesce(brand, '')) = lower(coalesce($3, ''))
              and lower(name) = lower($4))
        )`,
    [userId, catalogProductId, brand, name],
  );
}

export async function isProductSaved(
  userId: string,
  identity: MyProductIdentity,
): Promise<boolean> {
  const saved = await getSavedItems(userId);
  return productSaved(
    { catalogProductId: identity.catalogProductId ?? null, brand: identity.brand ?? null, name: identity.name },
    saved,
  );
}

export async function isProductInUse(
  userId: string,
  identity: MyProductIdentity,
): Promise<boolean> {
  const usage = await getUsageItems(userId);
  return productInUse(
    { catalogProductId: identity.catalogProductId ?? null, brand: identity.brand ?? null, name: identity.name },
    usage,
  );
}

export async function getProductCollectionState(
  userId: string,
  identity: MyProductIdentity,
): Promise<{ saved: boolean; inUse: boolean }> {
  const [saved, usage] = await Promise.all([getSavedItems(userId), getUsageItems(userId)]);
  const probe = { catalogProductId: identity.catalogProductId ?? null, brand: identity.brand ?? null, name: identity.name };
  return { saved: productSaved(probe, saved), inUse: productInUse(probe, usage) };
}

export async function getProductCollectionStates(
  userId: string,
  products: { id: string; catalogProductId?: string | null; brand?: string | null; name: string }[],
): Promise<Map<string, { saved: boolean; inUse: boolean }>> {
  const [saved, usage] = await Promise.all([getSavedItems(userId), getUsageItems(userId)]);
  const out = new Map<string, { saved: boolean; inUse: boolean }>();
  for (const product of products) {
    const probe = {
      catalogProductId: product.catalogProductId ?? null,
      brand: product.brand ?? null,
      name: product.name,
    };
    out.set(product.id, {
      saved: productSaved(probe, saved),
      inUse: productInUse(probe, usage),
    });
  }
  return out;
}
