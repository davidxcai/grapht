'use server';

import { searchCatalogBrands, searchCatalogIngredients } from '@/lib/catalog';

/** Thin RPC wrappers so the client-side comboboxes on /catalog never touch
 *  lib/catalog.ts (server-only) directly. */

export async function searchBrandsAction(q: string) {
  return searchCatalogBrands(q);
}

export async function searchIngredientsAction(q: string) {
  return searchCatalogIngredients(q);
}
