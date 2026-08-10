'use server';

import { searchCatalogForPicker, searchCatalogBrands, searchCatalogIngredients, type CatalogPickerMatch } from '@/lib/catalog';

/** Feeds the homepage hero search's debounced dropdown — top catalog product
 *  matches only. Trials and routines are only searched on the full /search
 *  page; the dropdown is a shortcut straight to a product page. */
export async function searchHeroProducts(q: string): Promise<CatalogPickerMatch[]> {
  return searchCatalogForPicker(q, 6);
}

/** Thin RPC wrappers so the client-side comboboxes on /search never touch
 *  lib/catalog.ts (server-only) directly. */

export async function searchBrandsAction(q: string) {
  return searchCatalogBrands(q);
}

export async function searchIngredientsAction(q: string) {
  return searchCatalogIngredients(q);
}
