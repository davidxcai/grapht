# Forecast engine — design notes and next build

This documents where the forecast engine actually stands and what's designed
but not yet built, so a fresh session can pick this up without re-deriving it.
Everything below was worked out against the real 20-photo reference dataset —
numbers are reproducible offline with `node scripts/forecast.mjs` and
`node scripts/kalman-forecast.mjs` (no API calls, no units).

---

## What's built and working right now

| File | Role |
|---|---|
| `src/sessions.mjs` | Groups photo records into capture sessions (bursts) |
| `src/noise-floor.mjs` | Measurement noise floor from same-session score spread |
| `src/regression.mjs` | OLS fit + generic purge/trough detection — a **utility**, not the primary forecast path (see "Why not just OLS" below) |
| `src/kalman.mjs` | Local-linear-trend Kalman filter — the **actual forecast engine** — plus `blendTrend()`/`applyBlendedTrend()`, the KF+OLS inverse-variance blend |
| `scripts/forecast.mjs` | Product-facing forecast: Kalman trend blended with OLS, capped at 14 days, drops any horizon under 50% confidence |
| `scripts/kalman-forecast.mjs` | Diagnostic: prints the filter's internal level/trend state at every observation, plus its own *unclamped* reliable horizon for comparison against the 14-day product cap. Deliberately shows the **raw** KF trend, not the blend — this is "under the hood," `forecast.mjs` owns the product number |

`forecast.mjs` now blends the Kalman trend with an OLS slope (inverse-variance
weighted, see "KF + OLS inverse-variance blend" below) before projecting — that
piece is built. The two-tier calibration memory described below is still
designed but not implemented. Don't assume it's in the code until this doc is
updated.

---

## Why not just OLS (`regression.mjs`)

OLS with a discrete purge/no-purge switch has to *decide once* whether a
decline has "recovered," then commit to fitting only one side of that
decision. Reproduced concretely on the real acne data (Block A, Dec 20 –
Jan 15, device-corrected):

- Naive OLS over the whole 28-day window (ignoring the purge): slope
  **-0.242 pts/day**, r²=0.19 — genuinely forecasts continued worsening. This
  isn't a bug in the data or the read; without outside knowledge of the
  Accutane purge, that's the *correct* inference from the photos alone.
- Purge-aware fit (trough excluded, recovery segment only): slope flips to
  **+1.84 pts/day** — but on only 3 points / 1 degree of freedom, so the
  apparent tightness is a small-sample illusion, not real confidence (same
  failure mode as an early redness fit that produced a nonsensical
  4778-day "reliable horizon" from just 4 points).

`regression.mjs`'s `detectPurge()` is still useful — it's a clean, generic
trough detector (worst interior point, with both the drop into it and the
recovery out of it exceeding the noise floor) and it's the leading candidate
mechanism for the *product-attribution* idea below (flipped: flat-then-improve
instead of decline-then-recover). It's just not what drives the forecast
number anymore.

## Why the Kalman filter (`src/kalman.mjs`)

A local-linear-trend filter (state = [level, trend], process noise scales
with `dt³`) never has to make the purge/no-purge decision — a reversal just
moves the state. Verified on the real data: the filter's `trend` column goes
negative through the decline (`-0.63` → `-0.95` around the Jan 8 trough) and
flips positive by Jan 15 (`+0.75`), entirely from the recursive update, no
special case. Run `node scripts/kalman-forecast.mjs` to see this table.

Two bugs were found and fixed during this work, both worth knowing about:

1. **Long-gap blowup.** The reference series has a 416-day gap (Block B →
   Block C). Process noise scaling with `dt³` made the filter's uncertainty
   (and trend estimate) explode right before the most recent photo — it was
   extrapolating an old trend blindly across 14 months of silence. Fixed by
   capping the *projection* at `maxGapDays` (default 60) inside
   `runLocalTrendFilter` — the real elapsed time is still used for the next
   gap, only the process-noise/trend-carry math is capped.
