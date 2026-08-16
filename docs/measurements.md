# Measurements from the reference dataset

Everything here was measured on the project owner's own 18-month photo series
(20 photos, analysed 2026-08-03 in HD at face fraction 0.55). These numbers are
the evidence base for several design decisions, and they are reproducible offline
from the cache with `node scripts/summarize.mjs` — no API calls, no units.

---

## The dataset

| Block | Dates | Photos | What it is |
|---|---|---|---|
| **A** | 2024-12-20 → 2025-01-15 | 8 | Acne medication start. Dense: 8 photos in 26 days. |
| **B** | 2025-02-26 → 2025-06-13 | 6 | Follow-up, sparse, ~107 days. |
| — | 2025-06-13 → 2026-08-03 | 0 | 416-day gap. |
| **C** | 2026-08-03 | 6 | Same-session burst, 39 seconds, deliberately varied lighting. |

Devices: iPad Pro 12.9" (4), iPhone XS (6), iPhone 16e (10).

**Cross-device pairs.** Three near-simultaneous captures on different devices,
close enough that biological change is negligible. These are what make the device
confound correctable:

| Pair | Gap |
|---|---|
| 2024-12-26 iPhone XS ↔ 2024-12-28 iPad Pro | 2 days |
| 2025-01-11 iPhone XS ↔ 2025-01-15 iPad Pro | 4 days |
| 2025-02-26 iPhone XS ↔ 2025-02-28 iPhone 16e | 2 days |

**Same-session bursts.** Photos seconds apart, where any spread is by definition
measurement noise rather than biology:

| Session | n | Gap | Lighting |
|---|---|---|---|
| 2024-12-28 iPad | 2 | 9 s | constant |
| 2025-02-26 iPhone XS | 2 | 31 s | constant |
| 2026-08-03 iPhone 16e | 6 | 39 s | **ISO 100 → 1000, deliberately varied** |

---

## Finding 1 — Lighting noise is catastrophic

Score spread within a single burst, `raw_score` points:

| | acne | texture | redness | age_spot | oiliness | pore | radiance |
|---|---|---|---|---|---|---|---|
| **lighting held constant** | 7.5 | **2.1** | 10.4 | 0.9 | 7.9 | 10.6 | 2.3 |
| **lighting varied** | 28.2 | **57.6** | 23.1 | 5.8 | 38.7 | 79.6 | 22.7 |

Texture noise rises **27×**, from 2.1 to 57.6 points, on photos taken 39 seconds
apart from the same face on the same phone. Pore rises from 10.6 to 79.6.

For scale: the total measured acne improvement across the whole 18 months is
about **21 points**. Under uncontrolled lighting the noise on a single afternoon
is **28 points**. Without standardised capture, the entire signal is smaller than
the noise.

**This is the empirical justification for the guided-capture HUD.** It was very
nearly cut from the plan as UI polish. It is not polish — it is the difference
between a measurement and a random number. The controlled-lighting row is the
threshold the product should hold itself to when deciding whether a change is
real.

---

## Finding 2 — Device confound is severe, but acne survives it

Camera hardware changes the scores directly, and better cameras resolve *more*
detail, so an upgrade looks like deterioration.

Pore `raw_score` by device:

```
iPad Pro    82 – 100
iPhone XS   43 –  83
iPhone 16e  31 –  57
```

Because the devices arrive in chronological order, "pore declining over 18
months" is largely a hardware artifact. Same story for texture.

Offsets from the cross-device pairs, computed by `node scripts/device-offset.mjs`
(see `src/device-offset.mjs`) and normalised to iPhone 16e (the most-used device,
and the one future captures will most likely come from):

| Metric | iPhone XS offset | iPad Pro offset | Verdict |
|---|---|---|---|
| **acne** | −6.2 | −10.7 | small; usable across devices |
| **texture** | −23.1 | −30.6 | must be corrected before plotting |
| **pore** | −48.1 | −87.1 | must be corrected before plotting |
| **redness** | +4.1 | +18.6 | must be corrected |
| **radiance** | −9.9 | −4.9 | must be corrected |
| **oiliness** | −14.7 | −4.4 | must be corrected |
| **age_spot** | −6.7 | −6.5 | small; borderline usable |

**Acne is the device-robust metric**, which is the fortunate outcome for an
acne-trajectory product: the headline number survives a phone upgrade. Every
other metric needs correction before it can appear in a cross-device chart —
redness and oiliness turned out to need it too, which the original 3-metric
spot-check missed.

The offset is derived from only 3 near-simultaneous pairs (see the table above),
each itself a single noisy sample or a 2-frame burst mean — it is additive and
unclamped, so a corrected score can land outside [0, 100] (observed: corrected
pore as low as −5.9 for early iPhone XS captures, where raw pore was already
near its device floor). Treat the correction as a directional fix for cross-device
comparison, not a precision instrument, and don't clip it back into range —
clipping would hide exactly the cases where the correction is least trustworthy.

