import 'server-only';
import { clerkClient } from '@clerk/nextjs/server';

import { getSql } from '@/lib/db';
import { clerkConfigured } from '@/lib/auth';
import { assembleTrials, getFixtureTrials, INTERVENTION_COLUMNS, CATALOG_JOIN } from '@/lib/trial-store';
import { listPublicRoutines } from '@/lib/routines';
import type { Trial, TrialStatus } from '@/lib/trials';

/**
 * The community read path: every trial whose owner set `visibility = 'public'`,
 * plus the committed reference series, which is a published sample by
 * definition. Nothing here takes an owner argument because nothing here is
 * scoped to one — these reads return only what has been deliberately published,
 * and the writes (comments, saves, views) take the acting user explicitly, same
 * as every other store.
 *
 * The one number a public trial shows is views. No likes, no hearts, no
 * ratings — a dramatic before/after would out-score a well-run trial that
 * honestly returned "no measurable change", and the second is the more valuable
 * document (ideas.md, docs/app-ui.md §8).
 */

export interface PublicTrial {
  trial: Trial;
  /** The owner's @username, null when the owner never finished sign-up. */
  handle: string | null;
  /** The owner's self-reported skin type — browsing context, never maths. */
  skinType: string | null;
  /** The owner's Clerk profile image, null when unavailable (no Clerk key,
   *  lookup failure, or an owner with no photo). Never a src for face photos —
   *  this is only ever an account avatar. */
  avatar: string | null;
  /** True for the committed reference series. */
  sample: boolean;
}

/** The reference series, shaped like any other public trial. */
function fixturePublicTrials(): PublicTrial[] {
  return getFixtureTrials()
    .filter((t) => t.visibility === 'public')
    .map((trial) => ({ trial, handle: 'grapht', skinType: null, avatar: null, sample: true }));
}

/**
 * Batch-resolves Clerk avatars for a set of owners in one Backend API call
 * rather than one round trip per card. Best-effort: a Clerk outage or missing
 * key degrades to no avatars, never to a failed page (same posture as the rest
 * of this module's database catches).
 */
async function avatarsFor(userIds: string[]): Promise<Map<string, string>> {
  const distinct = [...new Set(userIds)];
  if (!clerkConfigured || distinct.length === 0) return new Map();

  try {
    const client = await clerkClient();
    const avatars = new Map<string, string>();
    for (let i = 0; i < distinct.length; i += 100) {
      const batch = distinct.slice(i, i + 100);
      const { data } = await client.users.getUserList({ userId: batch, limit: batch.length });
      for (const user of data) {
        if (user.imageUrl) avatars.set(user.id, user.imageUrl);
      }
    }
    return avatars;
  } catch {
    return new Map();
  }
}

