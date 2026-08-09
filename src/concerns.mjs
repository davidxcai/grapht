/**
 * The Analysis <-> Simulation concern mapping.
 *
 * None of this is in Perfect Corp's published docs — it was recovered by probing
 * the API with deliberately invalid requests and reading the 400 bodies
 * (see scripts/probe.mjs). Verified 2026-08-03. Re-run the probes if calls start
 * failing with InvalidParameters.
 *
 * Three things here are easy to get wrong:
 *
 * 1. Simulation concern names are NOT the analysis names. Four of the ten differ,
 *    and the difference is inconsistent pluralisation: analysis says `pore`,
 *    simulation says `pores`; analysis says `age_spot`, simulation says `spots`.
 *    An unrecognised key is silently ignored rather than rejected, so a typo
 *    surfaces as "Simulation intensity cannot be all zero" — not as a bad-name
 *    error. Always map through this table.
 *
 * 2. Analysis scores run 0-100 where HIGHER IS HEALTHIER. Simulation intensity
 *    runs 0.0-1.0 where HIGHER IS MORE CORRECTION APPLIED. The two scales point
 *    the same direction (more improvement) but have different units and ranges.
 *
 * 3. Intensity is clamped to [0, 1]. Negative values are rejected outright with
 *    "below the allowed minimum", so the renderer cannot be asked to make skin
 *    look worse. See docs/simulation-constraints.md for how the warning
 *    trajectory works around this.
 */

/** Valid simulation intensity bounds, confirmed by probe. */
export const INTENSITY_MIN = 0.0;
export const INTENSITY_MAX = 1.0;

/**
 * analysis concern (SD name) -> simulation concern.
 * `null` means the metric is measurable but NOT renderable.
 */
export const ANALYSIS_TO_SIMULATION = {
  acne: 'acne',
  texture: 'texture',
  redness: 'redness',
  oiliness: 'oiliness',
  radiance: 'radiance',
  wrinkle: 'wrinkle',
  pore: 'pores',
  age_spot: 'spots',
  eye_bag: 'eye_bags',
  dark_circle_v2: 'dark_circle',

  // Measurable only — no simulation counterpart.
  moisture: null,
  firmness: null,
  droopy_upper_eyelid: null,
  droopy_lower_eyelid: null,

  // Confirmed as a valid `dst_actions` value by probe 2026-08-09 (`hd_tear_trough`
  // is accepted; see `toRequestAction`), but never exercised against a real
  // response, so whether it has a simulation counterpart is unknown. Left
  // unmapped like the other measurable-only concerns rather than guessed.
  tear_trough: null,
};

/**
 * The canonical 15-concern analysis vocabulary. Every concern name anywhere in
 * the product — intervention `targets[]`, summary rows, cache keys — resolves
 * through this list.
 *
 * `hd_skin_type` is also a valid `dst_actions` value (confirmed by the same
 * probe) but is deliberately excluded here. **Confirmed categorical, not a
 * score**: it classifies skin into Normal / Oily / Dry / Combination / Redness
 * and the four compound forms (e.g. "Oily & Redness"), each broken into
 * `whole` / `t_zone` / `u_zone` subcategories — there is no `raw_score` and no
 * "higher is healthier" direction. Folding it into `ANALYSIS_CONCERNS` as an
 * ordinary concern would violate rule 1 and corrupt every chart, slope and
 * attribution row that touches it. It needs its own category-aware path (a
 * label per zone, not a number) rather than a place in this numeric vocabulary
 * — not yet built.
 */
export const ANALYSIS_CONCERNS = Object.keys(ANALYSIS_TO_SIMULATION);

/** The ten concerns the simulation renderer accepts. */
export const SIMULATION_CONCERNS = Object.values(ANALYSIS_TO_SIMULATION).filter(Boolean);

/**
 * Resolve a possibly-messy concern name to its canonical analysis key, or null.
 * Accepts the `hd_` prefix and surrounding whitespace/case, since those come
 * from result payloads and user input respectively.
 *
 * Deliberately does NOT accept simulation names (`pores`, `spots`, `eye_bags`,
 * `dark_circle`). Those are a different vocabulary and silently coercing them
 * would reintroduce the exact confusion the mapping table above exists to
 * prevent — a `targets: ['pores']` typo should surface as a rejection, not
 * quietly become `pore`.
 */
export function normalizeConcern(name) {
  if (typeof name !== 'string') return null;
  const key = name.trim().toLowerCase().replace(/^hd_/, '');
  return Object.hasOwn(ANALYSIS_TO_SIMULATION, key) ? key : null;
}

