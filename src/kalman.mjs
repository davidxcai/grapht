/**
 * Local-linear-trend state-space model (a Kalman filter over [level, trend]),
 * as an alternative to the fixed-window OLS fit in regression.mjs.
 *
 * The motivation: OLS with a discrete purge/no-purge switch (regression.mjs)
 * has to *decide*, once, whether a decline has "recovered" and then commit to
 * fitting only one side of that decision. A local-linear-trend filter never
 * has to decide — it carries a running belief about the current level and
 * slope, updates it with every new photo, and lets a sharp reversal (a purge
 * trough, a flare-up) simply move the state rather than requiring a special
 * case. Uncertainty is tracked continuously too, so "how far can we forecast"
 * falls out of the model instead of being bolted on afterward.
 *
 * State: x = [level, trend]. Transition over a gap of `dt` days:
 *   level' = level + dt * trend
 *   trend' = trend
 * Process noise Q(dt) is the standard "continuous white noise acceleration"
 * form — it lets the trend itself drift by an amount that grows with dt,
 * which is what allows the filter to track a curve rather than only a line.
 *
 * All 2x2 matrices are represented as [[a,b],[c,d]] and multiplied by hand;
 * a general matrix library would be overkill for a fixed 2-state system.
 */

const matMul = (A, B) => [
  [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
  [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
];
const transpose = (A) => [[A[0][0], A[1][0]], [A[0][1], A[1][1]]];
const matAdd = (A, B) => [[A[0][0] + B[0][0], A[0][1] + B[0][1]], [A[1][0] + B[1][0], A[1][1] + B[1][1]]];
const vecMat = (F, v) => [F[0][0] * v[0] + F[0][1] * v[1], F[1][0] * v[0] + F[1][1] * v[1]];

function transitionMatrix(dt) {
  return [[1, dt], [0, 1]];
}

/** Continuous white noise acceleration process noise, spectral density q. */
function processNoise(dt, q) {
  return [
    [(q * dt ** 3) / 3, (q * dt ** 2) / 2],
    [(q * dt ** 2) / 2, q * dt],
  ];
}

/**
 * Pick a default process-noise spectral density from the noise floor: the
 * true trend is allowed to shift the level by about half a noise-floor's
 * worth over a ~7-day gap. This is a real tunable (how fast the model trusts
 * a regime change), not something derivable from the data alone — treat it as
 * a product knob, exposed here rather than hidden.
 */
export function defaultProcessNoise(noiseFloor, { referenceDays = 7, targetFraction = 0.5 } = {}) {
  const targetShift = (noiseFloor ?? 1) * targetFraction;
  return targetShift ** 2 / ((referenceDays ** 3) / 3);
}

/**
 * noiseFloor is a burst *range* (max-min of 2-6 photos), not a standard
 * deviation. Dividing by 2 is a rough, deliberately conservative range-to-sigma
 * approximation for small samples (the exact factor depends on burst size).
 */
export function observationVariance(noiseFloor) {
  return (noiseFloor / 2) ** 2;
}

/**
 * Run the filter forward over session points (ascending x, days). `r` is the
 * observation-noise variance (use noiseFloor^2 as a rough stand-in for a
 * proper variance — the noise floor is a worst-observed range, not a std dev,
 * so this is conservative-ish, not exact).
 *
 * Returns per-point filtered states plus the final state/covariance, which
 * `forecast()` extrapolates from.
 */
export function runLocalTrendFilter(points, { q, r, maxGapDays = 60 }) {
  if (points.length === 0) throw new Error('need at least one point');

  let x = [points[0].y, 0];
  let P = [[Math.max(r, 1) * 4, 0], [0, 1]];

  const states = [{ x: points[0].x, level: x[0], trend: x[1], levelVar: P[0][0], trendVar: P[1][1] }];

  for (let i = 1; i < points.length; i++) {
    const dt = points[i].x - points[i - 1].x;
    // A gap longer than maxGapDays gives no basis for carrying the old trend
    // that far forward, or for compounding its uncertainty that far (Q grows
    // with dt^3). Cap the *projection* at maxGapDays; the observation still
    // lands at the real elapsed time, so the next real dt is unaffected.
    const dtEff = Math.min(dt, maxGapDays);
    const F = transitionMatrix(dtEff);
    const Q = processNoise(dtEff, q);

    const xPred = vecMat(F, x);
    const PPred = matAdd(matMul(matMul(F, P), transpose(F)), Q);

    const innovation = points[i].y - xPred[0];
    const S = PPred[0][0] + r;
    const K = [PPred[0][0] / S, PPred[1][0] / S];

    x = [xPred[0] + K[0] * innovation, xPred[1] + K[1] * innovation];
    // P = (I - K H) PPred, H = [1, 0]
    P = [
      [(1 - K[0]) * PPred[0][0], (1 - K[0]) * PPred[0][1]],
      [PPred[1][0] - K[1] * PPred[0][0], PPred[1][1] - K[1] * PPred[0][1]],
    ];

    states.push({ x: points[i].x, level: x[0], trend: x[1], levelVar: P[0][0], trendVar: P[1][1] });
  }

  return { states, final: { x, P, lastX: points.at(-1).x } };
}

/**
 * Combine the Kalman filter's trend with an independent OLS slope via
 * inverse-variance weighting (same math family as sensor fusion): each
 * estimate is weighted by 1/variance, so whichever one is more confident
 * dominates automatically, with no hand-tuned mixing factor.
 *
 * This exists because the local-trend filter is recency-weighted — a
 * strength for tracking curves, but on a pure zigzag series (74, 66, 74, 66,
 * ...) it reads the last step as a reversal and forecasts a runaway trend.
 * OLS's own slope variance is tight on a flat-but-noisy series like that, so
 * blending it in damps the false trend without needing a separate
 * zigzag/alternation detector.
 *
 * `ols` must come from fitLinear() over the *same* points given to the
 * filter. Guard: below `minOlsPoints`, OLS's variance estimate is small-
 * sample fragile (a line fit to 3-4 points looks artificially tight because
 * there's almost no room left to disagree with itself — see fitLinear's
 * doc comment) and blending it in would let it dominate for the wrong
 * reason, so fall back to the Kalman trend alone.
 */
export function blendTrend(kf, ols, { minOlsPoints = 5 } = {}) {
  if (ols.n < minOlsPoints || !Number.isFinite(ols.slopeVar) || ols.slopeVar <= 0) {
    return { trend: kf.trend, variance: kf.trendVar, blended: false };
  }
  const wKf = 1 / kf.trendVar;
  const wOls = 1 / ols.slopeVar;
  return {
    trend: (kf.trend * wKf + ols.slope * wOls) / (wKf + wOls),
    variance: 1 / (wKf + wOls),
    blended: true,
  };
}

/**
 * Substitute a blended trend into the filter's final state before
 * forecasting. The level and its variance are left untouched; the trend and
 * its variance are replaced with the blend, and the level/trend cross-
 * covariance is zeroed rather than carried forward — the blend draws on
 * information (the OLS fit) the filter's own covariance bookkeeping doesn't
 * know about, so the old cross-term no longer describes the joint state.
 */
export function applyBlendedTrend(final, blend) {
  return {
    ...final,
    x: [final.x[0], blend.trend],
    P: [[final.P[0][0], 0], [0, blend.variance]],
  };
}

/**
 * Extrapolate from the filter's final state to `lastX + horizonDays`.
 *
 * `bounds` clamps the projected *value* to a reportable range — for skin scores
 * that's [SCORE_MIN, SCORE_MAX] from concerns.mjs, since the analysis scale is
 * bounded 0-100 and a linear trend run far enough forward will always leave it.
 * Callers pass it explicitly rather than it being baked in here: this module is
 * generic state-space math, and device-corrected *observations* are legitimately
 * allowed outside 0-100 (docs/measurements.md, Finding 2), so a silent default
 * clamp would hide the very cases that documentation says to leave visible.
 *
 * `variance` and `sd` are reported unclamped, and so is the confidence derived
 * from them. Clamping truncates the forecast distribution but does not make it
 * narrower; treating a bounded forecast as more certain would be the wrong
 * inference. `clamped` is returned so a caller can say "already at the top of
 * the scale" instead of showing a flat line and calling it a prediction.
 */
export function forecast(final, horizonDays, { q, r, bounds } = {}) {
  const F = transitionMatrix(horizonDays);
  const Q = processNoise(horizonDays, q);
  const xf = vecMat(F, final.x);
  const Pf = matAdd(matMul(matMul(F, final.P), transpose(F)), Q);

  const raw = xf[0];
  const value = bounds ? Math.min(bounds.max, Math.max(bounds.min, raw)) : raw;

  return { value, raw, clamped: value !== raw, variance: Pf[0][0], sd: Math.sqrt(Pf[0][0] + r) };
}

/**
 * Largest horizon at which the forecast's own uncertainty (1 sd) is still
 * within `factor` x the noise floor. Default factor matches the 'REAL'
 * threshold used elsewhere in this codebase (summarize.mjs, regression.mjs):
 * a change has to clear 1.5x the noise floor before it's treated as real, so
 * the forecast band should clear the same bar.
 */
export function reliableHorizon(final, { q, r, noiseFloor, factor = 1.5, maxDays = 3650 }) {
  const threshold = noiseFloor * factor;
  let lo = 0;
  let hi = maxDays;
  if (forecast(final, hi, { q, r }).sd <= threshold) return hi; // never crosses within maxDays
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (forecast(final, mid, { q, r }).sd <= threshold) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Abramowitz & Stegun 7.1.26 approximation, max error ~1.5e-7. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/**
 * Confidence that a forecast is "good enough": the probability that the true
 * value lands within one noise-floor-width of the point forecast, given a
 * Gaussian forecast error with standard deviation `sd`. This ties confidence
 * to the same yardstick the rest of the app already uses for "can we tell
 * this apart from noise" — a forecast that's off by less than the noise floor
 * is indistinguishable from a correct one, so that's the bar.
 */
export function predictionConfidence(sd, noiseFloor) {
  if (sd <= 0) return 1;
  return erf(noiseFloor / (sd * Math.SQRT2));
}