2. **Confidence was scale-invariant in the noise floor alone.** `q` and `r`
   are both defined as `noiseFloor² × constant`, so the whole filter is
   mathematically homogeneous in the floor — after ~13 updates the initial
   condition washes out and every metric's confidence-vs-horizon curve comes
   out identical (`sd/floor = 0.9368` to 4 decimals, verified numerically),
   regardless of how erratic each metric's own history actually was. This is
   what the KF+OLS blend below is partly for.

### Confidence definition

`predictionConfidence(sd, noiseFloor)` = P(|forecast error| ≤ noise floor),
computed via the error function assuming Gaussian forecast error with std
`sd`. Ties confidence to the same yardstick the rest of the app already uses
for "can we tell this apart from noise" — an error smaller than the noise
floor is indistinguishable from a correct forecast.

> **Known issue: the yardstick is too generous.** `noiseFloor` here comes from
> `src/noise-floor.mjs`, which measures bursts taken seconds apart — instrument
> noise only. Day-to-day scatter, where the same face is genuinely in a different
> state, runs **1.1–3.4× larger** (`docs/measurements.md`, Finding 5). Every
> confidence figure `forecast.mjs` prints is therefore optimistic by roughly that
> factor, and "above the noise floor" is a weaker claim than it reads as.
>
> Two knock-on consequences worth knowing before touching this file: gating on
> the honest floor would suppress *every* horizon on the reference dataset, and
> the number of days of daily logging needed before a trend clears its own noise
> is on the order of **100–200**, not 14. The 14-day cap is about attribution and
> is still right on its own terms; it is simply not the binding constraint.
>
> Not yet fixed — documented deliberately rather than patched, since the honest
> floor is currently bracketed rather than measured (no consecutive-day pair
> exists in the dataset).

---

## Decided product rules (explicit, not just statistics)

- **Never forecast past 14 days.** Partly statistical (uncertainty grows with
  horizon), but also non-statistical: past ~2 weeks, diet/stress/weather/a
  new product have room to be the actual explanation, so even a
  mathematically tight fit stops being fairly attributable to "the routine."
  ~7 days is the sweet spot.
- **Drop any horizon where confidence < 50%.** A coin toss is not a forecast.
- **Metrics are forecast independently.** No cross-metric coupling — acne can
  decline while age_spot improves.
- **Purge/inflection detection is a domain prior, not a data correction.**
  Be honest in any UI copy that this is dermatological knowledge applied on
  top of the measurement, not something the pixels alone prove.

---

## KF + OLS inverse-variance blend (built)

The local-trend filter is recency-weighted, which is a strength (tracks
curves) but also a weakness: stress-tested against a pure zigzag series (no
real trend — `74, 66, 74, 66, 74, 66, 74`, dt=7 between each), the filter
read the last upward step as a trend reversal: **trend = +0.478/day**,
forecasting a runaway to **79.2 by day 14** against a ground truth of flat
~70.

Fix, verified numerically: compute an OLS slope over the same window and
combine it with the Kalman trend by **inverse-variance weighting** —
`blended = (trend_kf/var_kf + slope_ols/var_ols) / (1/var_kf + 1/var_ols)`.
For the zigzag case, OLS's own slope variance (0.016) is far tighter than the
Kalman trend variance (0.281) — OLS is very confident there's no trend, so it
dominates the blend automatically. Result: blended trend **+0.026** (vs.
ground truth 0), 14-day forecast **72.8** instead of 79.2. This is principled
combination (same math family as sensor fusion), not a hand-tuned fudge
factor, and no separate sign/alternation detector turned out to be necessary
— the blend handled it on its own.

