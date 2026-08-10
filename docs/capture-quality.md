# Capture quality gate — design

**Status: §4 and §5 are built** — the alignment guide, framing, scale and head
pose, in `components/camera-capture.tsx` and `lib/capture-guide.ts`. §2 is built
as a readout that never blocks, for the reason given there. Everything else is
designed and not built. Thresholds below are measured against the 20 reference
photos in `data/`.

> **Written before the pivot to retrospective trials, and still current.**
> Everything measured here — lighting, direction, colour, framing, sharpness —
> is about whether a photo is a valid measurement, which no product decision
> changes. This layer became *more* load-bearing, not less: with no forecast to
> absorb a bad capture, a mis-lit photo goes straight into a trial verdict.
>
> A few passages still say "forecast" where the product now says "detect." The
> measured content is unaffected; see `docs/trial-analysis.md` for the current
> framing.
>
> **Also still current after the 2026-08-08 daily-analysis pivot** (only a
> trial's initial and final photo are ever analysed — `CLAUDE.md`, "Repository
> state"), for a reason worth stating: every capture goes through this same
> guided camera, daily logs included, even though most of them are never
> analysed. That has to stay true, because a daily log can retroactively
> become the *final* analysed photo (`endTrial()`'s "use my latest photo"
> fallback, `app/trials/actions.ts`) — so quality still matters on a photo the
> app doesn't yet know will end up measured.

Parked with a protocol ready to run: **§3c, screen flash as a controlled light
source** — ~12 units, needs new photos, cannot be answered from the cache.

---

## Why this is a separate layer

The forecast engine cannot fix a bad photo, and it should not try. Measured
(`scripts/test-scenarios.mjs`): a single badly-lit photo on the most recent day
turns a flat series into a −1.07 pts/day decline, wrong by more than the noise
floor in 99% of noise draws, reported at 77% confidence. A whole series captured
under varying light (Finding 1's 57.6-point texture floor) is not measurable at
all.

The instinct is to make the filter robust — reject observations whose innovation
far exceeds what the model expects. That is the wrong layer, for a reason worth
stating plainly: **innovation gating only knows "this number is surprising."**
A capture check knows *why*, before a unit is spent — that the photo was taken
in direct sunlight when the last six were indoors. That difference matters three
ways:

1. It can be told to the user, who is the only one who knows whether they
   genuinely changed bathrooms or just stood by a window today.
2. It is not confounded with real biology. A filter that discards surprising
   observations will eventually discard a real flare-up.
3. It is free, and it happens *before* the API call. A garbage photo that
   analyses **successfully** still bills a unit and poisons the series (only
   failed tasks are free — see CLAUDE.md, API budget discipline).

The product framing also matters: telling a user "this photo looks different
from your usual, want to continue?" reads as instrumentation. Silently
accepting it and letting them discover the bad data later does not.

---

## The two tiers

**Block** — the photo cannot produce a usable measurement. Don't upload it,
don't spend a unit, ask for a retake.

**Warn and confirm** — the photo is technically analysable but differs from the
user's own history in a way that is known to move scores more than biology does.
Show what changed, recommend the fix, let the user decide. If they continue, the
photo is **recorded as flagged** and the forecast can exclude or down-weight it
later. This is the honest version of outlier rejection: the app drops a photo
because it knows the lighting was wrong, not because the number was inconvenient.

Never silently drop a photo the user took.

---

## Checks, and what the reference data says about each

All 20 reference photos were measured with the candidate signals. The
**2026-08-03 burst (6 photos, deliberately varied lighting, ISO 100→1000)** is
the ground truth for "bad"; the other 14 were captured under controlled lighting
and are the ground truth for "good".

### 1. Ambient light level — metadata only, free, no pixels

`EV100 = log2(N² / t) − log2(ISO / 100)` from the aperture, exposure time, and
ISO already recorded by `prepare.mjs`. One scalar for "how much light was in the
room."

| set | EV100 range | spread |
|---|---|---|
| 14 controlled photos | 5.28 – 6.86 | 1.6 stops |
| 6 varied-lighting photos | 2.44 – 7.76 | **5.3 stops** |

Worst offenders: ISO 1000 at 1/15s = **−3.84 stops** below the user's median;
ISO 100 at 1/60s = **+1.48 stops** above it.

**Threshold: warn beyond ±1.0 stops from the user's rolling median.** Flags 3 of
the 6 varied photos and none of the 14 controlled ones (the first photo,
IMG_0392, sits at −0.99 and is marginal — but it is also the photo that
*establishes* the baseline, see "Cold start" below).

This check is the cheapest thing in the whole system and can run on the live
camera preview before the shutter is even pressed.

### 2. Light direction — left/right face luminance ratio

Mean luminance of the left half of the face box over the right half. Direct
sunlight and window light are directional; a mirror-lit bathroom is not.

| set | ratio range | within-session spread |
|---|---|---|
| controlled | 1.09 – 1.16 | 0.02 – 0.07 |
| varied burst | 0.88 – 1.51 | **0.63** |

**The baseline is not 1.0 — it is ~1.12 for this user**, whose usual setup is
consistently a little brighter on one side. That is exactly why the check must
compare against the user's own history rather than a universal constant.

**Threshold: warn beyond baseline ±0.10.** Flags 5 of 6 varied photos, 0 of 14
controlled. The single best discriminator of the ones measured.

### 3. Colour of the light — R/G and B/G channel ratios

Mean channel ratios within the face box, a white-balance proxy. Catches warm
indoor bulbs vs. daylight vs. overcast.

| set | R/G | B/G |
|---|---|---|
| controlled | 1.32 – 1.73 | 0.63 – 0.91 |
| varied burst | 0.96 – 1.73 | 0.56 – 1.04 |

**Threshold: warn outside the user's historical range.** Catches the one varied
photo the side-ratio check misses (B/G 0.56), and the ISO-100 daylight shot
lands outside on both axes at once (R/G 0.96, B/G 1.04). Together with check 2,
**all 6 varied photos are flagged and no controlled photo is.**

Relevant to `prepare.mjs`'s existing DisplayP3→sRGB conversion, which is a
colour *space* conversion and does nothing about the colour of the light.

### 3b. Auto-correcting white balance — tested, does not work yet

Correcting colour cast before upload is appealing: it would make the app less
frustrating than warning the user and asking for a retake. It was tested against
the 2026-08-03 burst. **The result is negative, and one variant of it is
actively dangerous.**

**Never derive the correction from the face.** Matching each photo's face R/G
and B/G to a reference makes face colour ratios constant *by construction* —
which is precisely what the `redness` metric measures. A user's genuine
flare-up would be normalised away before the API ever saw it. This is the
"silently corrupts results" class of bug: the pipeline would keep running, the
charts would look cleaner, and redness would have become pure noise.

**Background-derived correction is safe in principle but unreliable in
practice.** Estimating the illuminant from non-face pixels leaves the face free
to vary. Face and background colour do track each other when the light is what
changed — within the varied burst the correlation is **0.91 (R/G)** and **0.83
(B/G)**, so the physics is real. But applying it, with the burst's first photo
as reference, moved face R/G toward the reference on only **2 of 5** photos:

| photo | face R/G before → after | vs reference 1.317 |
|---|---|---|
| IMG_7342 | 1.726 → 1.388 | better |
| IMG_7343 | 1.458 → 1.243 | better |
| IMG_7341 | 1.321 → 1.354 | worse (was already correct) |
| IMG_7344 | 1.294 → 1.161 | worse (was already correct) |
| IMG_7345 | 0.958 → **1.676** | overshot past the reference |

Mean absolute deviation improves 0.187 → 0.139, but that average hides a
correction that fires when it shouldn't and wildly overshoots the one photo that
needed it most. The cause is visible in the controlled set: background colour is
*noisier* than face colour (B/G spread 0.599 vs 0.276 across the 14 controlled
photos), because the background changes when the user moves — IMG_5892 has a
wildly off background (R/G 0.816) with a completely normal face. The estimator
is least trustworthy exactly when the user changes rooms, which is when the
correction is most needed.

**The camera has already applied its own auto white balance**, so what is being
measured is the *residual* after iOS AWB — partly the scene genuinely changing,
partly AWB reacting differently to different backgrounds. There is no recorded
illuminant to undo it with: `kMDItemWhiteBalance` is only an auto/manual flag,
and no colour temperature is available through the current toolchain.

**Better answer, same philosophy as the alignment overlay: lock it at capture.**
A native camera path can lock white balance, exposure, and focus
(`AVCaptureDevice`) so consecutive nights are captured under identical camera
settings rather than corrected afterward. That removes AWB as a variable instead
of trying to invert it, and it is far more reliable than any post-hoc estimate.

**If post-hoc correction is revisited**, it needs a genuine neutral reference in
frame (a grey card, or a known-neutral fixture the user includes each time).
That is the only estimator measured here that wouldn't be contaminated.

One design note on the reference itself: **"earliest photo in a rolling 2-week
window" injects a step change into the series every time the window advances**,
which is the `step-change` failure mode from `docs/trial-analysis.md` — a
discontinuity gets read as a trend. If a reference is used at all it
should be a pinned enrolment capture or a canonical target, not a rolling one.

### 3c. Screen flash as a controlled light source — promising, untested

Filling the screen with white at maximum brightness before the shutter (what
iOS calls Retina Flash) adds a light source whose colour and intensity are
**properties of the device rather than the room**. If it dominates the exposure,
the illuminant becomes constant across locations — which is the single largest
source of measurement noise in this project (Finding 1).

**Why it is likely to help:**

- A phone screen is a large-area source (~7×15 cm) at ~30 cm — angularly big,
  so the light is soft, not a hard point source like an LED flash.
- It is **on-axis** with the front camera, so what shadows it does cast fall
  mostly behind the subject from the camera's point of view. This is the ring
  light principle. **The shadow worry is largely unfounded** — soft plus axial
  is close to the best case.
- Screen white point is fixed per device (~D65), so it attacks the white-balance
  variance that §3b showed cannot be corrected after the fact.
- More light means lower ISO. Our worst measured capture was ISO 1000 at 1/15s;
  sensor noise at that setting is the likely cause of the texture and pore
  degradation, which white balance correction could never have fixed.

**The real risks, in order:**

1. **It only standardises if it dominates.** In a bright bathroom the screen
   might add a fraction of a stop; in a dark bedroom it might be the whole
   exposure. The effective illuminant then becomes a *mixture* whose proportions
   vary by room — potentially a new variable rather than a fix. This is the
   question the experiment below has to answer.
2. **Specular highlights.** A large bright frontal source reflects off oily
   skin — forehead, nose, cheekbones. That lands directly on `oiliness` and
   `radiance`, which Finding 1 already shows are the most lighting-sensitive
   metrics after texture and pore (oiliness 7.9 → 38.7, radiance 2.3 → 22.7
   between controlled and varied lighting). **A constant specular bias is
   acceptable** — it behaves like the device offset, and this product measures
   trends, not absolute scores. A bias that varies with room brightness is not.
3. **"Maximum brightness" is not a fixed quantity.** It varies by model and is
   modulated by auto-brightness, low-power mode, and thermal throttling.
   Auto-brightness must be overridden and the level set explicitly, or the
   "constant" source isn't constant.
4. **Distance matters, and the overlay already fixes it.** Screen illumination
   falls off as 1/r², so 25 cm versus 40 cm is a ~2.5× difference in
   contribution. The alignment guide constrains face size and therefore
   distance, which is what makes screen flash repeatable at all. **The two
   features depend on each other** — screen flash without the overlay would be
   inconsistent for reasons that look like biology.

**Recommended alongside, not instead of, good ambient light** — and the reason
is specific. Ambient keeps ISO low (sensor noise is what damages texture and
pore); screen flash standardises colour and direction. They fix different
things. In a fully dark room the screen becomes the only source, so the shadows
it casts under the nose and chin have no fill — which is the one case where the
shadow concern is real. Moderate, *consistent* ambient plus screen flash beats
either alone.

**Experiment to settle it (~12 units, not yet run).** Nothing in the existing
dataset uses screen flash, so this cannot be answered from the cache.

| environment | flash off | flash on |
|---|---|---|
| well-lit bathroom (the recommended setup) | 2 frames | 2 frames |
| dim room | 2 frames | 2 frames |
| near a window / outdoor shade | 2 frames | 2 frames |

The measurement that matters is **cross-environment spread**, not within-burst
spread: does the same face score the same in three different rooms with flash
on? If flash works, cross-environment spread should fall toward the
controlled-lighting noise floor (Finding 1). Watch `oiliness` and `radiance`
separately for a systematic flash-on offset, and check whether that offset is
constant across environments or scales with ambient brightness — constant is
fine, varying is disqualifying.

#### Capture protocol (parked — ready to run as written)

Everything needed to shoot this without re-deriving the design.

**Before starting**

- One device only, for the whole shoot. Cross-device offsets (Finding 2) would
  otherwise swamp the effect being measured.
- Turn **auto-brightness off** and set screen brightness to maximum manually.
  Confirm Low Power Mode is off — it caps brightness.
- Screen flash = a full-screen white image at max brightness, held up as the
  light source. The stock camera app's own front-flash setting is equivalent if
  the capture path uses it.

**Shooting**

- **Finish the whole set within ~30 minutes.** `oiliness` genuinely drifts over
  the course of a day, and a slow shoot would confound that drift with the
  effect under test.
- **Alternate conditions within each room** — flash off, flash on, off, on —
  rather than shooting all six flash-off frames first. Same reason.
- Hold distance and framing constant: face filling `TARGET_FACE_FRACTION` of
  frame height (0.80 as of 2026-08-09; was 0.55 when this protocol was
  written), centred, neutral expression, eyes open. If the
  alignment overlay exists by then, use it — that is what fixes the 1/r²
  term in §3c.
- 2 frames per cell, 12 total: 3 environments × {flash off, flash on} × 2.
- Environments: well-lit bathroom (the recommended setup), a dim room, and
  near a window or in outdoor shade.

**Naming and ingestion**

Name files `flash_<env>_<on|off>_<n>.HEIC`, e.g. `flash_bathroom_on_1.HEIC`,
with `<env>` one of `bathroom` / `dim` / `window`. Put them in a new
`sample-photos/flash-test/` folder; `prepare.mjs` currently only collects
`sample-photos/` and `sample-photos/today/` (line 108), so it needs one added
`collect(SRC_FLASH, 'flash-test')` call to pick them up.

Then the normal pipeline: `prepare.mjs` → `normalize-faces.mjs` →
`analyze-all.mjs --dry-run` to confirm **12 units** → `analyze-all.mjs`.

**Analysis — what to compute**

1. **Cross-environment spread per condition.** For each metric, the range of
   device-corrected `raw_score` across the three rooms, flash-off vs flash-on.
   This is the whole experiment. Success = flash-on spread falls toward the
   controlled-lighting noise floor (Finding 1: acne 7.5, texture 2.1,
   redness 10.4, age_spot 0.9, oiliness 7.9, pore 10.6, radiance 2.3).
2. **Within-cell spread**, as a sanity check that each pair is consistent.
3. **Flash-on offset for `oiliness` and `radiance` specifically**, per
   environment. Constant offset across rooms = acceptable specular bias,
   correctable like a device offset. Offset that scales with ambient brightness
   = disqualifying, per §3c risk 2.
4. **ISO and exposure per frame**, to confirm flash actually raised the light
   level (the EV100 calculation from §1) — if ISO doesn't drop in the dim room,
   the screen isn't contributing meaningfully and the result is uninformative.

**Advanced option, noted and not recommended yet:** flash/no-flash differencing
captures two frames back to back and subtracts them, isolating the
purely-screen-lit component and cancelling ambient mathematically. It is the
theoretically clean answer, but it doubles capture cost, breaks on any motion
between frames, and produces an image unlike anything the API was trained on —
face detection or the scoring models could behave unpredictably. Not worth it
before the simple version is measured.

### 4. Face size and framing — already computed

`computeCropBox()` in `src/face.mjs` already reports the `faceFraction` it
achieved, and `normalize-faces.mjs` already flags photos more than 0.05 off
target as `clamped` — which means the crop hit an image edge and the face could
not be scaled to match the others. That is the "too close / badly framed" signal,
already in the manifest.

- **Block** if no face is detected, or if the achieved face fraction cannot
  reach 0.55 (the API returns `error_src_face_too_small` below roughly 0.45, and
  face scale drives texture and pore — CLAUDE.md rule 3). In practice the live
  guide blocks well above this floor, at `TARGET_FACE_FRACTION` ±
  `FACE_FRACTION_TOLERANCE` (0.70–0.90 as of 2026-08-09) — see §5.
- **Block** if more than one face is detected at comparable size.

### 5. Framing and head pose — solved by an alignment overlay, not a threshold

**Built, as designed below** — `components/camera-capture.tsx` and
`lib/capture-guide.ts`, verified by `scripts/test-capture-guide.mjs`.

Perfect Corp's JS Camera Kit held this for a day and was removed (2026-08-08).
It worked, and it was still the wrong thing: slow to load, hard to satisfy at
STRICT's face ratio ≥ 0.75, no shutter — it auto-fired 800ms after its own checks
passed — and visually nothing to do with the rest of the app. What it charged for
those costs was pose tracking we can do from BlazeFace's six landmarks, which
`detectFace()` was already discarding. The retired contract and the memory bug it
took to make it run on a phone are kept in `docs/youcam-api.md`.

Worth flagging given what follows: `TARGET_FACE_FRACTION` was raised to 0.80
on 2026-08-09 (band 0.70–0.90), which sits at or above the exact STRICT
floor called "hard to satisfy" above. The two are not the same complaint —
Camera Kit's problem was the auto-fire and the missing shutter, not the ratio
alone — but if users start reporting the shutter rarely unlocking, this
paragraph is the first place to check.

**The frame is fixed and the user moves.** Every capture is cropped to the same
window — the largest 3:4 portrait rectangle in the camera's frame — with the
guide drawn inside it at `TARGET_FACE_FRACTION` and `FACE_CENTER_Y`. So a capture
that passes is already normalised, and face scale is constant by construction
rather than by correction. Nothing crops to fix a problem: a face too small means
step closer, because cropping in to hit the target discards exactly the
resolution texture and pore are measured from.

What gates the shutter, and what does not:

| | | source |
|---|---|---|
| face present, one face | blocks | §4 |
| face fraction 0.70–0.90 | blocks | `TARGET_FACE_FRACTION` (0.80) ± `FACE_FRACTION_TOLERANCE` (0.10), raised from 0.55 ± 0.15 on 2026-08-09 |
| centre within 0.06 of the guide | blocks | affordance, not a measurement threshold |
| roll ≤ 10°, \|yaw\| ≤ 0.15 | blocks | the inferred figures below |
| left/right light ratio | **reports only** | §2 — the baseline is the user's own, and there isn't one yet |

Lighting is deliberately the odd one out. §2's ratio is the best discriminator
measured here, but its baseline is ≈1.12 *for this user*, so there is no universal
band to gate on — and the open question at the foot of this document already leans
warn over block. It fires on the varied burst's extremes (0.88, 1.51) and stays
quiet across the controlled range (1.09–1.16). Once a user has a capture history
it should compare against their own rolling median, which is the check as
designed and is not built.

Checks 3, 6, 7 and 8 (light colour, sharpness, clipping, occlusion) remain
unbuilt.

The original design, which the above implements:

**Preferred design: a fixed face-alignment guide in the camera UI, with the
shutter enabled only while the face sits inside it.** This is prevention rather
than detection, and it is strictly better than scoring pose after the fact: a
rejected photo is a photo the user has to retake, whereas a guide gets it right
the first time. It also closes the validation gap below — if the face must be
inside the outline, framing and scale are constrained by construction and there
is nothing left to threshold.

**The guide's geometry is already defined by the constants the cropper uses.**
`src/face.mjs` normalises to `TARGET_FACE_FRACTION` (0.80 as of 2026-08-09,
was 0.55) at `FACE_CENTER_Y` 0.42 in a 1920×2560 frame. An overlay drawn to
exactly those numbers means a
compliant capture is *already normalised*: `computeCropBox()` never has to
clamp, no rescaling is needed, and the pixels-per-cm-of-skin that drives texture
and pore (rule 3) is constant by construction instead of by correction.

Two things this must get right:

- **The guide geometry is a versioned constant, like `TARGET_FACE_FRACTION`.**
  Changing it changes face scale, which invalidates every cached analysis
  (rule 3). It cannot be adaptive or "helpfully" resized per device.
- **An oval constrains position and scale but not rotation.** A user can sit
  inside the outline with their head turned. Add eye-line tick marks to the
  guide, and check roll/yaw against the landmarks live — the two together are
  what make the pose consistent.

This supersedes the **AR ghost-frame overlay** proposed by the original brief
(`docs/_archive/IDEA.md`) and since cut. A static guide is better than a ghost of yesterday's
photo for a specific reason: a ghost inherits yesterday's misalignment, so
errors compound over a series. A fixed target does not drift.

**Fallback thresholds, for photos that arrive without having gone through the
guide** (imports, or an archive series like the reference dataset):

| measure | across all 20 reference photos |
|---|---|
| roll (eye-line angle) | −3.4° to +4.9° |
| yaw (nose offset ÷ eye distance) | −0.08 to +0.03 |
| ear asymmetry | 0.00 to 0.32 |

The 6 landmarks BlazeFace already returns (eyes, nose, mouth, ears) come for
free; `detectFace()` still discards them server-side, but the live guide reads
them. **These thresholds cannot be validated on the current dataset** — all 20
photos are deliberate, well-posed selfies, so the range shows what *good* looks
like but says nothing about where the boundary is. The starting points now in
`lib/capture-guide.ts` (roll > 10°, |yaw| > 0.15) are inferred from the good
range, not measured against failures. `scripts/test-capture-guide.mjs` pins the
reference range as passing, which is the most that can honestly be asserted.

### 6. Sharpness — measured, and a global threshold does NOT work

Laplacian variance over the face box, across the 14 controlled photos:

| device | lapVar |
|---|---|
| iPad Pro | 21 – 39 |
| iPhone XS | 58 – 286 |
| iPhone 16e | 13 – 89 |

The variation is driven by device and in-camera denoising, not by focus. **A
single global blur threshold would reject every iPad photo in the dataset.**
Sharpness must be compared per-device against that device's own history, or
dropped. Recorded here mostly as a warning: this is the check most likely to be
implemented naively and silently reject a third of a user's photos.

### 7. Clipping — mostly not useful

Blown highlights were 0.0% on all 20 photos, including ISO 1000. Crushed
shadows reached 2.9% on the worst varied photo versus ≤0.7% on all controlled
ones — a weak signal, worth recording but not worth gating on alone.

### 8. Occlusion — the honest gap

Hair, a hand, or a mask over part of the face changes which skin is measured.
Landmark confidence gets partway there, but nothing measured here detects it
reliably, and the dataset contains no occluded examples. **Not designed yet.**
Do not claim it works until there is something to test it against.

---

## Where it goes in the pipeline

```
capture / archive photo
  → prepare.mjs        HEIC→JPEG, P3→sRGB, metadata          (exists)
  → QUALITY GATE       block / warn+confirm, records flags    [not built]
  → normalize-faces    crop to TARGET_FACE_FRACTION            (exists)
  → analyze-all.mjs    THE STEP THAT COSTS UNITS
```

The gate goes **before** analysis, which is the whole point. It should share one
BlazeFace detection with the normalisation step — detection is the expensive
part, and `face.mjs` already notes it runs unchanged in the browser, so the
same module can drive a live capture check.

For the live app the gate runs twice: on the camera preview (guidance before
the shutter — "move back", "you're side-lit") and on the captured frame
(the block/warn decision).

## The capture protocol

Everything above is what the gate can check *after* the shutter. This is what
the user is asked to do *before* it — the standard the checks exist to defend.
Stated here because it was previously only implied by the one-line UX principle
"same place, same time of day, same light," which is not enough to follow.

**One capture per day, in one fixed slot, held constant for the whole trial.**

### Time of day is a confound, not a preference

Skin is in a different state morning and evening. Sebum accumulates across
waking hours (`oiliness`, `radiance`); overnight recumbency redistributes
periorbital fluid (`eye_bag`, `dark_circle_v2`); pillow contact and overnight
hydration move `texture`. The *direction* of these is uncontroversial; their
**magnitude on these 15 metrics is unmeasured here**, and that is precisely the
argument for holding the slot constant rather than trying to correct for it.
There is no `correctForTimeOfDay()` and there should not be one until somebody
measures the offset.

So: **never mix capture slots within one series.** This is the same class of
error as mixing crop scales (CLAUDE.md rule 3) or devices (rule 6) — a
systematic step injected into a series that a slope is going to be fitted
through. Unlike the device case, no correction exists, so the only remedy is
prevention.

Two internally-consistent parallel series (all-AM and all-PM) would be
defensible in principle and is how you would *measure* the offset. It doubles
both the unit cost and the logging burden for the whole length of a trial, for a
comparison no trial is currently asking. Not recommended.

### Post-cleanse, pre-product — and the optical film trap

The capture goes **after cleansing, before applying anything.**

The failure this prevents is worth naming because it produces a convincing fake
result. Photographing skin through a fresh layer of product measures the
product's optical film — sheen, wetness, light scattering — not the skin under
it. `oiliness`, `radiance`, and `moisture` would move on day 1, stay moved for
the length of the trial, and read as a large, fast, sustained effect exactly
where the intervention predicted one. Nothing in the pipeline can distinguish
that from a real change; the scores are genuinely different, they are just
measuring the wrong surface.

This also makes the *morning* the better slot for a PM intervention: after an
overnight interval and a cleanse, the face is naturally clear of the product.
An evening capture taken after the daily routine is the trap above; taken
before it, it competes with variable evening lighting instead.

### The standard

Fixed across every capture in a trial:

| | Standard | Why |
|---|---|---|
| **Slot** | Same time of day, ±~1 hour | Above. Unmeasured, uncorrectable offset |
| **Light** | Same room, same fixed source. One controlled lamp beats a window | Finding 1: varying light took texture noise 2.1 → 57.6 |
| **Products** | After cleanse, pat dry, fixed wait (5 min, timed), nothing applied | The optical film trap |
| **Device** | Same phone, same camera | Rule 6: up to 90 points cross-device |
| **Framing** | Alignment overlay, `TARGET_FACE_FRACTION` ± `FACE_FRACTION_TOLERANCE` (0.70–0.90) | §4, §5 |

Consistency dominates the specific choice on every row except products, where
pre-application is not arbitrary. A user who cannot hold a row constant should
be told which one they broke and what it costs — not silently accommodated.

### Capture is free; analysis is not

These are two loops and should not be coupled:

- **Photographing costs nothing.** Only `analyze-all.mjs` bills units.
- Analysis is **order-independent and cache-backed**, so it can be run in one
  batch, later, over an accumulated set.

The consequence for a live trial: capture every day from day 1 and defer the
analysis decision. Nothing is lost by analysing late; a day that was not
photographed is gone permanently. Compliance (`docs/trial-model.md`) is a
property of the *capture* timestamps, not of when analysis ran.

This matters concretely at current quota. At 16 units per HD capture with ~468
remaining, the whole budget buys **~29 analyses**, fewer at 15 concerns — well
short of a 100-day daily trial, and it is the same pool the demo needs. The
photographs are not subject to that limit.

Same logic applies to the day-1 **baseline burst** (3 frames ~30 s apart, for
`noise-floor.mjs`): shoot it on day 1 regardless, decide about the ~48 units
later. It is the one capture that cannot be taken retroactively.

### A free gate check falls out of this

Capture time is already in EXIF, so **slot consistency is checkable for free**,
alongside check 1 — the deviation of this capture's local time-of-day from the
rolling median of the user's history. No pixels, no API call. It belongs in the
warn tier: a user who genuinely shifts schedule should be able to override, but
should be told they are introducing a step the pipeline cannot correct.

## Cold start and the calibration period

The consistency checks (1, 2, 3) compare against the user's own history and
cannot run until there is one. For roughly the first 3–5 captures, only the
absolute checks apply (face present, inside the alignment guide, gross
exposure). The baseline should be a rolling median over recent captures rather
than a fixed first-week snapshot, so a user who genuinely relocates converges
instead of being warned forever.

This is also the strongest moment for guidance rather than gating: same place,
same time of day, same light, before there is anything to be consistent with.

### How many nights before the first forecast — measured

Running the real engine over the first *k* nightly captures (400 noise draws
each, floor 7.5, true trend +1.5/day):

| nights | OLS blend | median trend | conf@7d | median &#124;err@7d&#124; | err > floor | **wrong sign** |
|---|---|---|---|---|---|---|
| 2 | no | +0.02 | 56% | 10.8 | 86% | **38%** |
| 3 | no | +0.12 | 57% | 10.6 | 83% | **31%** |
| 4 | no | +0.28 | 57% | 10.1 | 73% | **23%** |
| 5 | **yes** | +1.00 | 67% | 6.7 | 45% | 11% |
| 6 | yes | +1.27 | 70% | 4.8 | 32% | 4% |
| 7 | yes | +1.37 | 73% | 3.9 | 24% | **1%** |
| 8 | yes | +1.47 | 74% | 3.8 | 17% | 0% |
| 10 | yes | +1.55 | 77% | 3.3 | 9% | 0% |
| 12 | yes | +1.53 | 78% | 2.9 | 4% | 0% |

Three things fall out of this:

1. **Nights 2–4 are worse than useless and the engine does not know it.**
   Against a real +1.5/day improvement it reports ≈0 trend, gets the *direction*
   wrong in 23–38% of draws — and still scores 56–57% confidence, which is above
   the 50% cutoff. **As the code stands today it would show that forecast.**
   A minimum-captures gate is not a UX nicety; it's the fix for a real defect.
2. **Night 5 is the natural threshold, non-arbitrarily.** It is exactly where
   `blendTrend()`'s ≥5-point guard engages, and the step is sharp: trend
   +0.28 → +1.00, error over floor 73% → 45%, wrong sign 23% → 11%.
3. **Night 7 is where it becomes trustworthy** — 24% over floor, 1% wrong sign.
   5 makes a forecast *possible*; 7 makes it *honest*.

**Recommended: gate the forecast at 7 captures**, show the metric graph from
night 1, and show progress toward the forecast as `[3/7]`. Optionally unlock a
deliberately hedged forecast at 5.

**One trap when reading this table:** on a genuinely *flat* series, nights 2–4
look excellent (1–3% over floor). That is not skill. The engine reports ≈0 trend
for everything at that point, and "no change" happens to be right when there is
no change. Do not use early flat-series accuracy as evidence the cold start
works.

### The noise floor needs bursts, and bursts cost units

`computeNoiseFloor()` only counts sessions with **more than one photo** — the
spread within a burst is the measurement. A user who takes exactly one photo per
night therefore never establishes a noise floor, and the floor is load-bearing:
it sets `q` and `r` in the filter, defines confidence, and decides the
REAL/marginal/below-noise verdict.

Each burst frame is a separate analysis and therefore a separate unit, so this
is a real cost, not free. Options, cheapest first:

- **Ship the measured population defaults as a prior** (Finding 1's controlled
  row: acne 7.5, texture 2.1, redness 10.4, age_spot 0.9, oiliness 7.9,
  pore 10.6, radiance 2.3) and personalise later. Free, and honest as long as
  the UI doesn't claim the floor is the user's own yet.
- **Burst only during the calibration period.** 3 frames on nights 1 and 7,
  say — 4 extra units total to establish a personal floor during exactly the
  window where the app isn't forecasting anyway.
- **Periodic re-burst** (every ~30 nights) to track drift, since the floor is
  really a property of the user's current capture setup, not a constant.

Bursting *every* night triples the running cost for a quantity that changes
slowly. Not worth it.

## What gets recorded

Every capture stores its measured quality signals and any flags raised,
regardless of outcome. Reasons:

- The forecast can exclude or down-weight flagged photos — the capture-side
  replacement for innovation gating in the filter.
- `noise-floor.mjs` currently derives the floor from same-session spread. With
  quality flags recorded, the floor can be derived from *clean* sessions only,
  which makes it a description of the instrument rather than of the worst day.
- A user who repeatedly triggers the same warning should get better guidance,
  not the same modal.

## UX principles

- **Say what changed and why it matters**, in measured terms: "this photo is
  about 4 stops darker than your usual" beats "poor quality."
- **Recommend the fix up front**, not after a bad reading: same place, same
  time of day, same lighting, nothing applied to the face. The capture standard
  is the measurement, not UI polish (Finding 1). Full protocol above, "The
  capture protocol" — onboarding should teach it once rather than surface it as
  warnings later.
- **Warnings must be dismissible.** The user knows things the app doesn't.
- **A flagged photo that the user keeps should stay visible as flagged** in the
  history, not quietly excluded.

## Product shape: passive calibration

The gate, the alignment overlay, and the capture-count threshold add up to an
onboarding rather than a set of error messages. The model is an app the user
uses passively to understand themselves, where accuracy visibly improves with
use:

- **Night 1 onward:** the metric graph is drawn immediately. There is always
  something to look at.
- **Nights 1–6:** no forecast. Progress is shown as `[3/7]` toward the first
  prediction, so the absence is a countdown rather than a missing feature.
- **Night 7:** the first forecast unlocks, with the confidence the data
  actually supports.
- **Beyond:** resolution keeps improving with the observed span, since slope
  precision goes as `σ / (sd_x · √n)` — both terms grow with more, and
  more-spread-out, captures (`docs/trial-analysis.md`, "The gate").

This turns the honest limitation — the app genuinely cannot resolve a change
from 3 photos — into the reason to keep using it. It also matches the
credibility principle in CLAUDE.md: an app that declines to conclude reads as
instrumentation. A countdown is that refusal, made legible.

> **Reframed after the pivot.** This was written as "nights until your first
> forecast." There is no forecast now, so it is "nights until the app can
> resolve a change of size X" — which is the same measurement with an honest
> label, and it is stated at trial creation rather than discovered later
> (`PRODUCT.md` §5).
>
> The old caveat here — that on a plateau, *forecast* error grows with more
> data because full-history OLS keeps early steep gains in the fit forever
> (43% of draws over the noise floor at 5 nights, 78% at 11) — no longer
> applies as an overpromise, because nothing is being projected. The
> underlying shape problem survives in weaker form: a single whole-window
> slope still describes a plateau badly. The answer is segmented narration
> (describe the phases) rather than the deferred recent-window OLS, which was
> a forecasting fix. See `docs/trial-analysis.md`, "Shape, not slope."

## Open questions

- Warn or block on lighting deviation? Current lean is warn — a blocked photo
  the user believes is fine is worse than a flagged one they can override.
- Should a flagged photo be excluded from the forecast outright, or down-
  weighted (higher observation variance `r` for that point)? Down-weighting is
  more principled and fits the Kalman filter directly; exclusion is easier to
  explain. Undecided.
- Does the noise floor need recomputing per lighting condition, rather than one
  floor per metric? Finding 1 suggests the floor is really a function of capture
  quality, not of the metric alone.
- How large is the morning/evening offset actually? Unmeasured, and the protocol
  above sidesteps it rather than answering it. A parallel AM/PM series over ~2
  weeks would measure it, at double unit cost. Worth knowing eventually, because
  it also bounds how much slot drift the warn tier should tolerate.
- Does screen flash dominate enough to standardise across rooms (§3c)? Needs the
  ~12-unit experiment; it is the highest-value unit spend currently identified,
  because a positive result would make the app robust to location changes that
  the quality gate can otherwise only warn about.
