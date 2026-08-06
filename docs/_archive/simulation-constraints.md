# Skin Simulation — constraints and open questions

**Status: schema verified by probe; one render done by hand, none from code.**
A single render was run in the API console on 2026-08-04 (one of two free
trials), which is where the intensity semantics below come from. The repo itself
has still never called this endpoint — `src/youcam.mjs` has no skin-simulation
method. Everything below marked *verified* came from
deliberately malformed requests and reading the 400 bodies (free — see
`scripts/probe.mjs`, `scripts/probe-intensity.mjs`). Everything marked *unknown*
is unknown precisely because probing cannot answer it.

That split is the important thing about this document. **4xx probing reveals the
schema and never the pixels.** An error body can tell you `1.01` is out of range.
It cannot tell you what `0.5` looks like on a face.

Full request/response contract: `docs/youcam-api.md`, "Skin Simulation".
Concern name mapping and intensity clamping: `src/concerns.mjs`.

---

## Verified constraints

- Intensities are **top-level per-concern keys**, not a nested object and not a
  single severity value.
- Range is **[0.01, 1.0]**. `0` is rejected (`Simulation intensity cannot be all
  zero`), negatives are rejected (`below the allowed minimum`), `1.01` is
  rejected (`above the allowed maximum`).
- **Ten of the fourteen** analysis concerns are renderable. `moisture`,
  `firmness`, `droopy_upper_eyelid`, and `droopy_lower_eyelid` have no
  simulation counterpart.
- An **unrecognised concern key is silently ignored**, not rejected — so a typo
  surfaces as "intensity cannot be all zero", which reads like an unrelated bug.
- Per-render **unit cost is unknown**. No render has ever succeeded, and only
  successful tasks are billed.

---

## Constraint: the renderer is one-directional

Intensity means "how much correction to apply." There is no other direction.
The API cannot be asked to make skin look *worse*, at any value.

This is why the abandonment / warning branch of the forecast is **anchored on a
real earlier photograph** rather than synthesised. The user already has a
photographic record of worse skin — their own past captures. Rendering that
branch from a real photo is not a workaround that costs credibility; it is
photographic evidence rather than a synthesised effect, which is strictly more
credible for a product whose entire premise is "instrument, not beauty filter."

`IDEA.md` still describes negative intensity as available. It is wrong on this
point — see `CLAUDE.md`, "Where IDEA.md is now wrong."

---

## Partly answered: intensity is a fraction of the *remaining* problem

**Updated 2026-08-04 after one render in the API playground.** One of the two
free trial renders was spent on this; the other is unused.

The scale is anchored to what is left to fix, not to an absolute amount of
correction:

- `0.0` — the original photo, nothing removed.
- `1.0` — the concern removed as completely as the model can manage.
- in between — that fraction of the **remaining** problem removed.

So for a face measuring acne 78/100 — meaning 78% healthy, 22% of the problem
still present — an intensity of `0.5` targets half of that remaining 22%.

This makes the slope → intensity mapping fall out directly, and it agrees with
the formula already in `docs/side-by-side-viewer.md`:

```
problem_now      = (100 - score_now)      / 100
problem_forecast = (100 - score_forecast) / 100
intensity        = (problem_now - problem_forecast) / problem_now
                 =  Δscore / (100 - score_now)
```

Worked: acne 78 → 80 is a 2-point gain against 22 points of remaining problem,
so `intensity = 2/22 = 0.091`. (Not 0.10 — the denominator is the *remaining*
problem, not 100.)

### What is still assumed rather than measured

The playground run confirms the **endpoints**. It does not confirm the shape
between them, because it was a single render at a single value.

- **Linearity is inferred, not observed.** "0.09 removes 9% of remaining acne"
  is a working assumption. The intensity ladder described below is still the
  experiment that would confirm it.
- **Cross-concern comparability is untested.** `acne: 0.5` and `redness: 0.5`
  may not represent the same amount of visible change.
- **Lesion-awareness is not yet verified.** Whether the renderer targets the
  measured lesions or applies a regional smoothing pass is the outcome-4 risk
  below, and it remains the thing that would force restating the product claim.

Treat all three as documented assumptions in any UI copy, not as measured facts.

---

## The intensity a real forecast actually produces

The mapping is sound; the problem is what goes into it. Applying it to today's
`scripts/forecast.mjs` output at its 14-day cap:

| metric | 10-day Δ | 100 − score | intensity | noise floor |
|---|---|---|---|---|
| acne | +0.7 | 18.8 | **0.037** | 7.5 (16.0 corrected) |
| pore | +1.0 | 44.8 | **0.022** | 10.6 (16.2 corrected) |
| texture | +0.4 | 20.3 | **0.020** | 2.1 (6.4 corrected) |

`docs/skin-sim.md` puts `0.1–0.3` at "subtle refinement." Every forecast concern
lands at a fifth of *subtle*, so the right-hand pane would be visually identical
to the left. And per `docs/measurements.md` Finding 5, each delta is far below
even the optimistic noise floor, so the app's own credibility rule suppresses it
anyway. The neutral state in `docs/side-by-side-viewer.md` is what the reference
dataset legitimately produces.

The measured 19-month deltas do render: acne 49.7 → 81.3 is intensity `0.63`,
pore 12.9 → 55.1 is `0.48`. **The signal is not missing, it is just not inside a
two-week window.** Any demo built on a visible render has to be driven by a
long-span measured delta rather than a forward 14-day forecast. Which framing to
ship — back-test the engine against the real later photograph, extend the
horizon, or ship the honest neutral state — is undecided.