Corollary for the live app: a user switching phones injects a step change into
their history. The app should record the device with every capture and either
correct for it (`src/device-offset.mjs`) or visibly mark the discontinuity.

---

## Finding 3 — The purge is visible in the data

Acne `raw_score` (higher = healthier) across Block A:

```
Dec 20   60.3
Dec 26   58.7
Dec 28   51.1 / 58.6
Jan 05   51.8
Jan 08   43.5   ← trough
Jan 11   47.6
Jan 15   60.3
```

Then Block B: Feb 65–72, **Apr 26 → 97.9**, Jun 89.4, Jun 13 70.8. Block C
today ≈ 81 (mean of the burst).

The medication purge is unambiguous — a decline to a trough around **Jan 8**,
roughly two weeks after starting, then recovery. This matches the owner's
recollection independently of the data.

**This breaks naive linear regression.** A least-squares fit over Block A alone
slopes downward and would forecast continued worsening with high confidence. Any
forecast built on this data must either detect the inflection and fit only the
post-trough segment, or explicitly surface a "purge phase — forecast paused"
state.

This is also why the Block A → A+B → A+B+C progression is the right way to
demonstrate the engine: each widening window tells a genuinely different story,
and the change in the story is the product.

---

## Finding 4 — Capture and preprocessing constraints

**The model works at 1920×2560.** Every `resize_image.jpg` returned, in both SD
and HD, from sources up to 4032 px. Anything larger than 2560 on the long side is
discarded, so uploading it only costs bandwidth.

Live capture spec that follows:

- short side **≥ 1080 px** (HD minimum — below this you silently drop to SD quality)
- long side **≤ 2560 px** (beyond this is thrown away)
- face height **≥ 0.55** of frame height (below ~0.45 the API rejects the photo)

A 1080p `getUserMedia` frame grab lands exactly on the HD threshold — it
qualifies but does not saturate the model. Pushing the constraint toward
1920×2560 is worth it if iOS Safari will grant it.

**Photos.app export destroys the data.** The original exports of this dataset
were 664×1182 — cropped to 9:16 and downscaled ~20× in pixel count. That is below
HD's 1080 px short-side minimum, so those files could not have been analysed in
HD at all. Re-exporting via *File → Export → Export Unmodified Original* recovered
2316×3088 and 3024×4032. This is a one-time archive repair and does **not** apply
to the live capture path, where frames come straight from the camera.

**Orientation must be baked into the pixels.** Every source file was flagged
portrait via EXIF while stored as a landscape buffer. Anything downstream that
ignores the EXIF tag sees a sideways face and fails to detect it. `sharp.rotate()`
with no argument applies the tag and strips it.

**Colour space matters for redness specifically.** All sources were Display P3.
Feeding P3 values to an API expecting sRGB inflates saturation, and redness is
among the metrics we care most about. `sips --matchTo` handles the conversion
during HEIC decode.

---

## Finding 5 — There are two noise floors, and we gate on the wrong one

The noise floor in Finding 1 comes from bursts taken *seconds* apart. Skin cannot
change in 39 seconds, so that spread is pure instrument noise: camera, lighting,
model. It is a **lower bound** on the noise a daily-logging user actually faces.

It says nothing about the other source of variation — the same face genuinely
being in a different state from one day to the next. Sweat, sleep, hydration,
time of day, having just washed your face. A user who sweats slightly overnight
is not a measurement error; the skin really is oilier, but it is not a trend
either.

Measuring the residual scatter of session means around a fitted trend picks up
both at once:

| metric | within-burst range | (as sd) | residual sd | ratio |
|---|---|---|---|---|
| acne | 7.5 | 6.7 | 16.0 | **2.4×** |
| texture | 2.1 | 1.9 | 6.4 | **3.4×** |
| redness | 10.4 | 9.2 | 10.3 | 1.1× |
| age_spot | 0.9 | 0.8 | 2.7 | **3.4×** |
| oiliness | 7.9 | 7.0 | 13.9 | 2.0× |
| pore | 10.6 | 9.4 | 16.2 | 1.7× |
| radiance | 2.3 | 2.0 | 6.3 | **3.1×** |

(Burst *range* converted to an sd via the n=2 factor 1.128, so the two columns
are comparable.)

Day-to-day scatter runs **1.1–3.4× the instrument noise**. `scripts/forecast.mjs`
gates on the instrument figure, so its noise floor is 2–3× too permissive and its
confidence percentages are correspondingly overstated.

### The honest caveat: this dataset cannot settle it

Residual sd is an **upper** bound, not the answer. It folds day-to-day biology
together with the misfit of a straight line across 19 months — Finding 3 shows
that line is a bad model of Block A. And the fit is 13 session means with a
416-day gap carrying most of the leverage.

