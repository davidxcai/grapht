'use server';

import { revalidatePath } from 'next/cache';

import {
  createRoutine,
  deleteRoutine,
  updateRoutine,
  type RoutineItemInput,
} from '@/lib/routines';
import { classifyProduct, productIdentity } from '@/lib/product-classifier';

export interface SaveRoutineInput {
  id?: string;
  name: string;
  items: RoutineItemInput[];
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/** Postgres unique-violation, i.e. a routine of this name already exists. */
const UNIQUE_VIOLATION = '23505';

export async function saveRoutine(input: SaveRoutineInput): Promise<ActionResult<{ id: string }>> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'Give the routine a name.' };

  const items = (input.items ?? []).filter((i) => i.name?.trim());
  if (items.length === 0) return { ok: false, error: 'Add at least one product.' };

  try {
    let id = input.id;
    if (id) await updateRoutine(id, name, items);
    else id = await createRoutine(name, items);

    revalidatePath('/');
    revalidatePath('/routines');
    return { ok: true, data: { id } };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === UNIQUE_VIOLATION) {
      return { ok: false, error: `You already have a routine called "${name}".` };
    }
    // `validateConcerns` throws on an unrecognised key, and so does the
    // `analysis_concern` enum behind it. Surfacing the message is right: it
    // names the bad key, and a silent drop is the failure mode rule 5 exists
    // to prevent.
    return { ok: false, error: (error as Error).message };
  }
}

export async function removeRoutine(id: string): Promise<ActionResult> {
  try {
    await deleteRoutine(id);
    revalidatePath('/');
    revalidatePath('/routines');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export interface Suggestion {
  targets: string[];
  suggestions: string[];
  ranked: { concern: string; confidence: string | null; because: string | null }[];
  classifier: { model: string; promptVersion: string };
  productKey: string | null;
  /** A time-bound claim off the label — "visible results in 4 weeks". Offered as
   *  a duration on the new-trial screen, where taking it sets
   *  `endDateSource: 'product-claim'`. Ignored by the routine editor, which has
   *  no window. */
  durationClaimDays: number | null;
}

/**
 * Ask the classifier what a product targets, from its name alone.
 *
 * Name-only is the weakest of the four input paths in docs/product-identity.md
 * — no INCI list, so the identity is a low-confidence `name:` key and the
 * targets are derived from what the model knows of the product rather than from
 * ingredients. That is acceptable *here* and would not be on an intervention:
 * a routine is baseline material, so its targets decide whether a metric reads
 * as `confounded` rather than which product gets credit.
 *
 * Pre-ticking stays capped at three high-confidence concerns by
 * `parseClassification`; everything else comes back as a suggestion the user
 * can add. Broad baselines are the safer error, but an unbounded one would
 * confound every metric and make the distinction useless.
 */
export async function suggestConcerns(input: {
  brand?: string | null;
  name: string;
}): Promise<ActionResult<Suggestion>> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'Enter a product name first.' };
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, error: 'No GEMINI_API_KEY set — pick the concerns yourself.' };
  }

  const brand = input.brand?.trim() || null;

  try {
    const result = await classifyProduct({ brand, name });
    let key: string | null = null;
    try {
      key = productIdentity({ brand, name }).key;
    } catch {
      key = null;
    }

    return {
      ok: true,
      data: {
        targets: result.targets,
        suggestions: result.suggestions,
        ranked: result.ranked,
        classifier: result.classifier,
        productKey: key,
        durationClaimDays: result.durationClaimDays ?? null,
      },
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
