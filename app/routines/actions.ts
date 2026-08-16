'use server';

import { revalidatePath } from 'next/cache';

import {
  createRoutine,
  deleteRoutine,
  updateRoutine,
  type RoutineItemInput,
  type RoutineVisibility,
} from '@/lib/routines';
import { currentUserId } from '@/lib/auth';
import { causeMessage, failed, type ActionResult } from '@/lib/action-result';
import { searchCatalogForPicker as searchCatalog, type CatalogPickerMatch } from '@/lib/catalog';
import { syncMyProductsFromItems } from '@/lib/my-products';

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

/** Postgres unique-violation, i.e. a routine of this name already exists. */
const UNIQUE_VIOLATION = '23505';

/**
 * Every action here resolves the caller itself rather than trusting the page
 * that rendered the form. The proxy redirects a signed-out *navigation*; an
 * action is reachable directly, so it is its own last line of defence.
 */
export async function saveRoutine(input: SaveRoutineInput): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId();
  if (!userId) return failed('Log in to save a routine.');

  const name = input.name?.trim();
  if (!name) return failed('Give the routine a name.');

  const items = (input.items ?? []).filter((i) => i.name?.trim());
  if (items.length === 0) return failed('Add at least one product.');

  try {
    let id = input.id;
    if (id) {
      const updated = await updateRoutine(userId, id, name, items, input.description, input.visibility);
      if (!updated) return failed('That routine no longer exists.');
    } else {
      id = await createRoutine(userId, name, items, input.description, input.visibility);
    }

    revalidatePath('/');
    revalidatePath('/dashboard');
    revalidatePath('/routines');

    try {
      await syncMyProductsFromItems(
        userId,
        items.map((i) => ({ catalogProductId: i.catalogProductId, brand: i.brand, name: i.name })),
      );
    } catch {
      // Sync is best-effort; the routine itself has already been saved.
    }

    return { ok: true, data: { id } };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === UNIQUE_VIOLATION) {
      return failed(`You already have a routine called "${name}".`);
    }
    // `validateConcerns` throws on an unrecognised key, and so does the
    // `analysis_concern` enum behind it. Surfacing the message is right: it
    // names the bad key, and a silent drop is the failure mode rule 5 exists
    // to prevent.
    return failed(causeMessage(error));
  }
}

export async function removeRoutine(id: string): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return failed('Log in to delete a routine.');

  try {
    await deleteRoutine(userId, id);
    revalidatePath('/');
    revalidatePath('/dashboard');
    revalidatePath('/routines');
    return { ok: true };
  } catch (error) {
    return failed(causeMessage(error));
  }
}