---

## Risk: our normalized photos may be too small for this endpoint

`docs/skin-sim.md` requires the face to occupy **≥ 60% of image width**, failing
with `error_src_face_too_small`. Running BlazeFace over all 20 normalized photos:

```
face-width fraction: min 0.523  median 0.550  max 0.595
count >= 0.60: 0 / 20
```

None pass, and the most generous (`historical_IMG_5611`, 0.595) misses narrowly.

**This is a risk, not a certainty.** HD Skin Analysis publishes the same ≥60%
rule and accepted all 20 at face fraction 0.55, so YouCam's detector clearly does
not measure the box the way BlazeFace does. But analysis and simulation may not
share a threshold.

Cheap to settle, because **failed tasks are free**: make the first render
`historical_IMG_5611`. A rejection costs nothing and tells us the crop must
change; a success prices the render *and* returns a usable frame.

If a tighter crop is needed, it is safe to make it simulation-only. `CLAUDE.md`
rule 3 protects the *analysis* cache key because face scale changes the measured
score — rendering produces no score, so a different crop on the render path
corrupts nothing. The one requirement is that both panes of the viewer show the
same crop.

---

## Open question: what does intensity *mean* visually?

**Partly resolved — see above.** The endpoints are known; the shape between them,
cross-concern comparability, and lesion-awareness are not. The experiment below
is what settles the remainder.

Concretely: a user has three visible pimples on one cheek. The request sets
`acne: 0.05`. What changes in the returned image?

At least four behaviours are consistent with everything currently known:

1. **Removal** — some lesions disappear entirely, count drops, survivors
   unchanged.
2. **Shrinkage** — count holds, each lesion covers less area.
3. **Fading** — count and area hold, contrast against surrounding skin drops.
4. **Global smoothing** — a blur/texture pass over the region that is not
   lesion-aware at all, and softens skin that had no lesion on it.

The playground run narrows this only in that *something* visibly improved at the
value tested. It does not distinguish 1 from 2 from 3, and it does not rule out
4 — a single before/after look is not connected-component analysis.

There is also still no basis for assuming intensity is **linear**, or that the
mapping from intensity to visible change is the same across concerns. `acne: 0.5`
and `redness: 0.5` may represent very different amounts of visible change.

### Why it matters more than an implementation detail

Outcome 4 is the one that would hurt. A non-lesion-aware smoothing pass is,
functionally, a beauty filter — and `CLAUDE.md` names "changes that make the
output look more like a beauty filter" as the thing that undercuts the whole
premise. The product's claim is that the forecast is rendered by a
dermatologist-validated simulation driven by the user's own measured slope. If
the renderer turns out to be applying generic smoothing, that claim needs to be
restated honestly, not defended.

**Superseded as a build blocker.** This document previously said not to build the
slope → intensity mapping until this was settled. The playground run defined the
units well enough that the mapping can now be written — it is the formula above.
What remains blocked is *claiming* linearity or lesion-awareness in user-facing
copy. Build the mapping; do not assert what the ladder has not yet measured.

---

## The experiment that settles it

The reference dataset makes this directly measurable, because every cached
analysis already contains a per-concern mask that localises the lesions:

```
data/analysis/hd_f055_<photo>/skinanalysisResult/hd_acne_output.png
```

Procedure — an intensity ladder on **one** photo (`0.05`, `0.25`, `0.5`, `1.0`,
`acne` only), then connected-component analysis of the acne mask region on each
returned image, compared against `resize_image.jpg` from the same analysis as the
before-frame. Both are the model's own normalised input, so they register
pixel-for-pixel without any alignment step.

| Measurement | Conclusion |
|---|---|
| blob count drops | removal |
| count holds, per-blob area drops | shrinkage |
| count and area hold, blob/skin contrast drops | fading |
| pixels change outside the mask blobs | global smoothing — **not lesion-aware** |

Whether the response is linear can be read off the same ladder: plot the chosen
measure against intensity and look at the shape.

### Cost discipline

Per-render cost is **still unknown** — the playground run consumed a free trial
and reported no unit cost, so it priced nothing. One free trial remains. The
ladder is four renders. **Price a single render first**, check the console, and
confirm before running the rest — `CLAUDE.md` requires confirmation before any
batch run. Roughly 468 of 1040 units remain.

Sequence the first billed render to answer two questions at once: use
`historical_IMG_5611` at a high intensity, so a rejection settles the face-size
risk for free and a success prices the render.

If a render times out locally it may still complete and bill; recover it with
`scripts/repoll.mjs` rather than paying twice.

---

## Sources checked, and what they do not say

Perfect Corp's public material describes capabilities, never semantics:
"clinical-grade before-and-after visualizations of up to ten skin concerns," and
a Skincare Pro product offering "27 aesthetic simulations each with varying
intensity." Neither defines what the intensity number does.

- [Skin Analysis API](https://yce.perfectcorp.com/ai-api/products/skin-analysis-api)
- [YouCam API docs portal](https://yce.perfectcorp.com/document/index.html)
- [Skincare Pro Aesthetic Simulator launch](https://www.businesswire.com/news/home/20240910549806/en/Perfect-Corp.-Launches-Skincare-Pro-Aesthetic-Simulator-Revolutionizing-Aesthetic-Treatment-Visualization-for-Beauty-Professionals)
- [Community YouCam API investigation](https://zenn.dev/long910/articles/2026-05-30-youcam-api-investigation?locale=en)
  — covers 20 API tasks, explicitly **not** skin-simulation
