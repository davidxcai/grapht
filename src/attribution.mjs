/**
 * Per-metric attribution: given a trial's routine, decide which intervention (if
 * any) is allowed to be named next to an observed change in each metric.
 *
 * The rules are in docs/trial-model.md, "Attribution". This module implements
 * exactly that table and nothing more — in particular it does NOT decide whether
 * a change is real. That is the detection gate's job, and the order matters:
 * the gate runs first, and a metric that fails it is reported as "no measurable
 * change" regardless of what attribution says about it. Attribution answers
 * "who gets named", never "did something happen".
 *
 * Two design points that are easy to get wrong:
 *
 * 1. Attribution is correlational. There is no control face. Nothing here
 *    licenses a causal claim, and the verdict names are chosen to make that
 *    awkward to write: `attributed`, not `caused`.
 *
 * 2. `direction: 'remove'` is treated identically to `'add'`. Stopping a product
 *    is a real experiment and receives credit the same way. Only the narration
 *    differs, so `direction` is carried through untouched for the summary to
 *    read.
 */

import { ANALYSIS_CONCERNS, normalizeConcerns } from './concerns.mjs';

/**
 * The four rows of the attribution table. Ordered from most to least
 * explanatory, which is also the order they should be narrated in.
 */
export const VERDICTS = {
  /** Exactly one tracked intervention targets this metric. Name it. */
  ATTRIBUTED: 'attributed',
  /** More than one does. Real effect, unsplittable — name all of them. */
  SHARED: 'shared',
  /** No tracked intervention, but the baseline routine touches it. Withhold credit. */
  CONFOUNDED: 'confounded',
  /** Nothing targets it and it moved anyway. A possible side effect. */
  UNEXPLAINED: 'unexplained',
};

/** Normalize one routine entry, validating its targets against the vocabulary. */
function normalizeEntry(entry, { index, kind }) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`${kind}[${index}] must be an object, got ${JSON.stringify(entry)}`);
  }
  const name = entry.name;
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error(`${kind}[${index}] requires a non-empty name`);
  }

  let targets;
  try {
    targets = normalizeConcerns(entry.targets);
  } catch (err) {
    throw new Error(`${kind}[${index}] (${name}): ${err.message}`);
  }

  const normalized = { name: name.trim(), targets };

  if (kind === 'interventions') {
    const direction = entry.direction;
    if (direction !== 'add' && direction !== 'remove') {
      throw new Error(
        `interventions[${index}] (${name}) requires direction 'add' or 'remove', got ${JSON.stringify(direction)}`,
      );
    }
    normalized.direction = direction;
    normalized.startedOn = entry.startedOn ?? null;
  }

  return normalized;
}

/**
 * Validate and normalize a routine once, so per-metric calls don't re-parse it.
 *
 * Returns `{ baseline, interventions, untargeted }`. `untargeted` lists tracked
 * interventions with an empty `targets[]` — legitimate (you may genuinely not
 * know what a product does), but they can never receive credit, so a trial made
 * entirely of them will report `unexplained` on every metric. Surfacing that at
 * creation is a lot kinder than surfacing it at the end date.
 */
export function normalizeRoutine(routine) {
  const baseline = (routine?.baseline ?? []).map((e, index) =>
    normalizeEntry(e, { index, kind: 'baseline' }),
  );
  const interventions = (routine?.interventions ?? []).map((e, index) =>
    normalizeEntry(e, { index, kind: 'interventions' }),
  );

  return {
    baseline,
    interventions,
    untargeted: interventions.filter((i) => i.targets.length === 0).map((i) => i.name),
  };
}

/**
 * Attribute a single metric.
 *
 * `windowStart` is optional; when given, tracked interventions that began after
 * it are flagged `lateStart`. Attribution itself is unaffected — a product added
 * in week 3 of a nine-month trial still targets what it targets — but the
 * summary needs to say so, because the metric was only exposed to it for part of
 * the window. See docs/trial-model.md, "Open questions", on mid-trial changes.
 */
export function attributeMetric(metric, routine, { windowStart = null } = {}) {
  const [key] = normalizeConcerns([metric]);
  const { baseline, interventions } =
    routine && routine.__normalized ? routine : normalizeRoutine(routine);

  const targeting = interventions
    .filter((i) => i.targets.includes(key))
    .map((i) => ({
      name: i.name,
      direction: i.direction,
      startedOn: i.startedOn,
      lateStart: Boolean(windowStart && i.startedOn && i.startedOn > windowStart),
    }));

  const background = baseline.filter((b) => b.targets.includes(key)).map((b) => b.name);

  let verdict;
  if (targeting.length === 1) verdict = VERDICTS.ATTRIBUTED;
  else if (targeting.length > 1) verdict = VERDICTS.SHARED;
  else if (background.length > 0) verdict = VERDICTS.CONFOUNDED;
  else verdict = VERDICTS.UNEXPLAINED;

  return {
    metric: key,
    verdict,
    /** Tracked interventions that may be named. Empty unless attributed/shared. */
    contributors: targeting,
    /**
     * Baseline entries touching this metric. Populated even when a tracked
     * intervention exists — the summary should still be able to say "note your
     * moisturiser also targets this", which is honest without withholding
     * credit that the table does grant.
     */
    background,
    /** True when credit is real but cannot be split. Never narrate around this. */
    unsplittable: verdict === VERDICTS.SHARED,
  };
}

/**
 * Attribute every metric in one pass.
 *
 * Defaults to all concerns rather than only the targeted ones, on purpose:
 * the `unexplained` row only exists if you look at metrics nobody targeted, and
 * that row is where side effects live. See CLAUDE.md, rule 8.
 */
export function attributeAll(routine, { metrics = ANALYSIS_CONCERNS, windowStart = null } = {}) {
  const normalized = { ...normalizeRoutine(routine), __normalized: true };
  const byMetric = Object.fromEntries(
    metrics.map((m) => {
      const result = attributeMetric(m, normalized, { windowStart });
      return [result.metric, result];
    }),
  );

  const counts = Object.fromEntries(Object.values(VERDICTS).map((v) => [v, 0]));
  for (const r of Object.values(byMetric)) counts[r.verdict] += 1;

  return {
    byMetric,
    counts,
    /** Tracked interventions that target nothing and so can never be credited. */
    untargeted: normalized.untargeted,
    /**
     * Tracked interventions targeting no metric that any other intervention
     * also targets — i.e. the ones a trial can actually resolve cleanly.
     */
    cleanlyResolvable: normalized.interventions
      .filter(
        (i) =>
          i.targets.length > 0 &&
          i.targets.every((t) => byMetric[t]?.verdict === VERDICTS.ATTRIBUTED),
      )
      .map((i) => i.name),
  };
}
