/**
 * Per-metric trajectory forecast: purge detection, a linear fit on the
 * post-purge (or whole) series, and a noise-floor-gated verdict.
 *
 * Three rules this must not violate (see CLAUDE.md):
 *
 *   1. Fit on device-corrected raw_score, never ui_score. The caller passes in
 *      already-corrected values (see `correctForDevice` in device-offset.mjs) —
 *      this module has no opinion on devices, it only sees numbers and dates.
 *
 *   2. A medication purge produces a real ~2-week decline before recovery
 *      (docs/measurements.md, Finding 3). A naive fit over that window forecasts
 *      continued worsening with high confidence. `detectPurge` finds the trough
 *      generically — the worst point in the series, provided it sits strictly
 *      inside the timeline and both the preceding drop and the following
 *      recovery exceed the noise floor — and the caller fits only the segment
 *      from the trough forward. If the trough has fewer than two points after
 *      it, there is no confirmed recovery yet: the whole metric is reported as
 *      `purge_phase` and no forecast is produced.
 *
 *   3. The forecast horizon is capped at half the *observed* span (first photo
 *      to last), not a fixed number of days — a 400-day series earns a longer
 *      look-ahead than a 3-week one, and the horizon grows as the user logs
 *      more days. It is never extrapolated from more than that.
 *
 * Each capture *session* (see sessions.mjs) counts as one point, its value the
 * mean of that burst — a 6-shot burst under bad lighting should not out-vote a
 * single clean photo when fitting the line.
 */

import { clampScore } from './concerns.mjs';

/**
 * Ordinary least squares on {x, y} points. x and y must already be numeric.
 *
 * `slopeVar` is the standard OLS slope-variance estimate (residual variance /
 * Sxx), used by kalman.mjs's blendTrend() to weigh this fit against the
 * Kalman trend. It is Infinity below 3 points (n-2 residual degrees of
 * freedom) rather than 0, deliberately: a 2-point line fits perfectly and its
 * *residual* is zero, but that reflects having no spare data to disagree with
 * itself, not genuine confidence. Treating that as nearly-zero variance would
 * let a 2-point OLS fit dominate a blend it has no business dominating —
 * blendTrend()'s point-count guard is the primary defense, this is the
 * fallback if it's ever called without one.
 */
export function fitLinear(points) {
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;

  const sxy = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
  const sxx = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);

  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;

  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  const residualVar = n > 2 ? ssRes / (n - 2) : Infinity;
  const slopeVar = sxx === 0 ? Infinity : residualVar / sxx;

  return { slope, intercept, r2, slopeVar, n };
}

/**
 * Find a purge-shaped trough: the series' worst point, strictly interior, with
 * both the drop into it and the recovery out of it exceeding the noise floor.
 * Points must be sorted by x ascending. Returns null if no such trough exists.
 */
export function detectPurge(points, noiseFloor) {
  const n = points.length;
  if (n < 4) return null;

  let minIdx = 0;
  for (let i = 1; i < n; i++) if (points[i].y < points[minIdx].y) minIdx = i;
  // Need at least two points before the trough to call the approach a decline
  // rather than one anomalous first sample, and at least one point after to
  // even ask whether it recovered.
  if (minIdx < 2 || minIdx === n - 1) return null;

  const preMax = Math.max(...points.slice(0, minIdx).map((p) => p.y));
  const postMax = Math.max(...points.slice(minIdx + 1).map((p) => p.y));
  const drop = preMax - points[minIdx].y;
  const recovery = postMax - points[minIdx].y;

  const floor = noiseFloor ?? 0;
  if (drop <= floor || recovery <= floor) return null;

  const pointsAfter = n - 1 - minIdx;
  return {
    index: minIdx,
    x: points[minIdx].x,
    y: points[minIdx].y,
    drop,
    recovery,
    resolved: pointsAfter >= 2,
  };
}