**Required guard:** OLS's own variance estimate is unstable with few points
(same small-sample fragility as the 3-point post-purge acne fit and the
4-point redness fit above — a line fit to 3-4 points looks artificially tight
because there's almost no room left to disagree with itself). Don't blend in
an OLS estimate built on fewer than ~5 points; fall back to Kalman-only below
that, same as the `regression.mjs` purge detector already requires a minimum
point count before trusting a segment.

**Implementation:** `fitLinear()` in `src/regression.mjs` now also returns
`slopeVar` and `n` (residual variance / Sxx, `Infinity` below 3 points rather
than 0 — see its doc comment for why 0 would be actively wrong). `blendTrend()`
in `src/kalman.mjs` does the inverse-variance weighting with the ≥5-point
guard; `applyBlendedTrend()` substitutes the blended trend/variance into the
filter's final state before `forecast()` projects it, zeroing the level/trend
cross-covariance rather than carrying it forward (the blend draws on
information — the OLS fit — the filter's own covariance bookkeeping doesn't
know about). `scripts/forecast.mjs` computes OLS over the *same* points array
passed to the filter (full history, not a rolling window) and blends before
every projection. That full-history choice has a measured cost — it cancels
mid-window reversals; see "Recent-window OLS (measured, deferred)" below.
Re-running the zigzag stress test above against the actual code reproduces the
KF-only number exactly (trend +0.478, forecast 79.2) and the blended number to
within the same ballpark (+0.010, forecast 72.6 vs. the 0.026/72.8 noted
above) — the gap is just which noise-floor value the original exploration
used, not a behavioral difference; the dominant-variance-wins qualitative
result is unchanged. `scripts/kalman-forecast.mjs` intentionally still prints
the *raw*, unblended KF trend — it's the "under the hood" diagnostic, and
`forecast.mjs` is the one place that owns the product-facing number.

---

## Synthetic scenario tests (`scripts/test-scenarios.mjs`)

The real dataset exercises exactly one trajectory shape (purge trough →
recovery). This harness runs the *same* engine path as `forecast.mjs` over 22
hand-built two-week series where ground truth is known by construction, so the
forecast can be scored rather than inspected. Free, offline, deterministic
(seeded PRNG). `--clean` removes measurement noise to separate structural
behaviour from noise luck; `--repeat=N` reports rates over N draws instead of
one anecdote.

**Read the results with the product in mind, not just the math.** Several
scenarios here describe inputs the app should never accept rather than
trajectories it must predict, and a synthetic series can always be made
adversarial enough to break any filter. The useful question for each one is
"can this happen to a user who follows capture guidance, and is the forecast
engine the right layer to handle it?" Where the answer is no, the fix belongs
in `docs/capture-quality.md`, not here. Scenarios are tagged below accordingly.

Noise floor 7.5 (acne, controlled lighting — Finding 1), noise sd = floor/2,
daily sampling, true trends ±1.5 pts/day. From `--repeat=500`:

**Works.** `steady-up`, `steady-down`, `flat`, `subtle-up`, `zigzag`, `sparse-5`,
`gap` — median |err@7d| 1.7–3.4 pts, 0–14% of draws exceeding the floor. Sign is
never wrong on a real trend. The zigzag damping and the 416-day-gap fix both
hold up. `sparse-3` (below the ≥5-point OLS guard, KF-only) is fine on a clean
line — the guard costs little when the underlying signal is simple.

### Real product shapes that the engine gets wrong

These are the ones worth engineering against. Each is something that happens to
a user doing everything right.

1. **Mid-window reversals are crushed.** `up-then-down` and `down-then-up` (the
   purge shape compressed into 14 days — the case the KF exists for) blend to
   ±0.27–0.31/day against a true ±1.5, ~80% of draws off by more than the floor,
   sign outright wrong in 13–14%. Cause: OLS over the *whole* window sees ~0
   slope through a V or a Λ, its residual variance is comfortable, so it
   dominates the blend and cancels the reversal the filter correctly tracked.
   The noiseless run isolates it: the KF sees the turn, the blend flattens it to
   15% of truth. **Fix measured and deferred** — see the section below.
2. **Plateaus overshoot.** Diminishing returns — the realistic shape of a
   routine that worked and then stopped — forecast +1.15/day against a true
   +0.17, 65% over the floor. Same root cause; the deferred fix takes it to
   +0.59/day and 31%. This is the overpromise the product can least afford,
   because telling someone "keep going, +1.15/day" when they have plateaued is
   exactly the false-hope failure the product exists to avoid.
3. **A sub-noise trend reads as no trend, and that's correct.** `subtle-up`
   (+0.3/day against a 7.5 floor) comes out at ±0.3 with the sign wrong in
   13% of draws, but every forecast lands within the floor. Recorded here as
   confirmation rather than a defect: the engine is behaving as an instrument
   that can't resolve the signal, which is the honest answer.

### Scenarios that are capture problems, not model problems

The engine fails these badly. It should not be changed to fix them — the
failure is that the photo was accepted at all, and the fix is
`docs/capture-quality.md`. They stay in the suite as a measure of *residual
risk if the capture gate lets something through*, not as engine requirements.

- **`outlier-last-day` / `outlier-last-day-uptrend`.** One −25-point badly-lit
  photo on the newest day turns flat truth into −1.07/day, 99% of draws off by
  more than the floor, at 77% confidence. This is the "photographed myself
  outside in direct sunlight after a week in the bathroom" case. Finding 1
  measured exactly this magnitude (28-point acne swings from lighting alone).
- **`varied-lighting`.** A whole series captured at the 57.6 floor. Nothing in
  it is measurable; it should never have been logged.

### Scenarios that are neither — kept as guards, not targets

- **`step-change`** is a device switch, which `src/device-offset.mjs` and rule 6
  already own. A forecast engine extrapolating a discontinuity is expected; the
  discontinuity should have been corrected or marked upstream.
- **`zigzag`** is not a physical skin trajectory (no face alternates ±4 points
  daily under controlled capture). It exists solely as the regression guard for
  the KF+OLS blend, which was built to fix it. Keep it, don't design for it.
- **`near-floor`** exists to exercise the bottom of the score clamp, not because
  a user sitting at 8 and falling is a real scenario.

### Confidence carries little information about accuracy

Across all scenarios, confidence@7d spans only 61–79%, and it tracks *sampling
density* (sparse-3 61%, sparse-5 71%, gap 74%) rather than fit quality: the
worst scenario (`outlier-last-day`) scores 77%, the best (`steady-up`) 79%. This
is documented bug 2 above — `q` and `r` are both floor²×constant, so the filter
is homogeneous in the noise floor — confirmed to survive the blend. The 50%
cutoff consequently never fires: `no fc` is 0% in every scenario at 500 draws.

**How much this matters depends on capture quality, which is the point.**
Confidence is anchored to the noise floor, and if capture is genuinely
controlled then the floor *is* the right description of the error — anchoring to
it is defensible, and near-constant confidence across well-captured series is
not obviously wrong. The narrow, real gap is that the filter cannot notice a
series that is noisier than its own floor claims. That is precisely what the
capture gate prevents, so the gate is the first fix here too. Deriving `r` from
realised innovations (the two-tier memory below) remains the deeper fix, but it
is second in line, not first.

---

## Recent-window OLS (measured, deferred — do not re-derive)

This was built, measured, and deliberately reverted. The numbers below are
kept so nobody redoes the sweep; the code is not in the tree.

**The change:** replace the blend's full-history `fitLinear()` with a fit over
only points within `windowDays` of the last observation (default 7, widening by
point count if that window holds fewer than 5).

Window length was swept over 500 draws rather than picked (median |err@7d|):

| case | 5d | **7d** | 10d | 14d (= old behaviour) |
|---|---|---|---|---|
| down-then-up | 5.2 | **4.1** | 6.9 | 10.7 |
| up-then-down | 5.2 | **4.3** | 6.8 | 10.4 |
| up-then-flat | 4.3 | **3.5** | 3.9 | 5.3 |
| plateau | 5.4 | **4.9** | 5.7 | 8.3 |
| zigzag | 3.0 | 2.7 | **1.1** | 1.7 |
| flat / steady-up | 3.6 | 3.2 | 3.0 | **2.8** |

7 days wins every reversal and curvature case and costs 0.4 pts on the flat
controls. It also happens to be the horizon the product already calls its sweet
spot — fitting over roughly the span being projected is the principle, and the
sweep agrees with it.

Effect at 500 draws per scenario:

| scenario | blend → | true | sign wrong → | err>floor → |
|---|---|---|---|---|
| up-then-down | −0.27 → **−1.19** | −1.50 | 13% → **0%** | 81% → **26%** |
| down-then-up | +0.31 → **+1.28** | +1.50 | 14% → **1%** | 78% → **23%** |
| up-then-flat | +0.63 → **+0.13** | 0.00 | — | 29% → **17%** |
| down-then-flat | −0.61 → **−0.12** | 0.00 | — | 28% → **16%** |
| flat-then-up | +0.88 → **+1.36** | +1.50 | 0% | 30% → **18%** |
| plateau | +1.15 → **+0.59** | +0.17 | — | 65% → **31%** |
| step-change | +1.27 → **+1.07** | 0.00 | — | 84% → **69%** |
| zigzag | −0.13 → −0.28 | 0.00 | — | 0% → **0%** |

The stale-trend overpromise (`up-then-flat` / `down-then-flat`) was fixed as a
side effect: a 7-day window simply cannot see the previous week's regime. The
zigzag result the blend was originally built for is preserved (0% over floor).

### Why it was reverted anyway

**The cost is real: outlier sensitivity gets worse.** A shorter window gives a
single bad final photo more leverage. `outlier-last-day-uptrend` — one badly-lit
photo on the newest day of a genuine improvement — forecast the *wrong
direction* in **83%** of draws, up from 7%. `outlier-last-day` went 99% → 100%
over floor.

The instinct was to fix that inside the filter with innovation gating (discount
an observation whose surprise far exceeds what `r` predicts). That's the wrong
layer. A bad photo is not a statistical anomaly to be robustly absorbed — it's a
capture error with a knowable cause, and the app can detect it *before* spending
a unit on it. Innovation gating only knows "this number is surprising"; a
capture-quality check knows "you photographed yourself in direct sunlight and
your last six were in the bathroom," which is both more accurate and something
you can tell the user. See `docs/capture-quality.md`.

**Two further reasons to wait:**

- On the *current* dataset the change is nearly inert. There aren't 5 sessions
  inside any 7-day window, so the widening rule pushes the fit out to a 521-day
  span and it behaves much like the full-history fit anyway. It only becomes
  active once daily capture exists.
- The synthetic reversal is sharper than a real one. `down-then-up` turns over
  a single day; a real purge trough (Finding 3) turns over a week or more, so
  the full-history fit's failure is less severe in practice than ±1.5/day
  synthetic V's make it look.

**Revisit when:** the capture gate is in place *and* there is a real week or
more of daily photos to test against. The reversal shapes it fixes — purge
recovery, and improvement plateauing — are happy-path, not edge cases, so this
is deferred rather than rejected.

**Un-defer it when the calibration onboarding ships.** Measured over the first
*k* nightly captures (`docs/capture-quality.md`), plateau forecast error *grows*
with more data under the current full-history blend: 43% of draws over the noise
floor at 5 nights, 78% at 11. The early steep gains stay in the fit forever
while the true slope decays. That directly contradicts the product promise that
accuracy improves with use, and daily capture is precisely the data density that
makes the recent-window fix active.

## Score clamping (built)

`SCORE_MIN`/`SCORE_MAX`/`clampScore()` in `src/concerns.mjs`, alongside the
intensity clamp that owns the other scale. The analysis scale is bounded 0–100;
how the API measures is undocumented, but a forecast of 110 describes a face
the instrument cannot report. `kalmanForecast()` takes an explicit `bounds`
option and returns `{ value, raw, clamped }`; `forecastMetric()` in
`regression.mjs` clamps its own projection.

Three deliberate choices:

- **Bounds are passed in, not baked into `kalman.mjs`.** That module is generic
  state-space math, and device-corrected *observations* are legitimately allowed
  outside 0–100 (Finding 2 — corrected pore as low as −5.9). A silent default
  clamp inside the filter would hide exactly the cases measurements.md says to
  leave visible. The clamp belongs on forecast output, where a number is shown
  to a user as a future skin score.
- **`sd` and confidence are not adjusted.** Clamping truncates the forecast
  distribution but does not narrow it; reporting a bounded forecast as more
  certain would be the wrong inference.
- **`clamped` is returned** so the UI can say "already at the top of the scale"
  rather than drawing a flat line and calling it a prediction.

`near-ceiling` and `near-floor` scenarios cover both ends (median |err@7d| 0.2
and 0.4). The harness also clamps its *synthetic observations*, for the same
reason: a generated series containing a 111 isn't testing the ceiling, it's
testing a reading the API cannot produce.

---

## Designed, not yet built

### 1. Two-tier rolling-window + aggregate calibration memory

For the innovation-based q/r calibration (using realized prediction errors to
tune how much the filter should trust noise vs. trend, rather than deriving
`q`/`r` from the noise floor alone): don't use a hard rolling window (old data
drops off a cliff, causing a discontinuity exactly when an influential point
ages out) and don't use pure cumulative history (old regimes can permanently
over- or under-constrain today's estimate — "filter divergence").

