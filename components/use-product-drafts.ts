'use client';

import { useState } from 'react';

import { blankProductDraft, type ProductDraft } from '@/components/product-draft-card';
import type { CatalogPickerMatch } from '@/lib/catalog';

/**
 * The list of product rows behind `ProductDraftCard`, and the two things both
 * editors do to it: patch one row, and fill one from a catalog pick.
 *
 * `RoutineEditor` and `TrialEditorStepper` are required to behave identically
 * here (see `ProductDraftCard`'s note) — same catalog fill. They had a copy
 * each of both; keeping one is what makes "identically" true rather than
 * aspirational.
 */
export function useProductDrafts(initial: () => ProductDraft[]) {
  const [items, setItems] = useState<ProductDraft[]>(initial);

  const patch = (key: string, change: Partial<ProductDraft>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...change } : i)));

  /** A pick from the card's own inline search fills brand, name, image and
   *  the catalog's real INCI list — no AI call. */
  function applyCatalogMatch(item: ProductDraft, match: CatalogPickerMatch) {
    patch(item.key, {
      brand: match.brand ?? '',
      name: match.name,
      inci: match.inci,
      image: match.image,
      catalogProductId: match.id,
    });
  }

  return { items, setItems, patch, applyCatalogMatch };
}