/** Collapse records into one point per capture session: mean value, mean time. */
function toSessionPoints(sessions, valueOf) {
  const points = [];
  for (const session of sessions) {
    const vals = session.map(valueOf).filter((v) => v !== null && v !== undefined);
    if (!vals.length) continue;
    const y = vals.reduce((a, b) => a + b, 0) / vals.length;
    const msValues = session.map((r) => Date.parse(r.capturedAt));
    const ms = msValues.reduce((a, b) => a + b, 0) / msValues.length;
    points.push({ ms, y, n: session.length });
  }
  points.sort((a, b) => a.ms - b.ms);
  if (!points.length) return points;
  const originMs = points[0].ms;
  return points.map((p) => ({ ...p, x: (p.ms - originMs) / 86400000 }));
}

/**
 * Forecast one metric from session-grouped records.
 *
 * `sessions` — output of groupSessions(records), grouped once across all
 * metrics so every metric's fit uses the same session boundaries.
 * `valueOf(record)` — extracts this metric's device-corrected value from a
 * record, or null if absent.
 * `noiseFloor` — this metric's worst same-session spread (src/noise-floor.mjs).
 *
 * Returns a status object. `status` is one of:
 *   'insufficient_data'   fewer than 2 sessions have this metric
 *   'insufficient_span'   sessions exist but collapse to zero time span
 *   'purge_phase'         trough detected, recovery not yet confirmed
 *   'ok'                  fit produced; check `verdict` for REAL / marginal / below_noise
 */
export function forecastMetric(sessions, valueOf, noiseFloor) {
  const points = toSessionPoints(sessions, valueOf);

  if (points.length < 2) return { status: 'insufficient_data' };

  const observedSpanDays = points.at(-1).x - points[0].x;
  if (observedSpanDays <= 0) return { status: 'insufficient_span' };

  const last = points.at(-1);
  const purge = detectPurge(points, noiseFloor);

  let fitPoints = points;
  let purgeInfo = null;
  if (purge) {
    purgeInfo = {
      troughDate: new Date(points[purge.index].ms).toISOString().slice(0, 10),
      drop: purge.drop,
      recovery: purge.recovery,
      resolved: purge.resolved,
    };
    if (!purge.resolved) {
      return {
        status: 'purge_phase',
        purge: purgeInfo,
        lastDate: new Date(last.ms).toISOString().slice(0, 10),
        lastValue: last.y,
      };
    }
    fitPoints = points.slice(purge.index);
  }

  if (fitPoints.length < 2) return { status: 'insufficient_data', purge: purgeInfo };

  const fit = fitLinear(fitPoints);
  const horizonDays = observedSpanDays / 2;
  const forecastX = last.x + horizonDays;
  // The analysis scale is bounded 0-100, so a line projected far enough always
  // leaves it. `change` is measured against the clamped value: the reportable
  // improvement is the one the instrument could actually show.
  const forecastValue = clampScore(fit.intercept + fit.slope * forecastX);
  const change = forecastValue - last.y;

  const noise = noiseFloor ?? null;
  const verdict =
    noise === null ? null : Math.abs(change) > noise * 1.5 ? 'REAL' : Math.abs(change) > noise ? 'marginal' : 'below_noise';

  return {
    status: 'ok',
    purge: purgeInfo,
    fitPointCount: fitPoints.length,
    slopePerDay: fit.slope,
    r2: fit.r2,
    lastDate: new Date(last.ms).toISOString().slice(0, 10),
    lastValue: last.y,
    horizonDays,
    forecastDate: new Date(points[0].ms + forecastX * 86400000).toISOString().slice(0, 10),
    forecastValue,
    change,
    noise,
    verdict,
  };
}

/** Forecast every metric. `valueOfMetric(metric)` returns a per-record valueOf(record) fn. */
export function buildForecasts(sessions, metrics, valueOfMetric, noiseFloorByMetric) {
  return Object.fromEntries(
    metrics.map((m) => [m, forecastMetric(sessions, valueOfMetric(m), noiseFloorByMetric[m] ?? null)]),
  );
}
