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
}

export interface Routine {
  id: string;
  name: string;
  position: number;
  items: RoutineItem[];
  createdAt: string;
  updatedAt: string;
}

/** No accounts yet (docs/app-ui.md §2 is designed, not built). */
const LOCAL_USER = 'local';

export interface RoutineItemInput {
  brand?: string | null;
  name: string;
  targets: string[];
  ranked?: RankedConcern[];
  provenance?: Provenance;
  classifier?: { model: string; promptVersion: string } | null;
  productKey?: string | null;
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
   i.product_key, i.created_at`;

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
  };
}

export async function listRoutines(): Promise<Routine[]> {
  const sql = getSql();
  const [routineRows, itemRows] = await Promise.all([
    sql`select * from routines where user_id = ${LOCAL_USER}
        order by position asc, created_at asc`,
    sql.query(
      `select ${ITEM_COLUMNS} from routine_items i
       join routines r on r.id = i.routine_id
       where r.user_id = $1
       order by i.position asc, i.created_at asc`,
      [LOCAL_USER],
    ),
  ]);

  const byRoutine = new Map<string, RoutineItem[]>();
  for (const row of itemRows as Record<string, unknown>[]) {
    const key = row.routine_id as string;
    const list = byRoutine.get(key) ?? [];
    list.push(toItem(row));
    byRoutine.set(key, list);
  }

  return (routineRows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    position: r.position as number,
    items: byRoutine.get(r.id as string) ?? [],
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export async function getRoutine(id: string): Promise<Routine | null> {
  const sql = getSql();
  const rows = await sql`select * from routines
                         where id = ${id} and user_id = ${LOCAL_USER}`;
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;

  const itemRows = await sql.query(
    `select ${ITEM_COLUMNS} from routine_items i
     where i.routine_id = $1
     order by i.position asc, i.created_at asc`,
    [id],
  );

  return {
    id: row.id as string,
    name: row.name as string,
    position: row.position as number,
    items: (itemRows as Record<string, unknown>[]).map(toItem),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
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
        (id, routine_id, position, brand, name, targets, ranked, provenance, classifier, product_key)
      values (
        ${randomUUID()}, ${routineId}, ${position},
        ${item.brand?.trim() || null}, ${item.name.trim()},
        ${targets}::analysis_concern[],
        ${JSON.stringify(ranked)}::jsonb,
        ${item.provenance ?? 'user-edited'}::target_provenance,
        ${item.classifier ? JSON.stringify(item.classifier) : null}::jsonb,
        ${item.productKey ?? null}
      )`;
  });
}

export async function createRoutine(name: string, items: RoutineItemInput[]): Promise<string> {
  const sql = getSql();
  const id = randomUUID();
  await sql.transaction([
    sql`insert into routines (id, user_id, name, position)
        values (${id}, ${LOCAL_USER}, ${name.trim()},
                coalesce((select max(position) + 1 from routines
                          where user_id = ${LOCAL_USER}), 0))`,
    ...itemInserts(id, items),
  ]);
  return id;
}

export async function updateRoutine(
  id: string,
  name: string,
  items: RoutineItemInput[],
): Promise<void> {
  const sql = getSql();
  await sql.transaction([
    sql`update routines set name = ${name.trim()}, updated_at = now()
        where id = ${id} and user_id = ${LOCAL_USER}`,
    sql`delete from routine_items where routine_id = ${id}`,
    ...itemInserts(id, items),
  ]);
}

export async function deleteRoutine(id: string): Promise<void> {
  const sql = getSql();
  await sql`delete from routines where id = ${id} and user_id = ${LOCAL_USER}`;
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
