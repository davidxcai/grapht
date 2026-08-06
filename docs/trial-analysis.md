# Trial analysis engine

What happens between a finished series of captures and a summary a person can
trust. Replaces `_archive/forecast-design.md`, which described a forward-projection
engine that is no longer the product.

Everything with a number attached was measured against the real 20-photo
reference dataset and is reproducible offline with no API calls and no units.

---

## The job changed

The old engine answered **"what will the slope be?"** and projected it forward.
The new engine answers two retrospective questions:

1. **Was anything distinguishable from noise over this window?**
2. **What shape did it have?**

Both are strictly easier than forecasting, and the same code answers them —
which is why the estimation machinery survived the pivot intact even though its
output no longer is.

### Shape, not slope

This is the important structural consequence, and it inverts an old conclusion.

A forecast needs **one number**: the current trend, projected. A retrospective
summary needs a **shape**, because shape is what people recognise as their own
experience. *"It got worse for three weeks, bottomed out around January 8, then
improved steadily through April"* is both more useful and more verifiable than
*"+0.074 points/day."*

That reverses the status of `detectPurge()` in
[`../src/regression.mjs`](../src/regression.mjs). Under the old design it was
a liability: a trough forces a forecaster to decide which side of the reversal
to fit, and `_archive/forecast-design.md` documented at length why that decision is
unsafe on small samples. Under the new design there is no decision to make,
because nothing is being projected. The trough is simply *where the story turns*
— and narrating it correctly is the single most valuable thing the summary does.

The isotretinoin purge is the canonical case. A user two weeks into treatment,
watching their skin get visibly worse, is precisely the person who quits. A
summary that names the trough and shows the recovery is the product working.

---

## What's built

