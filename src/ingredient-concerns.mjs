/**
 * Deterministic ingredient-function -> analysis-concern lexicon, for tagging
 * catalog products with what they plausibly target — no LLM call, no per-
 * ingredient classification cost.
 *
 * This is viable specifically because incidecoder tags every one of its
 * 20,016 catalogued ingredients with functions drawn from a fixed taxonomy of
 * only **21 slugs** (measured against the full scraped corpus,
 * `skincare-data/raw/incidecoder/products/`, 2026-08-08) — small enough to
 * hand-map once, the same spirit as `EFFECT_LEXICON` in `src/inci.mjs` and
 * `ANALYSIS_TO_SIMULATION` in `src/concerns.mjs`.
 *
 * Deliberately conservative and one-directional: a function only appears here
 * if it is a positive, defensible signal that a product *targets* a concern.
 * Comedogenicity/irritancy ratings are real per-ingredient data (stored
 * alongside functions in the catalog) but are caution signals, not "targets
 * this concern" signals, and are intentionally not folded in here — mixing
 * "helps X" and "may worsen X" into one tag set would make the tag
 * meaningless. Concerns with no ingredient-function signal in this taxonomy
 * (`pore`, `firmness`, `eye_bag`, `dark_circle_v2`, both eyelid concerns,
 * `tear_trough`) are
 * left unreachable by this path rather than force-mapped to something
 * tenuous — consistent with this repo's "don't invent signal" stance
 * (CLAUDE.md rule 9).
 */

import { normalizeConcerns } from './concerns.mjs';

/** incidecoder ingredient-function slug -> analysis concern(s) it targets. */
export const FUNCTION_TO_CONCERN = {
  emollient: ['moisture'],
  'moisturizer-humectant': ['moisture'],
  'skin-identical-ingredient': ['moisture'],
  soothing: ['redness'],
  antioxidant: ['radiance', 'age_spot'],
  'skin-brightening': ['radiance', 'age_spot'],
  sunscreen: ['age_spot'],
  'anti-acne': ['acne'],
  'antimicrobial-antibacterial': ['acne'],
  exfoliant: ['texture', 'acne'],
  'abrasive-scrub': ['texture'],
  'cell-communicating-ingredient': ['wrinkle'],
  'surfactant-cleansing': ['oiliness'],

  // Formulation role only — no concern signal. Listed explicitly so the
  // absence reads as a deliberate decision, not a missed case.
  chelating: [],
  buffering: [],
  colorant: [],
  preservative: [],
  solvent: [],
  'viscosity-controlling': [],
  perfuming: [],
  emulsifying: [],
};

/**
 * One product's ingredient list (the shape `src/incidecoder.mjs`'s
 * `parseProductPage()` produces: `[{ functions: [{ slug }] }]`) -> the union
 * of concerns its ingredients' functions target, in canonical order.
 *
 * Routed through `normalizeConcerns()` so this can never emit a key outside
 * the 15-concern vocabulary, even if `FUNCTION_TO_CONCERN` is later edited to
 * contain a typo.
 */
export function deriveConcernTags(ingredients) {
  const found = new Set();
  for (const ingredient of ingredients ?? []) {
    for (const fn of ingredient.functions ?? []) {
      for (const concern of FUNCTION_TO_CONCERN[fn.slug] ?? []) found.add(concern);
    }
  }
  return normalizeConcerns([...found]);
}
