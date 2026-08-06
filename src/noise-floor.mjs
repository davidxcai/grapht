/**
 * Measurement noise floor, derived from same-session bursts (photos seconds
 * apart, where any score spread is by definition capture-and-model noise rather
 * than biology — see docs/measurements.md, Finding 1).
 *
 * Bursts are split by whether lighting was held constant, since that is the one
 * variable a guided-capture UI can actually control. The controlled figure is
 * the threshold the product should hold itself to; varied is a fallback for
 * metrics with no controlled-lighting burst in the dataset.
 */

import { groupSessions } from './sessions.mjs';

const val = (r, metric) => r.concerns?.[metric]?.raw ?? null;

/** A >2x ISO spread within one burst means the lighting genuinely changed. */
function isoVaried(session) {
  const isos = session.map((r) => r.iso).filter(Boolean);
  return isos.length > 1 && Math.max(...isos) / Math.min(...isos) > 2;
}

/**
 * Returns { bursts, controlled, varied, worst }.
 *   bursts   — per-session breakdown, for display.
 *   controlled/varied — { [metric]: worst range seen | null }, split by lighting.
 *   worst    — { [metric]: controlled ?? varied }, the figure to gate forecasts on.
 */
export function computeNoiseFloor(records, metrics, { gapSeconds } = {}) {
  const sessions = groupSessions(records, { gapSeconds }).filter((s) => s.length > 1);

  const controlledRanges = Object.fromEntries(metrics.map((m) => [m, []]));
  const variedRanges = Object.fromEntries(metrics.map((m) => [m, []]));

  const bursts = sessions.map((session) => {
    const flag = isoVaried(session);
    const bucket = flag ? variedRanges : controlledRanges;
    const isos = session.map((r) => r.iso).filter(Boolean);

    const ranges = Object.fromEntries(
      metrics.map((m) => {
        const vals = session.map((r) => val(r, m)).filter((v) => v !== null);
        if (vals.length < 2) return [m, null];
        const range = Math.max(...vals) - Math.min(...vals);
        bucket[m].push(range);
        return [m, range];
      }),
    );

    return {
      device: session[0].device,
      capturedAt: session[0].capturedAt,
      n: session.length,
      isoMin: isos.length ? Math.min(...isos) : null,
      isoMax: isos.length ? Math.max(...isos) : null,
      lightingVaried: flag,
      ranges,
    };
  });

  const worstOf = (buckets) =>
    Object.fromEntries(metrics.map((m) => [m, buckets[m].length ? Math.max(...buckets[m]) : null]));

  const controlled = worstOf(controlledRanges);
  const varied = worstOf(variedRanges);
  const worst = Object.fromEntries(metrics.map((m) => [m, controlled[m] ?? varied[m]]));

  return { bursts, controlled, varied, worst };
}
