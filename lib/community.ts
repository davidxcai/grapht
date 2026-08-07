import 'server-only';

import { getSql } from '@/lib/db';
import { assembleTrials, getFixtureTrials } from '@/lib/trial-store';
import type { Trial } from '@/lib/trials';

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
  /** True for the committed reference series. */
  sample: boolean;
}

/** The reference series, shaped like any other public trial. */
function fixturePublicTrials(): PublicTrial[] {
  return getFixtureTrials()
    .filter((t) => t.visibility === 'public')
    .map((trial) => ({ trial, handle: 'grapht', skinType: null, sample: true }));
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
        `select v.id, v.trial_id, v.position, v.direction, v.brand, v.name,
                v.started_on, v.targets::text[] as targets, v.ranked, v.provenance,
                v.classifier, v.product_key, v.dosage
           from trial_interventions v
           join trials t on t.id = v.trial_id
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
        handle: (t.owner_handle as string | null) ?? null,
        skinType: (t.owner_skin_type as string | null) ?? null,
      },
    ]),
  );

  return trials.map((trial) => ({
    trial,
    handle: meta.get(trial.id)?.handle ?? null,
    skinType: meta.get(trial.id)?.skinType ?? null,
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
  return rows.map((r) => ({
    id: r.id as string,
    handle: (r.username as string | null) ?? null,
    body: r.body as string,
    createdAt: new Date(r.created_at as string).toISOString(),
    mine: viewerId !== null && r.user_id === viewerId,
  }));
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
  trials: PublicTrial[];
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
 * The product database, derived entirely from published trials — a product
 * exists here because someone actually trialled it, and the "rating" is the
 * trials themselves rather than stars. Aggregation stops at listing: averaging
 * outcomes across different faces is the easiest place to fabricate confidence
 * (docs/app-ui.md §8), so the page shows the trials and lets them speak.
 */
export async function listCommunityProducts(): Promise<CommunityProduct[]> {
  const publicTrials = await listPublicTrials();
  const byKey = new Map<string, CommunityProduct & { owners: Set<string>; targetCounts: Map<string, number> }>();

  for (const entry of publicTrials) {
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
          trials: [],
          owners: new Set(),
          targetCounts: new Map(),
        };
        byKey.set(key, product);
      }
      product.trials.push(entry);
      product.owners.add(entry.handle ?? entry.trial.id);
      if (item.dosage && !product.dosages.includes(item.dosage)) product.dosages.push(item.dosage);
      for (const target of item.targets) {
        product.targetCounts.set(target, (product.targetCounts.get(target) ?? 0) + 1);
      }
    }
  }

  return [...byKey.values()]
    .map(({ owners, targetCounts, ...product }) => ({
      ...product,
      users: owners.size,
      targets: [...targetCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
    }))
    .sort((a, b) => b.trials.length - a.trials.length || a.name.localeCompare(b.name));
}

export async function getCommunityProduct(key: string): Promise<CommunityProduct | null> {
  const products = await listCommunityProducts();
  return products.find((p) => p.key === key) ?? null;
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