export const isAnalysisConcern = (name) => normalizeConcern(name) !== null;

/**
 * Normalize a list of concern names, rejecting anything unrecognised.
 *
 * The simulation API silently ignores unknown keys, which is how a typo becomes
 * a confident wrong answer rather than an error (see the header note). Nothing
 * downstream of user or LLM input should inherit that behaviour, so this throws
 * by default. Pass `{ drop: true }` where lossy is genuinely correct — parsing
 * a classifier's raw output, where an unrecognised suggestion should be dropped
 * rather than abort the whole product.
 */
export function normalizeConcerns(names, { drop = false } = {}) {
  const out = [];
  const rejected = [];
  for (const name of names ?? []) {
    const key = normalizeConcern(name);
    if (key === null) rejected.push(name);
    else if (!out.includes(key)) out.push(key);
  }
  if (rejected.length && !drop) {
    throw new Error(
      `unrecognised concern name(s): ${rejected.map((r) => JSON.stringify(r)).join(', ')}. ` +
        `Valid keys: ${ANALYSIS_CONCERNS.join(', ')}`,
    );
  }
  return drop ? { concerns: out, rejected } : out;
}

/** Analysis concerns that can be forecast *and* rendered. */
export const RENDERABLE_ANALYSIS_CONCERNS = Object.keys(ANALYSIS_TO_SIMULATION).filter(
  (k) => ANALYSIS_TO_SIMULATION[k] !== null,
);

/** Convert an SD analysis concern to its HD equivalent. HD needs short side >= 1080px. */
export const toHd = (concern) => `hd_${concern}`;

/**
 * `dst_actions` (the analysis *request*) rejects `hd_dark_circle_v2` outright —
 * confirmed by probe 2026-08-08: sending it alone returns `"0 is not one of
 * the accepted values."`, and in the (then 14-concern) full list the same error
 * named its array index (`"9 is not one of the accepted values."`).
 * `hd_dark_circle` (no `_v2`) is accepted. This is the only one of the fifteen
 * where the request-side action name differs from the canonical analysis name
 * — every other concern round-trips through plain `toHd`. Use this instead of
 * `toHd` wherever the full concern set is sent as `dst_actions`.
 */
const REQUEST_ACTION_OVERRIDES = { dark_circle_v2: 'dark_circle' };
export const toRequestAction = (concern) => `hd_${REQUEST_ACTION_OVERRIDES[concern] ?? concern}`;

/** SD and HD concerns cannot be mixed in one request — the API rejects the task. */
export function assertUniformResolution(actions) {
  const hd = actions.filter((a) => a.startsWith('hd_')).length;
  if (hd !== 0 && hd !== actions.length) {
    throw new Error(`cannot mix SD and HD concerns in one request: ${actions.join(', ')}`);
  }
}

/**
 * Analysis score bounds. The API never returns a raw_score outside 0-100 — how
 * it measures is undocumented, but the scale is bounded, so a forecast of 104
 * describes a face the instrument cannot report and a forecast of -3 the same.
 *
 * Deliberately NOT applied to observations. Device correction is additive and
 * unclamped by design (docs/measurements.md, Finding 2: corrected pore as low
 * as -5.9), because clipping would hide exactly the cases where the correction
 * is least trustworthy. This clamp belongs on *forecast output*, at the point
 * where a number is shown to a user as a future skin score.
 */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** Clamp a forecast score into the reportable range. */
export function clampScore(value) {
  if (!Number.isFinite(value)) throw new Error(`score must be finite, got ${value}`);
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, value));
}

export function clampIntensity(value) {
  if (!Number.isFinite(value)) throw new Error(`intensity must be finite, got ${value}`);
  return Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, value));
}

/**
 * Build a simulation payload from analysis-space intensities.
 * Keys absent from the mapping are dropped rather than passed through, since the
 * API would silently ignore them.
 */
export function toSimulationParams(intensitiesByAnalysisConcern) {
  const params = {};
  for (const [concern, value] of Object.entries(intensitiesByAnalysisConcern)) {
    const target = ANALYSIS_TO_SIMULATION[concern.replace(/^hd_/, '')];
    if (!target) continue;
    const clamped = clampIntensity(value);
    if (clamped > 0) params[target] = clamped;
  }
  if (Object.keys(params).length === 0) {
    throw new Error('at least one concern must have intensity > 0 (API rejects all-zero)');
  }
  return params;
}
