'use client';

import { useState } from 'react';

import { suggestConcerns, type Suggestion } from '@/app/routines/actions';
import { blankProductDraft, type ProductDraft } from '@/components/product-draft-card';
import type { CatalogPickerMatch } from '@/lib/catalog';
import { orderConcerns } from '@/lib/concerns';
import type { RankedConcern } from '@/lib/routines';

/**
 * The list of product rows behind `ProductDraftCard`, and the three things
 * both editors do to it: patch one row, fill one from a catalog pick, and ask
 * the classifier what it targets.
 *
 * `RoutineEditor` and `TrialEditorStepper` are required to behave identically
 * here (see `ProductDraftCard`'s note) — same catalog fill, and "Suggest"
 * manual-only, since it is a paid Gemini call that must never fire just
 * because a match was picked. They had a copy each of all three; keeping one
 * is what makes "identically" true rather than aspirational.
 */
export function useProductDrafts(
  initial: () => ProductDraft[],
  options: {
    /** Wording for "the classifier found nothing" — the routine editor asks
     *  what the product targets, the trial editor what to watch. */
    emptyNote: string;
    /** The trial editor turns a claimed duration ("results in 4 weeks") into
     *  its suggested trial length; a routine has no window to fill. */
    onDurationClaim?: (days: number) => void;
  },
) {
  const [items, setItems] = useState<ProductDraft[]>(initial);

  const patch = (key: string, change: Partial<ProductDraft>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...change } : i)));

  async function suggest(item: ProductDraft) {
    if (!item.name.trim()) {
      patch(item.key, { note: 'Enter a product name first.' });
      return;
    }
    patch(item.key, { busy: true, note: null });

    const result = await suggestConcerns({
      brand: item.brand,
      name: item.name,
      inci: item.inci,
    });

    if (!result.ok) {
      patch(item.key, { busy: false, note: result.error });
      return;
    }

    const data: Suggestion = result.data;
    if (data.durationClaimDays) options.onDurationClaim?.(data.durationClaimDays);

    patch(item.key, {
      busy: false,
      targets: orderConcerns(data.targets),
      suggested: orderConcerns(data.targets),
      ranked: data.ranked as RankedConcern[],
      classifier: data.classifier,
      productKey: data.productKey,
      note: data.targets.length === 0 ? options.emptyNote : null,
    });
  }

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

  return { items, setItems, patch, suggest, applyCatalogMatch };
}