async function storedPublicTrials(where: string, params: unknown[]): Promise<PublicTrial[]> {
  const sql = getSql();
  // Mirrors `fetchTrialRows` in lib/trial-store.ts, with the profile joined in
  // for the handle. Kept separate because the filter is on visibility, not on
  // an owner.
  const [trialRows, interventionRows, captureRows, applicationRows, extraPhotoRows] =
    (await Promise.all([
      sql.query(
        `select t.*, p.username as owner_handle, p.skin_type as owner_skin_type
           from trials t
           left join profiles p on p.user_id = t.user_id
          where ${where}
          order by t.created_at desc`,
        params,
      ),
      sql.query(
        `select ${INTERVENTION_COLUMNS}
           from trial_interventions v
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
    ])) as Record<string, unknown>[][];

  const trials = assembleTrials(
    trialRows,
    interventionRows,
    captureRows,
    applicationRows,
    extraPhotoRows,
  );

  const meta = new Map(
    trialRows.map((t) => [
      t.id as string,
      {
        userId: t.user_id as string,
        handle: (t.owner_handle as string | null) ?? null,
        skinType: (t.owner_skin_type as string | null) ?? null,
      },
    ]),
  );

  const avatars = await avatarsFor(trialRows.map((t) => t.user_id as string));

  return trials.map((trial) => ({
    trial,
    handle: meta.get(trial.id)?.handle ?? null,
    skinType: meta.get(trial.id)?.skinType ?? null,
    avatar: (meta.get(trial.id)?.userId && avatars.get(meta.get(trial.id)!.userId)) || null,
    sample: false,
  }));
}

/**
 * Every public trial: the user-published ones first, the sample last. The
 * database failure is caught for the standing reason — nothing that renders the
 * fixture may require the database.
 */
export async function listPublicTrials(): Promise<PublicTrial[]> {
  try {
    const stored = await storedPublicTrials(`t.visibility = 'public'`, []);
    return [...stored, ...fixturePublicTrials()];
  } catch {
    return fixturePublicTrials();
  }
}

/**
 * The homepage feed: the N most recently created public trials, regardless of
 * status (active and completed interleaved by recency) unless a specific
 * status is passed — straight from the database, no fixture, since the
 * sample series is a fixed demo asset rather than part of the live recency
 * stream. Fetches matching ids first so the LIMIT applies before the
 * capture/intervention joins in `storedPublicTrials` pull in a whole trial's
 * history.
 */
export async function listRecentPublicTrials(
  limit: number,
  status?: TrialStatus,
): Promise<PublicTrial[]> {
  try {
    const sql = getSql();
    const idRows = (await sql`
      select id from trials
       where visibility = 'public' and (${status ?? null}::text is null or status = ${status ?? null})
       order by created_at desc
       limit ${limit}`) as Record<string, unknown>[];
    const ids = idRows.map((r) => r.id as string);
    if (ids.length === 0) return [];
    const rows = await storedPublicTrials(`t.visibility = 'public' and t.id = any($1)`, [ids]);
    const order = new Map(ids.map((id, i) => [id, i]));
    return rows.sort((a, b) => (order.get(a.trial.id) ?? 0) - (order.get(b.trial.id) ?? 0));
  } catch {
    return [];
  }
}

/**
 * One public trial by id — the read that lets a visitor open someone else's
 * published trial. Null covers "no such trial" and "not public" alike, so a
 * private trial 404s identically to a nonexistent one.
 */
export async function getPublicTrial(id: string): Promise<PublicTrial | null> {
  const sample = fixturePublicTrials().find((p) => p.trial.id === id);
  if (sample) return sample;

  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const rows = await storedPublicTrials(`t.visibility = 'public' and t.id = $1`, [id]);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Count a signed-in non-owner opening a public trial. Fire-and-forget from the
 * page; a failed increment costs a view, never the render.
 */
export async function recordView(trialId: string, viewerId: string | null): Promise<void> {
  if (!viewerId || !/^[0-9a-f-]{36}$/i.test(trialId)) return;
  try {
    const sql = getSql();
    await sql`
      update trials set view_count = view_count + 1
       where id = ${trialId} and visibility = 'public' and user_id <> ${viewerId}`;
  } catch {
    // A lost view is not worth an error.
  }
}

/* ---------- comments ---------- */

export interface TrialComment {
  id: string;
  handle: string | null;
  body: string;
  createdAt: string;
  /** True when the acting user wrote it, so the UI can offer delete. */
  mine: boolean;
  /** The comment author's Clerk profile image, null when unavailable. */
  avatar: string | null;
}

export async function listComments(trialId: string, viewerId: string | null): Promise<TrialComment[]> {
  if (!/^[0-9a-f-]{36}$/i.test(trialId)) return [];
  const sql = getSql();
  const rows = (await sql`
    select c.id, c.body, c.created_at, c.user_id, p.username
      from trial_comments c
      left join profiles p on p.user_id = c.user_id
     where c.trial_id = ${trialId}
     order by c.created_at asc`) as Record<string, unknown>[];

  const avatars = await avatarsFor(rows.map((r) => r.user_id as string).filter(Boolean));

  return rows.map((r) => {
    const userId = r.user_id as string | null;
    return {
      id: r.id as string,
      handle: (r.username as string | null) ?? null,
      body: r.body as string,
      createdAt: new Date(r.created_at as string).toISOString(),
      mine: viewerId !== null && r.user_id === viewerId,
      avatar: (userId ? avatars.get(userId) ?? null : null) as string | null,
    };
  });
}

/**
 * Comment on a public trial with comments enabled. The guards ride inside the
 * insert so a trial made private, or its comments switched off, between read
 * and write refuses rather than landing.
 */
export async function addComment(
  userId: string,
  trialId: string,
  body: string,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(trialId)) return false;
  const sql = getSql();
  const rows = (await sql`
    insert into trial_comments (trial_id, user_id, body)
    select ${trialId}::uuid, ${userId}, ${body}
     where exists (
       select 1 from trials
        where id = ${trialId}::uuid and visibility = 'public' and comments_enabled
     )
    returning id`) as Record<string, unknown>[];
  return rows.length > 0;
}

/** The author or the trial's owner may delete; nobody else matches a row. */
export async function deleteComment(userId: string, commentId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(commentId)) return false;
  const sql = getSql();
  const rows = (await sql`
    delete from trial_comments c
     using trials t
     where c.id = ${commentId}::uuid and t.id = c.trial_id
       and (c.user_id = ${userId} or t.user_id = ${userId})
     returning c.id`) as Record<string, unknown>[];
  return rows.length > 0;
}

/* ---------- saves ---------- */

export async function isSaved(userId: string, trialId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(trialId)) return false;
  const sql = getSql();
  const rows = (await sql`
    select 1 from trial_saves
     where user_id = ${userId} and trial_id = ${trialId}`) as unknown[];
  return rows.length > 0;
}

/** Save is idempotent; only public trials that aren't your own can be saved. */
export async function saveTrial(userId: string, trialId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(trialId)) return;
  const sql = getSql();
  await sql`
    insert into trial_saves (user_id, trial_id)
    select ${userId}, ${trialId}::uuid
     where exists (
       select 1 from trials
        where id = ${trialId}::uuid and visibility = 'public' and user_id <> ${userId}
     )
    on conflict do nothing`;
}

export async function unsaveTrial(userId: string, trialId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(trialId)) return;
  const sql = getSql();
  await sql`delete from trial_saves where user_id = ${userId} and trial_id = ${trialId}`;
}

/**
 * The trials this user bookmarked, in the order saved. Ones since made private
 * drop out here — unpublishing takes a trial back from everyone, saves
 * included.
 */
export async function listSavedTrials(userId: string): Promise<PublicTrial[]> {
  const rows = await storedPublicTrials(
    `t.visibility = 'public'
       and t.id in (select trial_id from trial_saves where user_id = $1)`,
    [userId],
  );
  return rows;
}

/* ---------- products ---------- */

export interface CommunityProduct {
  /** Stable page key: the cache's product_key when one exists, else a slug. */
  key: string;
  brand: string | null;
  name: string;
  dosages: string[];
  /** Union of the targets the community's trials gave it, most common first. */
  targets: string[];
  /** Distinct owners who have trialled it. */
  users: number;
  /** How many trials use this product. Always `trials.length` for a
   *  community (public-only) rollup; for `listTrendingProducts()` this counts
   *  distinct trials *and* routines instead (private ones included), so it
   *  can exceed `trials.length` (which stays public-only trial count — see
   *  that function's doc comment for why). */
  trialCount: number;
  trials: PublicTrial[];
  /** Joined from `catalog_products.image_url` via an intervention's
   *  `catalogProductId`, when any contributing trial picked it from the
   *  catalog. Null for products only ever added by typed name, barcode, or
   *  ingredient photo. */
  image: string | null;
  /** The catalog row this product resolves to, when any contributing trial
   *  picked it from the catalog picker. This is what makes `/products/[key]`
   *  able to show catalog identity (description, ingredient panel) alongside
   *  community trial history for the same product — see app/products/[key]/page.tsx.
   *  Null for products only ever added by typed name, barcode, or ingredient
   *  photo, which have no catalog row to point at. */
  catalogProductId: string | null;
}

function productSlug(brand: string | null, name: string): string {
  return [brand, name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Shared by `listCommunityProducts()` and `listTrendingProducts()` — the same
 * roll-up over whichever slice of public trials the caller passes in, sorted
 * most-trialled first.
 */
function aggregateProducts(entries: PublicTrial[]): CommunityProduct[] {
  const byKey = new Map<string, CommunityProduct & { owners: Set<string>; targetCounts: Map<string, number> }>();

  for (const entry of entries) {
    for (const item of entry.trial.routine.interventions) {
      const key = productSlug(item.brand ?? null, item.name);
      if (!key) continue;
      let product = byKey.get(key);
      if (!product) {
        product = {
          key,
          brand: item.brand ?? null,
          name: item.name,
          dosages: [],
          targets: [],
          users: 0,
          trialCount: 0,
          trials: [],
          image: null,
          catalogProductId: null,
          owners: new Set(),
          targetCounts: new Map(),
        };
        byKey.set(key, product);
      }
      product.trials.push(entry);
      product.owners.add(entry.handle ?? entry.trial.id);
      if (item.dosage && !product.dosages.includes(item.dosage)) product.dosages.push(item.dosage);
      if (!product.image && item.image) product.image = item.image;
      if (!product.catalogProductId && item.catalogProductId) product.catalogProductId = item.catalogProductId;
      for (const target of item.targets) {
        product.targetCounts.set(target, (product.targetCounts.get(target) ?? 0) + 1);
      }
    }
  }

  return [...byKey.values()]
    .map(({ owners, targetCounts, ...product }) => ({
      ...product,
      users: owners.size,
      trialCount: product.trials.length,
      targets: [...targetCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
    }))
    .sort((a, b) => b.trials.length - a.trials.length || a.name.localeCompare(b.name));
}

/**
 * Backfills `image` (display only — never `catalogProductId`, which drives
 * attribution and the canonical-URL redirect) for products whose contributing
 * trials picked them by typed name, barcode, or ingredient photo before this
 * exact brand+name existed in the catalog, or without going through the
 * catalog picker at all. A name+brand match here is cosmetic: it fixes a
 * product card showing the generic package icon when a real product photo is
 * one exact-name lookup away, and never touches `targets[]` or attribution.
 */
async function fillMissingImages(products: CommunityProduct[]): Promise<CommunityProduct[]> {
  const missing = products.filter((p) => !p.image);
  if (missing.length === 0) return products;

  const sql = getSql();
  const brands = missing.map((p) => p.brand ?? '');
  const names = missing.map((p) => p.name);
  const rows = (await sql.query(
    `select t.b as brand, t.n as name, cp.image_url as image
       from unnest($1::text[], $2::text[]) as t(b, n)
       join catalog_products cp
         on lower(coalesce(cp.brand_name, '')) = lower(t.b)
        and lower(cp.name) = lower(t.n)
      where cp.image_url is not null`,
    [brands, names],
  )) as { brand: string; name: string; image: string }[];
  if (rows.length === 0) return products;

  const byKey = new Map(rows.map((r) => [`${r.brand.toLowerCase()}|${r.name.toLowerCase()}`, r.image]));
  for (const p of missing) {
    const image = byKey.get(`${(p.brand ?? '').toLowerCase()}|${p.name.toLowerCase()}`);
    if (image) p.image = image;
  }
  return products;
}

/**
 * The product database, derived entirely from published trials — a product
 * exists here because someone actually trialled it, and the "rating" is the
 * trials themselves rather than stars. Aggregation stops at listing: averaging
 * outcomes across different faces is the easiest place to fabricate confidence
 * (docs/app-ui.md §8), so the page shows the trials and lets them speak.
 */
export async function listCommunityProducts(): Promise<CommunityProduct[]> {
  return fillMissingImages(aggregateProducts(await listPublicTrials()));
}

/**
 * Catalog ids used by any public trial *or* public routine — broader than
 * `listCommunityProducts()` on purpose. That function stays trial-only
 * because "Trials that use this" on the product page is specifically a
 * trial history; this one backs the "Trialled by community" toggle on
 * /search, which the user wants to reflect real product usage (routines)
 * as well as measured trials, since routine-only products would otherwise
 * never surface it — most public activity here is routines, not trials.
 */
export async function listCommunityProductIds(): Promise<string[]> {
  const [trials, routines] = await Promise.all([listPublicTrials(), listPublicRoutines()]);
  const ids = new Set<string>();
  for (const entry of trials) {
    for (const item of entry.trial.routine.interventions) {
      if (item.catalogProductId) ids.add(item.catalogProductId);
    }
  }
  for (const entry of routines) {
    for (const item of entry.routine.items) {
      if (item.catalogProductId) ids.add(item.catalogProductId);
    }
  }
  return [...ids];
}

export async function getCommunityProduct(key: string): Promise<CommunityProduct | null> {
  const products = await listCommunityProducts();
  return products.find((p) => p.key === key) ?? null;
}

/** Community trial history for a catalog product, looked up by the catalog's
 *  own id rather than the slug key — how `/products/[key]` attaches trial
 *  history onto a catalog-identified product page. Null just means nobody has
 *  trialled it yet, not an error. */
export async function getCommunityProductByCatalogId(
  catalogProductId: string,
): Promise<CommunityProduct | null> {
  const products = await listCommunityProducts();
  return products.find((p) => p.catalogProductId === catalogProductId) ?? null;
}

/**
 * Total distinct users tracking this product, across every trial and routine
 * regardless of visibility — unlike `CommunityProduct.users`, which only
 * counts owners of *public* trials. A private trial correctly stays off "Trials
 * that use this" (the trial itself would out someone), but a bare count reveals
 * nothing about who or what, so it's safe to include private rows here. Catalog
 * id match when the product page resolved one, brand+name otherwise — same
 * fallback `routineHasProduct()` and `aggregateProducts()` use.
 */
export async function countProductUsers(product: {
  catalogProductId: string | null;
  brand: string | null;
  name: string;
}): Promise<number> {
  const name = product.name.trim();
  const brand = (product.brand ?? '').trim();

  let dbUsers = 0;
  try {
    const sql = getSql();
    const rows = (await sql.query(
      `select count(distinct user_id) as n from (
         select t.user_id from trial_interventions v
           join trials t on t.id = v.trial_id
          where ($1::uuid is not null and v.catalog_product_id = $1::uuid)
             or (lower(coalesce(v.brand, '')) = lower($2) and lower(v.name) = lower($3))
         union
         select r.user_id from routine_items i
           join routines r on r.id = i.routine_id
          where ($1::uuid is not null and i.catalog_product_id = $1::uuid)
             or (lower(coalesce(i.brand, '')) = lower($2) and lower(i.name) = lower($3))
       ) matched`,
      [product.catalogProductId, brand, name],
    )) as { n: string }[];
    dbUsers = Number(rows[0]?.n ?? 0);
  } catch {
    dbUsers = 0;
  }

  const fixtureUser = fixturePublicTrials().some((entry) =>
    entry.trial.routine.interventions.some(
      (item) =>
        item.name.trim().toLowerCase() === name.toLowerCase() &&
        (item.brand ?? '').trim().toLowerCase() === brand.toLowerCase(),
    ),
  )
    ? 1
    : 0;

  return dbUsers + fixtureUser;
}

/**
 * Batched, catalog-id-only sibling of `countProductUsers()` — one round trip
 * for a whole page of `/search` or `/` catalog cards instead of one query per
 * card. Unlike `countProductUsers()` this never falls back to brand+name
 * matching, since every caller here already has a catalog id in hand; ids
 * with no matching trial or routine are simply absent from the returned map
 * (read `.get(id) ?? 0`).
 */
export async function countProductUsersByCatalogId(catalogProductIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(catalogProductIds)];
  if (ids.length === 0) return new Map();

  try {
    const sql = getSql();
    const rows = (await sql.query(
      `select id::text as id, count(distinct user_id) as n from (
         select v.catalog_product_id as id, t.user_id from trial_interventions v
           join trials t on t.id = v.trial_id
          where v.catalog_product_id = any($1::uuid[])
         union
         select i.catalog_product_id as id, r.user_id from routine_items i
           join routines r on r.id = i.routine_id
          where i.catalog_product_id = any($1::uuid[])
       ) matched
       group by id`,
      [ids],
    )) as { id: string; n: string }[];
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  } catch {
    return new Map();
  }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Row shape for the trending aggregation: just enough to roll a product up
 * and count trials/routines/owners, deliberately missing everything that
 * would identify a private trial or routine (name, dates, captures,
 * visibility). This is what keeps `listTrendingProducts()` safe to include
 * private trials and routines in — nothing that isn't already public
 * product/catalog data leaves this function. `sourceId` is a trial id from
 * one branch of the union query or a routine id from the other; the two id
 * spaces never collide (both are uuids from separate tables) so they can
 * share one "distinct sources" count.
 */
interface TrendingIntervention {
  sourceId: string;
  userId: string;
  brand: string | null;
  name: string;
  dosage: string | null;
  targets: string[];
  catalogProductId: string | null;
  image: string | null;
}

/**
 * The homepage's "Trending" rail: products in real use in the last 7 days —
 * a trial with a capture or check-in logged, or a routine edited — ranked by
 * how many such trials and routines used them, across **every** trial and
 * routine regardless of visibility. "Used" means evidence of actual use, not
 * merely a trial or routine that happens to still exist; one nobody has
 * touched in a month doesn't make its products trending just by existing.
 * (Routines have no daily check-in log the way trials do, so `updated_at` —
 * last edited — is the closest available proxy for "still in use.")
 *
 * A private trial's or routine's product can surface here — that's the
 * point, trending should reflect real usage rather than just what's been
 * published — but the trial or routine itself must stay unrevealed. So this
 * bypasses `listPublicTrials()`/`listPublicRoutines()` entirely and pulls
 * only brand/name/targets/image straight out of `trial_interventions` and
 * `routine_items`, never a trial's or routine's name, dates, captures or
 * visibility. The returned `CommunityProduct.trials` is always `[]` here;
 * `trialCount` (which can include private trials and routines) is the number
 * this rail actually displays, and every card links to the product page,
 * never a trial or routine.
 */
export async function listTrendingProducts(limit: number): Promise<CommunityProduct[]> {
  const since = new Date(Date.now() - WEEK_MS);

  let rows: TrendingIntervention[];
  try {
    const sql = getSql();
    const result = (await sql`
      select v.trial_id as source_id, t.user_id, v.brand, v.name, v.dosage,
             v.targets::text[] as targets, v.catalog_product_id, cp.image_url as image
        from trial_interventions v
        join trials t on t.id = v.trial_id
        left join catalog_products cp on cp.id = v.catalog_product_id
       where v.trial_id in (
         select trial_id from trial_captures where captured_at >= ${since}
         union
         select trial_id from trial_applications where applied_at >= ${since}
       )
       union all
      select i.routine_id as source_id, r.user_id, i.brand, i.name, null as dosage,
             i.targets::text[] as targets, i.catalog_product_id, cp.image_url as image
        from routine_items i
        join routines r on r.id = i.routine_id
        left join catalog_products cp on cp.id = i.catalog_product_id
       where r.updated_at >= ${since}`) as Record<string, unknown>[];
    rows = result.map((r) => ({
      sourceId: r.source_id as string,
      userId: r.user_id as string,
      brand: (r.brand as string | null) ?? null,
      name: r.name as string,
      dosage: (r.dosage as string | null) ?? null,
      targets: (r.targets as string[]) ?? [],
      catalogProductId: (r.catalog_product_id as string | null) ?? null,
      image: (r.image as string | null) ?? null,
    }));
  } catch {
    return [];
  }

  const byKey = new Map<
    string,
    Omit<CommunityProduct, 'targets' | 'trialCount' | 'users'> & {
      sourceIds: Set<string>;
      owners: Set<string>;
      targetCounts: Map<string, number>;
    }
  >();

  for (const row of rows) {
    const key = productSlug(row.brand, row.name);
    if (!key) continue;
    let product = byKey.get(key);
    if (!product) {
      product = {
        key,
        brand: row.brand,
        name: row.name,
        dosages: [],
        trials: [],
        image: null,
        catalogProductId: null,
        sourceIds: new Set(),
        owners: new Set(),
        targetCounts: new Map(),
      };
      byKey.set(key, product);
    }
    product.sourceIds.add(row.sourceId);
    product.owners.add(row.userId);
    if (row.dosage && !product.dosages.includes(row.dosage)) product.dosages.push(row.dosage);
    if (!product.image && row.image) product.image = row.image;
    if (!product.catalogProductId && row.catalogProductId) product.catalogProductId = row.catalogProductId;
    for (const target of row.targets) {
      product.targetCounts.set(target, (product.targetCounts.get(target) ?? 0) + 1);
    }
  }

  const products = [...byKey.values()]
    .map(({ sourceIds, owners, targetCounts, ...product }) => ({
      ...product,
      users: owners.size,
      trialCount: sourceIds.size,
      targets: [...targetCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
    }))
    .sort((a, b) => b.trialCount - a.trialCount || a.name.localeCompare(b.name));

  const filled = await fillMissingImages(products);
  return filled.slice(0, limit);
}

/* ---------- people ---------- */

export interface CommunityUser {
  handle: string;
  skinType: string | null;
  publicTrials: number;
}

/** People, meaning handles with at least one published trial. Profiles are
 *  otherwise private (ideas.md, privacy) and never listed. */
export async function listCommunityUsers(): Promise<CommunityUser[]> {
  try {
    const sql = getSql();
    const rows = (await sql`
      select p.username, p.skin_type, count(t.id)::int as trials
        from profiles p
        join trials t on t.user_id = p.user_id and t.visibility = 'public'
       group by p.username, p.skin_type
       order by trials desc, p.username asc`) as Record<string, unknown>[];
    return rows.map((r) => ({
      handle: r.username as string,
      skinType: (r.skin_type as string | null) ?? null,
      publicTrials: r.trials as number,
    }));
  } catch {
    return [];
  }
}
