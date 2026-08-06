import { ANALYSIS_CONCERNS, normalizeConcerns } from '@/src/concerns.mjs';

export type Concern = string;

/** The canonical 14, in the canonical order. Never re-sort for display. */
export const CONCERNS: Concern[] = ANALYSIS_CONCERNS as Concern[];

/**
 * Display strings only. These are never keys and never round-trip: the label
 * for `pore` is "Pores", which is also the *simulation* key `pores` — mistaking
 * one for the other is exactly what `src/concerns.mjs` exists to prevent. Read
 * from this map, write through `normalizeConcerns()`.
 */
const LABELS: Record<string, string> = {
  acne: 'Acne',
  texture: 'Texture',
  redness: 'Redness',
  oiliness: 'Oiliness',
  radiance: 'Radiance',
  wrinkle: 'Wrinkles',
  pore: 'Pores',
  age_spot: 'Age spots',
  eye_bag: 'Eye bags',
  dark_circle_v2: 'Dark circles',
  moisture: 'Moisture',
  firmness: 'Firmness',
  droopy_upper_eyelid: 'Upper eyelid',
  droopy_lower_eyelid: 'Lower eyelid',
};

export function concernLabel(key: string): string {
  return LABELS[key] ?? key;
}

/** Throws on an unrecognised key — the deliberate opposite of the API's shrug. */
export function validateConcerns(keys: string[]): string[] {
  return normalizeConcerns(keys) as string[];
}

/** Put an arbitrary set of concerns into canonical order for display. */
export function orderConcerns(keys: Iterable<string>): string[] {
  const set = new Set(keys);
  return CONCERNS.filter((c) => set.has(c));
}
