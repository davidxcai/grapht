'use server';

import { revalidatePath } from 'next/cache';

import {
  createRoutine,
  deleteRoutine,
  updateRoutine,
  type RoutineItemInput,
  type RoutineVisibility,
} from '@/lib/routines';
import { classifyProduct, productIdentity } from '@/lib/product-classifier';
import { currentUserId } from '@/lib/auth';
import { degraded } from '@/lib/log';
import { searchCatalogForPicker as searchCatalog, type CatalogPickerMatch } from '@/lib/catalog';

/** Top name/brand matches for the routine editor's product-name autocomplete
 *  — same query as app/trials/actions.ts's wrapper, kept separate because
 *  each editor is served by its own 'use server' action module. */
export async function searchCatalogForPicker(q: string): Promise<CatalogPickerMatch[]> {
  return searchCatalog(q);
}

export interface SaveRoutineInput {
  id?: string;
  name: string;
  description?: string | null;
  visibility?: RoutineVisibility;
  items: RoutineItemInput[];
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/** Postgres unique-violation, i.e. a routine of this name already exists. */
const UNIQUE_VIOLATION = '23505';

/**
 * Every action here resolves the caller itself rather than trusting the page
 * that rendered the form. The proxy redirects a signed-out *navigation*; an
 * action is reachable directly, so it is its own last line of defence.
 */
export async function saveRoutine(input: SaveRoutineInput): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to save a routine.' };

  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'Give the routine a name.' };

  const items = (input.items ?? []).filter((i) => i.name?.trim());
  if (items.length === 0) return { ok: false, error: 'Add at least one product.' };

  try {
    let id = input.id;
    if (id) {
      const updated = await updateRoutine(userId, id, name, items, input.description, input.visibility);
      if (!updated) return { ok: false, error: 'That routine no longer exists.' };
    } else {
      id = await createRoutine(userId, name, items, input.description, input.visibility);
    }

    revalidatePath('/');
    revalidatePath('/dashboard');
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
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to delete a routine.' };

  try {
    await deleteRoutine(userId, id);
    revalidatePath('/');
    revalidatePath('/dashboard');
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
  /** From a /catalog match (app/trials/actions.ts's searchCatalogForPicker) —
   *  the real ingredient list is strictly stronger evidence for targets[]
   *  than a typed name alone (docs/product-identity.md). */
  inci?: string[] | null;
}): Promise<ActionResult<Suggestion>> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'Enter a product name first.' };
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, error: 'No GEMINI_API_KEY set — pick the concerns yourself.' };
  }

  const brand = input.brand?.trim() || null;
  const inci = input.inci?.length ? input.inci : null;

  try {
    const result = await classifyProduct({ brand, name, inci });
    // A null key costs this suggestion its cache entry and nothing else, so it
    // must not cost the suggestion itself — but `productIdentity()` throwing on
    // a product the classifier just accepted is a bug, not a condition, and
    // said nothing when it happened.
    let key: string | null = null;
    try {
      key = productIdentity({ brand, name, inci }).key;
    } catch (error) {
      degraded('suggestConcerns productIdentity', error, `${brand ?? ''} ${name}`.trim());
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
