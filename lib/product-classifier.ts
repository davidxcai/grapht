import { classify as classifyRaw } from '@/src/product-targets.mjs';
import { productKey as productKeyRaw } from '@/src/products.mjs';

export interface RankedSuggestion {
  concern: string;
  confidence: 'high' | 'medium' | 'low' | null;
  because: string | null;
}

export interface Classification {
  productType: string | null;
  /** Everything the model considered, ordered. */
  ranked: RankedSuggestion[];
  /** The pre-ticked subset: high confidence only, capped at three. */
  targets: string[];
  suggestions: string[];
  durationClaimDays: number | null;
  rejected: string[];
  classifier: { model: string; promptVersion: string };
}

export interface ProductIdentity {
  key: string;
  keyType: 'inci' | 'barcode' | 'name';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * The typed boundary onto the pipeline's classifier.
 *
 * `src/` is plain untyped ESM and stays that way (CLAUDE.md), which costs one
 * cast: `classify({ brand = null, name = null })` infers a parameter type of
 * `null`, so TypeScript rejects a real product name. Doing the cast once here
 * keeps it out of the call sites and puts the return shape in writing next to
 * it — the shape is `parseClassification()`'s, not an invention.
 */
export const classifyProduct = classifyRaw as unknown as (
  input: {
    brand?: string | null;
    name?: string | null;
    inci?: string[] | null;
    labelImagePath?: string | null;
  },
  options?: { maxPreticked?: number },
) => Promise<Classification>;

export const productIdentity = productKeyRaw as unknown as (input: {
  inci?: string[] | null;
  barcode?: string | null;
  brand?: string | null;
  name?: string | null;
}) => ProductIdentity;