| File | Role now |
|---|---|
| `src/sessions.mjs` | Groups captures into sessions (bursts). Unchanged. |
| `src/noise-floor.mjs` | Instrument noise floor from same-session spread. Now also used per-user, from the day-1 baseline burst. |
| `src/regression.mjs` | OLS fit with `slopeVar`; `detectPurge()` trough detection. **Promoted** — see above. |
| `src/kalman.mjs` | Local-linear-trend filter, plus `blendTrend()`/`applyBlendedTrend()`. Now estimates the trend *within* a window rather than projecting past it. |
| `src/device-offset.mjs` | Cross-device correction. Mostly dormant in single-device trials; still required when someone changes phones mid-trial. |
| `scripts/summarize.mjs` | Series and noise floor. Unchanged. |
| `scripts/forecast.mjs` | **Obsolete as a product path.** Retained as a diagnostic; nothing in the product should call it. |
| `scripts/kalman-forecast.mjs` | Diagnostic view of filter state. Still the best way to watch the filter absorb the Jan 8 reversal with no hardcoded purge logic. |
| `scripts/test-scenarios.mjs` | **Scores the wrong objective now** — see [Open items](#open-items). |

---

## The gate

Nothing reaches the summary without clearing this. It is the mechanism behind
the product's whole credibility claim.

### 1. Minimum detectable effect, from real timestamps

```
se(slope) = σ / (sd_x · √n)
```

- `σ` — the noise floor. Per-user if a baseline burst exists, otherwise the
  reference floor with a visible caveat. Use the **conservative** figure:
  day-to-day scatter runs 1.1–3.4× instrument noise (`measurements.md`,
  Finding 5), and gating on instrument noise alone is what made the old
  confidence numbers optimistic.
- `sd_x` — standard deviation of the actual capture timestamps. Not the planned
  schedule. This is what makes clustering cost what it should.
- `n` — sessions, not photos. A burst is one session.

A metric clears the gate when its estimated change exceeds `2σ` of its own
standard error.

### 2. Three outcomes, never two

| Outcome | Condition |
|---|---|
| **Improved** | change > 2σ, in the healthier direction |
| **Worsened** | change > 2σ, in the unhealthier direction |
| **No measurable change** | change ≤ 2σ |

The third is a statement about the instrument, not a verdict on the product, and
the copy must make that unmistakable. How often it fires depends entirely on how
large the change was relative to this user's scatter — there is no fixed number
of days below which nothing is detectable (`measurements.md`, Finding 5, and the
warning attached to its table).

Scores run 0–100 where **higher is healthier**. "Acne got worse" is a *lower*
number.

### 3. Stated before the trial, not only after

The same maths run at trial creation with the planned schedule, so the user
learns the resolvable effect size before investing three weeks. An app that
tells you up front it won't be able to see what you're looking for is doing the
most useful thing it can.

---

## Narration rules

The summary is LLM-written. These constrain it. They are not style guidance —
each one prevents a specific fabrication.

1. **A metric that didn't clear the gate is described as unchanged.** No
   percentage, no direction, no story. Not "a slight improvement."
2. **Attribution comes from the trial model, never from the narrative.**
   `shared` is never collapsed to one product; `confounded` never credits the
   trial; `unexplained` is surfaced rather than dropped.
3. **Compliance and clustering are stated.** "All in the first week" appears in
   the text.
4. **Shape over endpoints.** If `detectPurge()` finds a trough that clears the
   floor on both the descent and the recovery, the narrative is built around it.
5. **Correlational language only.** "Texture improved at X/day during this
   trial," never "the BHA caused."
6. **No cross-metric coupling.** Metrics are estimated independently. Acne can
   improve while oiliness worsens, and often does.

The generator receives only gated, attributed values — never raw deltas. It
cannot narrate what it was never given.

---

## Measured findings that carry over

These cost real effort to establish. Preserved so nobody re-derives them.

### KF + OLS inverse-variance blend

The local-trend filter is recency-weighted, which tracks curves well but
overreacts to the last point. Against a pure zigzag (`74, 66, 74, 66, …`,
dt=7, no real trend) the raw filter read the final upward step as a reversal:
trend **+0.478/day**.

Fix: compute OLS over the same window and combine by inverse-variance weighting.

```
blended = (trend_kf/var_kf + slope_ols/var_ols) / (1/var_kf + 1/var_ols)
```

On the zigzag, OLS's slope variance (0.016) is far tighter than the Kalman
trend variance (0.281), so OLS dominates automatically and the blend lands at
**+0.026** against a ground truth of 0. Principled combination, not a tuned
fudge factor; no separate alternation detector was needed.

**Required guard:** don't blend an OLS estimate built on fewer than ~5 points. A
line fit to 3–4 points looks artificially tight because there's almost no room
to disagree with itself — the same small-sample illusion that produced a
3-point post-purge acne slope of +1.84/day and a nonsensical 4778-day horizon
from a 4-point redness fit.

### Whole-window OLS is now correct

`_archive/forecast-design.md` documented a measured, deliberately-reverted change:
replacing the blend's full-history fit with a recent 7-day window. A sweep over
500 draws showed 7 days winning every reversal and curvature case, at a cost of
much worse sensitivity to a single bad final photo (`outlier-last-day-uptrend`
forecast the wrong direction in 83% of draws, up from 7%).

**That trade-off no longer applies.** A forecast needs the *current* trend, so
recency-weighting is the right instinct. A retrospective wants the trend **over
the trial window**, which is exactly what the whole-window fit computes. The
recency bias that made a short window attractive is now a defect, and the
outlier sensitivity that made it dangerous is avoided for free.

The mid-window reversal problem the short window was meant to fix — a purge V
crushed to 15% of its true amplitude by whole-window OLS — is now handled by
segmentation instead. Detect the trough, describe the phases, don't average a V
into a flat line. This is a better answer than either window length.

### Confidence, as previously defined, is retired

`predictionConfidence(sd, noiseFloor)` = P(|forecast error| ≤ noise floor) was
anchored to a forecast error that no longer exists. It also carried two known
defects worth remembering:

- Because `q` and `r` are both `noiseFloor² × constant`, the filter is
  mathematically homogeneous in the floor. After ~13 updates every metric's
  confidence curve came out identical (`sd/floor = 0.9368`), regardless of how
  erratic its actual history was.
- Across all 22 synthetic scenarios, confidence spanned only 61–79% and tracked
  *sampling density* rather than fit quality — the worst scenario scored 77%,
  the best 79%. The 50% cutoff never fired.

The replacement is the MDE gate above, which is anchored to the trial's real
sampling and the conservative floor rather than to a self-referential
prediction interval.

### Score clamping is now mostly moot

`clampScore()` in `src/concerns.mjs` existed because a *forecast* of 110
describes a face the API cannot report. With no forecast, there is nothing to
clamp. The function stays — it's correct and cheap — but the product path no
longer calls it.

The inverse rule still stands and still matters: **device-corrected
observations are deliberately allowed outside 0–100** (Finding 2, corrected pore
as low as −5.9). Clipping them would hide exactly the cases where the correction
is least trustworthy.

---

## Open items

### The test suite scores the wrong thing

`scripts/test-scenarios.mjs` builds 22 synthetic two-week series with known
ground truth and scores **forecast error at 7 days**. That objective is gone.

It should score *retrospective* estimation instead: recovered slope vs. true
slope over the window, and — more importantly — whether the narrated shape
matches the constructed one. Did it find the trough? Did it place it on the
right day? Did it correctly report "no measurable change" on `subtle-up`?

The scenario library itself is still valuable and mostly still valid. Its
taxonomy carries over unchanged, and it is worth restating because it took a
while to arrive at:

- **Real product shapes the engine must handle.** `up-then-down`,
  `down-then-up` (the purge), `plateau`, `up-then-flat`. These are happy-path,
  not edge cases. Under the new design the reversal cases become *easier*
  (segmentation) and the plateau case becomes nearly trivial (there is no
  forward projection left to overshoot with).
- **Capture problems, not model problems.** `outlier-last-day`,
  `varied-lighting`. The failure is that the photo was accepted at all. The fix
  belongs in [`capture-quality.md`](capture-quality.md), never in the filter. A
  bad photo is not a statistical anomaly to absorb robustly — it's a capture
  error with a knowable cause that the app can detect *before* spending a unit
  on it. Innovation gating only knows "this number is surprising"; a capture
  check knows "you photographed yourself in direct sunlight and your last six
  were in the bathroom," which is both more accurate and something you can tell
  the user.
- **Guards, not targets.** `step-change` is a device switch, owned by
  `device-offset.mjs`. `zigzag` is not a physical skin trajectory; it exists
  solely as the regression guard for the blend. `near-floor` exercises the
  clamp.

Do not harden the engine against a photo that should never have been analysed.

### Also open

- **Segmented narration is unbuilt.** `detectPurge()` finds one trough. A
  nine-month trial may have several phases. What the summary does with three
  segments instead of two is undesigned.
- **The conservative floor is bracketed, not measured.** The reference dataset
  contains no consecutive-day pair at all — the tightest genuine gap is 2 days —
  so the true day-over-day figure sits somewhere between the instrument floor
  and the residual sd. Four or five consecutive days under controlled lighting
  would settle it, at ~5 analyses.
- **Seven metrics have no floor at all.** `moisture`, `wrinkle`,
  `dark_circle_v2`, `eye_bag`, `firmness`, and both eyelid metrics were never
  in the cached analysis. See [`trial-model.md`](trial-model.md).
- **The two-tier calibration memory** (last ~14 days as individual points,
  everything older collapsed into a running aggregate whose variance shrinks as
  ~1/n) was designed for innovation-based q/r tuning and never built. It is
  less urgent now — the MDE gate doesn't depend on it — but it remains the
  deeper fix for the filter's homogeneity in the noise floor.
- **Guided-capture lighting standardisation is entirely unbuilt.** Nothing in
  the pipeline corrects white balance, exposure, or shadows. `prepare.mjs` does
  a DisplayP3→sRGB *colour space* conversion, which is not the same thing.
  Standardised lighting is on the person capturing until this exists — and
  Finding 1 says that is the difference between a measurement and a random
  number.