More importantly, **the series contains no consecutive-day pair at all.** Of 13
sessions only three have n > 1, and all three are bursts seconds apart. The
tightest genuine gap between distinct captures is 2 days. The true day-over-day
number is bracketed between the two columns above and cannot be pinned down
without data at that timescale.

**This is a data-collection gap, not an analysis one.** Four or five consecutive
days under controlled lighting would settle it, at ~5 analyses. Until then, treat
the residual-sd column as the conservative floor and say so.

### Consequence: how long detection takes depends on how big the change is

The standard error of an OLS slope shrinks with more points even when each point
is noisy (`se = σ / (sd_x · √n)`), so logging more often buys real detection
power. Taking residual sd as σ and this dataset's fitted slopes as truth, days of
*daily* logging before **these particular slopes** clear their own noise:

| metric | σ | slope/day | 2σ | 3σ | change at the 2σ day |
|---|---|---|---|---|---|
| texture | 6.4 | +0.043 | 103 | 134 | 4.4 pts |
| age_spot | 2.7 | +0.017 | 107 | 140 | 1.8 pts |
| pore | 16.2 | +0.096 | 111 | 146 | 10.7 pts |
| acne | 16.0 | +0.074 | 131 | 172 | 9.7 pts |
| radiance | 6.3 | +0.021 | 163 | 214 | 3.4 pts |
| oiliness | 13.9 | +0.033 | 205 | 268 | 6.8 pts |
| redness | 10.3 | +0.001 | 1721 | 2255 | 1.7 pts |

> **Read this table correctly.** It is **not** a statement that skin takes
> 100–200 days to change, and it must never be quoted as one. Every row asks a
> narrow question: *given a trend as slow as the one this particular dataset
> happened to contain, how many days until it separates from noise?* The slopes
> here are tiny — acne moved +0.074 points/day — so naturally they take months.
>
> Detection time is a function of **effect size**, and this table holds effect
> size fixed at the slowest thing we measured. A large fast change clears
> immediately: oiliness dropping 30 points in three days after starting a face
> wash is roughly 2σ of oiliness noise per day and needs no waiting at all. Real
> skin does both — a flare appears in a week, photoageing takes a year.
>
> The redness row makes the circularity obvious. 1721 days does not mean redness
> is undetectable; it means redness barely moved *in this series*. A user with
> rosacea starting azelaic acid would resolve it in days.

The honest general statement is the one the app already implements per-metric and
per-trial: **compare the observed change against this user's own noise, whatever
the window length.** Short trials are not disqualified, and long ones are not
automatically conclusive. Fourteen days of data is real data; it answers the
question for changes big enough to see in fourteen days, and returns "no
measurable change" for the rest — which is itself a finding worth recording,
because the same product logged for forty days by someone else is how the two
windows start informing each other.

> **Update.** This finding is what retired forward forecasting: a projection
> needs the slope to be pinned down far more tightly than a retrospective
> "did this move?" does. The product is now retrospective — see `PRODUCT.md`
> and `docs/trial-analysis.md`.

### Not yet reproducible

Unlike Findings 1–4, these numbers came from ad-hoc analysis rather than a
committed script, so `scripts/summarize.mjs` will not print them. Adding a
`scripts/noise-horizon.mjs` that derives both columns and the detection table
from the cache is an open item.

---

## Finding 6 — `ui_score` compresses `raw_score` non-linearly, by up to 3×

Measured across all 140 `{raw_score, ui_score}` pairs cached from the
reference dataset: `d(ui)/d(raw)` is **~0.55** at raw 40–55, **~0.39** at raw
70–85, and **~1.26** above raw 85. The same real change in `raw_score`
therefore renders anywhere from 0.39× to 1.26× as large in `ui_score`
depending on where the score happens to sit — a **3× spread** in apparent
magnitude for an identical underlying change.

Concretely, the reference series' acne purge (Finding 3) is raw 60.3 → 43.5
(−16.8) but ui 76 → 66 (−10): 40% of the real change is invisible in
`ui_score`.

**This is why `raw_score` is used for everything and `ui_score` is not
displayed anywhere in the product.** Since the app's headline is a *change*,
not a level, a display value that distorts change magnitude by up to 3× is
disqualified regardless of how it looks. `ui_score` survives only in the
fixture, so a synthesised concern stays shaped like a measured one.

(An earlier draft of this guidance said "fit on `raw_score`, display
`ui_score`" — that was superseded once this measurement was run. If you find
that phrasing anywhere, it's stale.)

---

## Reproducing

```bash
node scripts/summarize.mjs        # series (raw and device-corrected), noise floor
node scripts/device-offset.mjs    # just the device-offset table, writes data/device-offsets.json
```

Reads only `data/analysis/hd_f055_*/normalized.json`. The `f055` tag is the face
fraction: results captured at a different crop scale are not comparable, and
mixing them fabricates trends. Superseded 0.45 results are quarantined in
`data/analysis/_superseded_f045/` rather than deleted, since regenerating them
would cost units.
