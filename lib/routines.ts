import 'server-only';
import { randomUUID } from 'node:crypto';

import { getSql } from '@/lib/db';
import { orderConcerns, validateConcerns } from '@/lib/concerns';

/**
 * A saved routine: a named, ordered set of products the user already uses.
 *
 * A routine is *baseline* material — `routine.baseline[]` in the trial model,
 * acknowledged but never attributed (docs/trial-model.md). Its concern coverage
 * is not a claim that these products work. It is the set of metrics that, if
 * they move during a trial, have a background explanation the app must name
 * instead of crediting the tracked intervention.
 */

export type Provenance = 'user-edited' | 'user-confirmed' | 'llm-derived';

export interface RankedConcern {
  concern: string;
  confidence: 'high' | 'medium' | 'low' | null;
  because: string | null;
}

export interface RoutineItem {
  id: string;
  position: number;
  brand: string | null;
  name: string;
  targets: string[];
  /** The classifier's full ordered suggestion list, kept so the editor can
   *  offer the un-ticked ones without paying for the call twice. */
  ranked: RankedConcern[];
  provenance: Provenance;
  classifier: { model: string; promptVersion: string } | null;
  productKey: string | null;
  /** FK into `catalog_products`, set only when this item came from a catalog
   *  pick. Read-only enrichment — never a source for `targets[]`, which stay
   *  the frozen identity the item was added under. */
  catalogProductId: string | null;
  /** Joined live from `catalog_products.image_url` via `catalogProductId`,
   *  never stored — a catalog image can change or disappear, so every read
   *  gets whatever it currently points at instead of a stale copy. Null for
   *  an item with no catalog match. */
  image: string | null;
}

/** Whether a routine can be viewed at `/routines/[id]` by anyone with the
 *  link. Private is the default, same shape as `TrialVisibility`
 *  (lib/trials.ts) — a routine is never published by omission. */
export type RoutineVisibility = 'private' | 'public';