Instead:
- **Last ~14 days**: individual daily points, each counted on its own —
  drives moment-to-moment calibration.
- **Everything older**: collapsed into one running aggregate (mean), which
  keeps absorbing days as they age out of the 14-day window. It never resets.
  ~15 total inputs at any time (14 individual + 1 aggregate).
- The aggregate is blended in via the same inverse-variance weighting as
  above, with its variance shrinking as `~1/n` (n = days it represents) — so
  it starts as a weak, low-confidence anchor and becomes a genuinely
  authoritative long-term floor the longer the app is used, with no extra
  tuning required.

This is smooth where a hard window isn't: adding one more day to a running
average moves that average by `1/n`, not a jump. The one honest caveat: a
single day's *individual influence* does step down hard the moment it
crosses from "counted on its own" (weight 1) to "folded into the aggregate"
(weight `1/n`) — but that step shrinks as `n` grows, so it matters most in
the first month of use and fades after that.

---

## Deferred / open

- **Product-tracking feature.** Photograph a skincare product, identify its
  active ingredients, map them to the metrics they plausibly affect (e.g.
  vitamin C → redness, texture), log a start date, and compare the
  before/after trend in the mapped metrics — framed **correlationally**
  ("redness was declining at X/day before this, Y/day after"), never
  causally ("this product caused...") — there's no control face, so a causal
  claim isn't something this data can support. Product identification method
  still undecided: manual entry against a curated ingredient table (least
  risky), OCR of the label against the same table (more automatic, adds a
  new failure mode), or full brand/product vision recognition (most
  impressive, biggest scope add, needs something outside YouCam's API
  surface — confirmed nothing in `docs/youcam-api.md` covers this). Needs
  more discussion before committing to an approach.
- **"Did the product help" detection** is structurally the same problem as
  purge detection, flipped: instead of decline-then-recover, it's
  flat-then-improve, timed against a logged product start date.
  `detectPurge()` in `regression.mjs` is the natural starting point to adapt.
- **Guided-capture HUD / lighting standardization** is still entirely
  unbuilt. Nothing in the pipeline corrects white balance, exposure, or
  shadows — `prepare.mjs` only does HEIC→JPEG and a DisplayP3→sRGB *color
  space* conversion, which is not the same thing. Standardized lighting is
  entirely on the person capturing until this exists.
- **The planned week-of-daily-photos capture.** Once it exists, rerun
  `forecast.mjs` / `kalman-forecast.mjs` against it — this is the real test
  of whether tighter, denser sampling extends the reliable horizon the way
  the theory here predicts.
- **Skin Simulation rendering and the web UI are both completely untouched.**
  Rendering is additionally *blocked*, not merely unstarted: translating a slope
  into an intensity requires knowing what an intensity does, and that is an open
  question with an experiment designed but not run —
  `docs/simulation-constraints.md`.
