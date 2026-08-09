'use server';

import { searchCatalogForPicker, type CatalogPickerMatch } from '@/lib/catalog';

/** Feeds the homepage hero search's debounced dropdown — top catalog product
 *  matches only. Trials and ingredients are only searched on the full
 *  /search page; the dropdown is a shortcut straight to a product page. */
export async function searchHeroProducts(q: string): Promise<CatalogPickerMatch[]> {
  return searchCatalogForPicker(q, 6);
}