export interface Routine {
  id: string;
  name: string;
  position: number;
  /** The user's own words on what the routine is for, shown on the public
   *  routine page. Optional. */
  description: string | null;
  visibility: RoutineVisibility;
  items: RoutineItem[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Every function here takes the owner as its first argument rather than reading
 * it from the request. This is the data access layer, and it is where ownership
 * is actually enforced — the proxy only redirects. Passing it explicitly means a
 * query that forgot to scope cannot compile, which is the guarantee worth having
 * when the rows are someone's face measurements.
 */
export interface RoutineItemInput {
  brand?: string | null;
  name: string;
  targets: string[];
  ranked?: RankedConcern[];
  provenance?: Provenance;
  classifier?: { model: string; promptVersion: string } | null;
  productKey?: string | null;
  catalogProductId?: string | null;
}

/* ---------- reads ---------- */

/**
 * Columns for a routine item, with `targets` cast to `text[]`.
 *
 * The cast is load-bearing, not cosmetic. The Neon driver only parses arrays of
 * built-in types, so an `analysis_concern[]` comes back as the raw Postgres
 * literal `"{acne,texture}"` — a *string*. Nothing throws: `routineCoverage()`
 * would iterate it as characters, match no concern, and render "Covers:
 * nothing" for a fully-tagged routine. Casting to `text[]` returns a real
 * array, empty arrays included.
 */
const ITEM_COLUMNS = `i.id, i.routine_id, i.position, i.brand, i.name,
   i.targets::text[] as targets, i.ranked, i.provenance, i.classifier,
   i.product_key, i.catalog_product_id, cp.image_url as image, i.created_at`;

/** Every read of `routine_items` joins this in for `ITEM_COLUMNS`' `cp.image_url`
 *  — left, not inner, since most items (typed name, barcode, ingredient photo)
 *  have no catalog row at all. */
const CATALOG_JOIN = `left join catalog_products cp on cp.id = i.catalog_product_id`;

function toItem(row: Record<string, unknown>): RoutineItem {
  return {
    id: row.id as string,
    position: row.position as number,
    brand: (row.brand as string | null) ?? null,
    name: row.name as string,
    targets: (row.targets as string[]) ?? [],
    ranked: (row.ranked as RankedConcern[]) ?? [],
    provenance: row.provenance as Provenance,
    classifier: (row.classifier as RoutineItem['classifier']) ?? null,
    productKey: (row.product_key as string | null) ?? null,
    catalogProductId: (row.catalog_product_id as string | null) ?? null,
    image: (row.image as string | null) ?? null,
  };
}

function toRoutine(row: Record<string, unknown>, items: RoutineItem[]): Routine {
  return {
    id: row.id as string,
    name: row.name as string,
    position: row.position as number,
    description: (row.description as string | null) ?? null,
    visibility: (row.visibility as RoutineVisibility) ?? 'private',
    items,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listRoutines(userId: string): Promise<Routine[]> {
  const sql = getSql();
  const [routineRows, itemRows] = await Promise.all([
    sql`select * from routines where user_id = ${userId}
        order by position asc, created_at asc`,
    sql.query(
      `select ${ITEM_COLUMNS} from routine_items i
       join routines r on r.id = i.routine_id
       ${CATALOG_JOIN}
       where r.user_id = $1
       order by i.position asc, i.created_at asc`,
      [userId],
    ),
  ]);

  const byRoutine = new Map<string, RoutineItem[]>();
  for (const row of itemRows as Record<string, unknown>[]) {
    const key = row.routine_id as string;
    const list = byRoutine.get(key) ?? [];
    list.push(toItem(row));
    byRoutine.set(key, list);
  }

  return (routineRows as Record<string, unknown>[]).map((r) =>
    toRoutine(r, byRoutine.get(r.id as string) ?? []),
  );
}

/** Null covers "no such routine" and "not yours" alike — the caller renders the
 *  same 404 for both, which is the only answer that leaks nothing. */
export async function getRoutine(userId: string, id: string): Promise<Routine | null> {
  const sql = getSql();
  const rows = await sql`select * from routines
                         where id = ${id} and user_id = ${userId}`;
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;

  const itemRows = await sql.query(
    `select ${ITEM_COLUMNS} from routine_items i
     ${CATALOG_JOIN}
     where i.routine_id = $1
     order by i.position asc, i.created_at asc`,
    [id],
  );

  return toRoutine(row, (itemRows as Record<string, unknown>[]).map(toItem));
}

/**
 * A published routine, for the read-only branch of `/routines/[id]`
 * (app/routines/[id]/page.tsx) — same split as `getPublicTrial()` in
 * lib/community.ts, minus comments/saves/views, which this feature doesn't
 * have. Null covers "no such routine" and "not public", identically, so a
 * private routine 404s rather than admitting it exists.
 */
export async function getPublicRoutine(
  id: string,
): Promise<{ routine: Routine; handle: string | null } | null> {
  const sql = getSql();
  const rows = await sql`
    select r.*, p.username as owner_handle
      from routines r
      left join profiles p on p.user_id = r.user_id
     where r.id = ${id} and r.visibility = 'public'`;
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;

  const itemRows = await sql.query(
    `select ${ITEM_COLUMNS} from routine_items i
     ${CATALOG_JOIN}
     where i.routine_id = $1
     order by i.position asc, i.created_at asc`,
    [id],
  );

  return {
    routine: toRoutine(row, (itemRows as Record<string, unknown>[]).map(toItem)),
    handle: (row.owner_handle as string | null) ?? null,
  };
}

/**
 * The subset of `routines` that carry this product — either by catalog id
 * (the reliable match, when the product page resolved one) or by brand+name
 * (the fallback for a product only ever added by typed name, barcode, or
 * ingredient photo, which has no catalog row to match on). Pure filter over
 * already-fetched routines, mirroring `aggregateProducts()`'s brand+name
 * comparison in lib/community.ts — routines have no public surface, so this
 * never reaches into the database itself.
 */
export function routinesWithProduct(
  routines: Routine[],
  product: { catalogProductId: string | null; brand: string | null; name: string },
): Routine[] {
  const name = product.name.trim().toLowerCase();
  const brand = (product.brand ?? '').trim().toLowerCase();
  return routines.filter((r) =>
    r.items.some((i) => {
      if (product.catalogProductId && i.catalogProductId === product.catalogProductId) return true;
      return i.name.trim().toLowerCase() === name && (i.brand ?? '').trim().toLowerCase() === brand;
    }),
  );
}

/* ---------- writes ---------- */

/**
 * Item rows for one routine, as a fresh set. Update replaces rather than diffs:
 * the list is short, ordered, and entirely user-authored, so a replace is both
 * simpler and immune to the ordering bugs a diff would invite. Item ids are not
 * referenced from anywhere else — a trial holds a *snapshot*, never a foreign
 * key (see `snapshotRoutine`) — so churning them costs nothing.
 */
function itemInserts(routineId: string, items: RoutineItemInput[]) {
  const sql = getSql();
  return items.map((item, position) => {
    const targets = validateConcerns(item.targets);
    const ranked = item.ranked ?? [];
    return sql`
      insert into routine_items
        (id, routine_id, position, brand, name, targets, ranked, provenance, classifier, product_key, catalog_product_id)
      values (
        ${randomUUID()}, ${routineId}, ${position},
        ${item.brand?.trim() || null}, ${item.name.trim()},
        ${targets}::analysis_concern[],
        ${JSON.stringify(ranked)}::jsonb,
        ${item.provenance ?? 'user-edited'}::target_provenance,
        ${item.classifier ? JSON.stringify(item.classifier) : null}::jsonb,
        ${item.productKey ?? null},
        ${item.catalogProductId ?? null}
      )`;
  });
}

export async function createRoutine(
  userId: string,
  name: string,
  items: RoutineItemInput[],
  description?: string | null,
  visibility?: RoutineVisibility,
): Promise<string> {
  const sql = getSql();
  const id = randomUUID();
  await sql.transaction([
    sql`insert into routines (id, user_id, name, description, visibility, position)
        values (${id}, ${userId}, ${name.trim()}, ${description ?? null},
                ${visibility ?? 'private'}::routine_visibility,
                coalesce((select max(position) + 1 from routines
                          where user_id = ${userId}), 0))`,
    ...itemInserts(id, items),
  ]);
  return id;
}

/**
 * Returns false when the update matched no routine — someone else's id, or
 * none. The item rows are keyed on `routine_id` and cannot carry the owner
 * themselves, so the ownership test has to be read back rather than assumed:
 * without the check, the delete-and-reinsert below would happily rewrite a
 * stranger's routine while the `update` above quietly changed nothing.
 */
export async function updateRoutine(
  userId: string,
  id: string,
  name: string,
  items: RoutineItemInput[],
  description?: string | null,
  visibility?: RoutineVisibility,
): Promise<boolean> {
  const sql = getSql();
  const owned = (await sql`select 1 from routines
                            where id = ${id} and user_id = ${userId}`) as unknown[];
  if (owned.length === 0) return false;

  await sql.transaction([
    sql`update routines
           set name = ${name.trim()},
               description = ${description ?? null},
               visibility = ${visibility ?? 'private'}::routine_visibility,
               updated_at = now()
        where id = ${id} and user_id = ${userId}`,
    sql`delete from routine_items where routine_id = ${id}`,
    ...itemInserts(id, items),
  ]);
  return true;
}

export async function deleteRoutine(userId: string, id: string): Promise<void> {
  const sql = getSql();
  await sql`delete from routines where id = ${id} and user_id = ${userId}`;
}

/* ---------- coverage and freezing ---------- */

/**
 * Every concern any product in this routine targets, in canonical order.
 *
 * A union, never a count or a weight. Two products targeting `acne` does not
 * make the routine twice as good at acne, and nothing here should imply it.
 */
export function routineCoverage(routine: Routine): string[] {
  return orderConcerns(routine.items.flatMap((i) => i.targets));
}

export interface RoutineSnapshot {
  routineId: string;
  routineName: string;
  items: { brand: string | null; name: string; targets: string[] }[];
  coverage: string[];
  frozenAt: string;
}

/**
 * Freeze a routine into a trial's `routine.baseline[]`.
 *
 * The whole reason this returns a copy rather than a routine id: editing
 * [Night] in October must not change what a trial started in August attributed
 * its results to. A live reference would let a routine edit retroactively move
 * a metric between the `confounded` and `unexplained` rows with no new
 * measurement — the same failure as extending an end date after seeing the
 * data (docs/trial-model.md). Same rule, and same shape, as `freezeTargets()`
 * in src/products.mjs.
 */
export function snapshotRoutine(routine: Routine): RoutineSnapshot {
  return Object.freeze({
    routineId: routine.id,
    routineName: routine.name,
    items: routine.items.map((i) =>
      Object.freeze({ brand: i.brand, name: i.name, targets: Object.freeze([...i.targets]) }),
    ),
    coverage: Object.freeze(routineCoverage(routine)),
    frozenAt: new Date().toISOString(),
  }) as RoutineSnapshot;
}
