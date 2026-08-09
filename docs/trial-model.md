# The trial model

How a trial is structured, what gets attributed to what, and how compliance
enters the result. This is the conceptual core of the product — the analysis
engine that consumes it is [`trial-analysis.md`](trial-analysis.md).

Status: **designed, not built.** No code implements this yet.

---

## The central idea

> A trial is a **delta on a routine**, not a routine.

Nobody runs a clean single-variable experiment on their own face. You already
use a cleanser, a moisturiser, sunscreen; you add a retinoid; you don't stop
everything else first. Any model that pretends otherwise will either refuse to
run or produce attributions it can't support.

So the model splits what you use into two categories with different jobs:

- **Baseline routine** — acknowledged, never attributed. It exists to constrain
  which explanations are admissible.
- **Tracked interventions** — the thing under test. Only these can receive
  credit.

The rule for which is which is simply *what changed at the start of this trial*.
Anything not tracked is assumed to have been in use already.

### Why the baseline matters even though it isn't tested

Concretely: someone starts isotretinoin and keeps using a moisturiser they were
already using. Moisture goes up over the trial.

Without a baseline model, the summary says *"isotretinoin improved your skin
moisture."* This is not merely unsupported, it is backwards — isotretinoin is
notorious for drying skin out, and the moisturiser is almost certainly doing the
work, possibly against the drug.

With a baseline model, the app knows something untracked targets moisture, and
reports the improvement as **observed but unattributed**. That single
distinction is the difference between a measurement and a fabrication.

---

## Trial structure

```
Trial
├─ window
│   ├─ startDate
│   ├─ endDate              null = open-ended; a set date is a marker, not a lock
│   └─ endDateSource        'clinician' | 'product-claim' | 'user-chosen' | null
├─ routine
│   ├─ baseline[]           acknowledged, not attributed
│   └─ interventions[]      the delta under test
├─ captures[]
│   ├─ [0] initial capture — analysed, the trial's starting measurement
│   ├─ [1..n-1] daily logs  — stored and shown, never analysed (2026-08-08)
│   └─ [n] final capture    — analysed at trial end; fresh, or the most
│                              recently logged photo, retroactively
└─ summary                  generated when the user ends the trial
    ├─ perMetric[]
    ├─ narrative            LLM, gated by the measurement
    └─ userNote             free text, written by the person
```

### Interventions

```
Intervention
├─ direction        'add' | 'remove'
├─ name             free text: "Paula's Choice 2% BHA", "Accutane 40mg"
├─ startedOn
└─ targets[]        analysis concern keys
```

**A removal is its own trial, not a `direction` on an intervention.** *Stop the
vitamin C serum and watch redness* is a real experiment and nothing else on the
market supports it — but starting and stopping inside one log makes the series
ambiguous about which regime any given capture belongs to. The pattern is a new
trial whose baseline is the routine *without* the product and whose
`interventions[]` is empty.

The cost is explicit: **a trial with no interventions can attribute nothing.**
Every metric falls to `confounded` or `unexplained`, so the summary reports what
moved and never credits the removal. What changed lives in the trial's name,
which is free text and never enters the maths. That is a real loss of
resolution, accepted in exchange for a series with one unambiguous regime.

`direction` stays on the model, always `'add'` from the new-trial form. It costs
nothing and the dashboard already renders `−`.

**`targets[]` must be analysis concern keys**, routed through
[`../src/concerns.mjs`](../src/concerns.mjs) — never free text. Getting these
from a product name is an LLM classification into a fixed 15-way vocabulary with
user confirmation, not open generation. See
[Deriving targets](#deriving-targets-from-a-product) below.

`endDateSource` is recorded because it changes the summary's framing, not the
maths. A clinician-set nine-month window and a label-set fourteen-day window
deserve different opening sentences.

### The end date is a marker, not a lock

**A trial runs until the user ends it, and the summary is generated then.** A
duration set at creation is a marker the UI can count toward; it never closes
the trial and never blocks further captures. Open-ended is available and fully
supported, but it is not the default — the form pre-fills 30 days, because
handing someone a sensible starting point beats making them guess.

The reason a fixed end date once looked mandatory was optional stopping —
choosing your endpoint after seeing the data. It costs almost nothing here,
because mid-trial metrics are shown in full by design: the user watches the
whole series as it accrues, so stopping on a good day reveals nothing that was
not already on screen. What it does cost is framing. A summary is a
retrospective on a log the user chose to close, and must never be written as
though the endpoint had been committed to in advance.

### Ending is final, and the duration can only grow past what happened

Two rules on the lifecycle. Both exist so that the day counter can never
contradict the log underneath it.

- **An ended trial cannot be reopened.** No resuming, no "just one more photo,"
  no un-ending. Its summary describes a closed window; adding captures
  afterwards would mean a published retrospective silently stops matching its
  own data. Picking the routine back up is a **new trial**, which is also the
  honest description of what that is.
- **The duration is editable while the trial runs, but never below the days
  already logged.** `Day 10 of 7` is not a state the app can render or a claim
  it can defend, so the floor on any edit is the current day number. Raising it
  is always allowed; the end date was only ever a marker.

Neither rule restricts what the user can do — they can stop whenever they like
and extend as far as they like. They restrict only the two edits that would
produce an incoherent record.

The maths is indifferent. `se(slope)` is computed from the real capture
timestamps at whatever moment it is asked, so an open window needs no planned
length.

---

## Attribution

Evaluated **per metric**, at summary time. Let `T` be the set of tracked
interventions whose `targets[]` include this metric.

| Condition | Attribution | Summary treatment |
|---|---|---|
| `|T| == 1` | **attributed** | Named. "Your BHA is the only thing here targeting texture." |
| `|T| > 1` | **shared** | Real effect, unsplittable. All contributors named, explicitly. |
| `|T| == 0`, baseline targets it | **confounded** | Change reported, credit withheld, background named. |
| `|T| == 0`, nothing targets it | **unexplained** | Reported as a possible side effect. |

Two notes on the edges.

**`shared` is not a failure.** Adding two products at once is what people
actually do. The honest output is *"moisture improved 6 points; both the
hyaluronic serum and the new moisturiser target moisture, so this can't be
split between them."* That's a real finding stated at its true resolution.
Trying to split it would be invention.

**`unexplained` is often the most valuable row.** Nothing was targeting it, and
it moved anyway. Isotretinoin drying your skin out shows up here — as a real,
large, unpredicted change in a metric the trial was never about. This is the
entire argument for collecting all 15 metrics on every scan regardless of what
the trial targets.

### Attribution is correlational, always

There is no control face. A trial cannot support a causal claim and the copy
must never make one. The strongest defensible statement is temporal and
comparative: *"texture was flat before this, and improved at X points/day
after."* Never *"this product caused."*

This is not legal hedging, it's accuracy. One person, one routine, no control —
that's a case study, and case studies are worth publishing as long as they're
labelled as such.

---

## Compliance

> **Correction, 2026-08-08: this section's maths never gated the live
> product, and now it structurally can't.** The minimum-detectable-effect-
> from-timestamps design below was never wired into `lib/summary.ts` or
> anything under `app/` — the live gate (`lib/trial-detail.ts`) has always
> been a plain day-1-vs-latest comparison against a fixed wobble, with no
> timestamp weighting (see `docs/trial-analysis.md`'s correction note for the
> full story). And since only a trial's initial and final photo are ever
> analysed now (not every daily log), there is no capture-timing pattern left
> to weight in the first place — "logged 8 of 14 days, all in the first
> week" isn't a sampling-density problem for a two-point measurement.
>
> **What daily logging is for now: engagement, and choosing the final
> photo.** The ratio badge, the calendar, and the nudges below are all still
> worth having — they're just honestly a streak/engagement feature rather
> than a statistical-precision one. The one place logging frequency still
> has real teeth: ending a trial without taking a fresh final photo reuses
> whichever photo was logged most recently, so a longer gap since the last
> log means a staler final measurement, and logging nothing at all since day
> one means the trial ends **inconclusive** (`PRODUCT.md` §6).

### Two numbers, both shown

**The ratio** (`8/14`) is the human-readable badge. People parse it instantly
and it belongs on the card.

**The minimum detectable effect** is what actually gates the conclusions. It is
computed from the real capture timestamps, so it accounts for something the
ratio cannot see: *when* you logged.

### Why clustering matters as much as count

Slope precision goes as `σ / (sd_x · √n)`, where `sd_x` is the standard
deviation of the capture *times*. Clustering your captures shortens the lever
arm, which widens the error bars independently of how many you took.

Against a perfectly-logged 14-day trial:

| Pattern | `sd_x · √n` | Error bars |
|---|---|---|
| 14 of 14, daily | 15.08 | 1.00× |
| 8 days, evenly spread across the window | 12.03 | 1.25× |
| 8 days, all consecutive at the start | 6.48 | **2.33×** |

Both middle and bottom rows show `8/14`. One is nearly as good as perfect
compliance; the other is more than twice as bad. This is why the ratio alone
can't gate anything.

### Compliance goes in the summary, not just the badge

The narrative states the sampling pattern in words:

> You logged 8 of 14 days, all in the first week. The second half of this
> window is unsampled, so this result describes your first week more than your
> fortnight.

Naming the weakness inside the conclusion is more trustworthy than a green
checkmark that hides it, and it costs nothing. This is the same principle as
reporting "no measurable change" instead of a fabricated small delta.

### Planned UI

A mini calendar strip — one dot per day, filled for logged — under each trial.
Over a nine-month run, the shape of adherence is legible at a glance in a way no
percentage is. Deliberately noted here as a design target rather than left to be
rediscovered later.

### In-flight nudges

Because the app can compute what each remaining day is *worth*, it can nudge
with a reason instead of guilt:

> You've missed 3 days, all in the last week. Logging tomorrow and Thursday
> recovers most of your resolution.

Not built. Noted because it falls out of the maths for free and no other app can
do it.

---

## Deriving targets from a product

Full design in [`product-identity.md`](product-identity.md). The chain:

1. The user enters, scans, or photographs the product.
2. A classifier maps it to a **ranked** subset of the 15 analysis concerns, and
   — if the label makes a time-bound claim — proposes an end date.
3. **The user confirms or edits.** Always.

This is constrained classification into a fixed vocabulary with human
confirmation in the loop, which is a defensible use of a language model. Open
generation of concern names or efficacy claims is not, and isn't needed: every
key is validated against [`../src/concerns.mjs`](../src/concerns.mjs) and an
unrecognised one is dropped rather than passed through.

**Ingredients inform attribution, never measurement.** This distinction is the
whole of it. Scores come from photographs; no ingredient list may adjust,
weight, or explain one. What an ingredient list *can* do is make `targets[]`
cheaper and more consistent to fill, which is an input to who gets *named* next
to an observed change — a different job entirely. An earlier version of this
document collapsed the two and concluded no product data was worth keeping;
that was wrong about attribution and right about measurement.

So there **is** a product database, built incrementally from what users scan,
and it is worth keeping. It caches derived targets per product so the second
person to scan a moisturiser doesn't re-derive it, keyed on a hash of the
normalized ingredient list rather than a barcode. Two rules from
[`product-identity.md`](product-identity.md) carry real weight here:

- **Bias narrow.** Over-broad targets are worse than sparse ones. Sparse targets
  push real effects into the `unexplained` row, where they are visible and
  correctable; broad targets make `|T| > 1` fire on every metric, so nothing is
  ever attributable and the table above stops saying anything.
- **`targets[]` freezes at trial creation.** A cache refresh or classifier
  upgrade must never reach into a running trial. Changing targets mid-flight
  retroactively rewrites attribution — a metric that was `unexplained` on day 1
  becomes `attributed` on day 40 with no new measurement.

Nothing in [`youcam-api.md`](youcam-api.md) covers product recognition; this is
outside the YouCam surface entirely, and off the unit budget.

---

## The 15 metrics

Every capture records all of them. Canonical keys and mapping live in
[`../src/concerns.mjs`](../src/concerns.mjs). `skin_type` is a real
`dst_actions` value too, but it returns a category (Normal/Oily/Dry/
Combination/Redness and compounds), not a score — deliberately excluded from
this table and from `ANALYSIS_CONCERNS` until it has its own path.

| Concern | In the reference dataset? |
|---|---|
| `acne` | ✅ |
| `texture` | ✅ |
| `redness` | ✅ |
| `oiliness` | ✅ |
| `radiance` | ✅ |
| `pore` | ✅ |
| `age_spot` | ✅ |
| `wrinkle` | ❌ |
| `eye_bag` | ❌ |
| `dark_circle_v2` | ❌ |
| `moisture` | ❌ |
| `firmness` | ❌ |
| `droopy_upper_eyelid` | ❌ |
| `droopy_lower_eyelid` | ❌ |
| `tear_trough` | ❌ |

The cached 20-photo reference set contains only the first seven — the analysis
pass predates this design (and predates `tear_trough` entirely, added
2026-08-09). **It will not be backfilled**: HD is 16 units for up to 7
concerns and an 8th likely crosses a tier, so re-analysing 20 photos at 15
concerns costs roughly 400 of ~468 remaining units.

Consequence, and it is a real one: the eight un-cached metrics have **no
measured noise floor and no device offset**. Moisture — the metric that
motivates the whole baseline-routine concept — cannot currently be validated on
real data. The demo runs on 7 metrics; live trials collect 15 and derive their
floors per-user (below).

If the 15-concern tier price is needed before committing, one photo at 15
concerns reveals it for ~20 units.

---

## Per-user noise floor

A live trial is single-device, which mostly removes the cross-device confound
(`measurements.md`, Finding 2) — it returns only if someone changes phones
mid-trial, which must be recorded and either corrected or visibly marked.

It does not remove the need for a noise floor, and the reference floors don't
transfer: they were measured on one face, on three specific devices, under one
set of lighting conditions.

**The fix is a baseline burst.** Three captures in ~30 seconds on day 1 give
that user their own instrument noise floor, on their own phone, in their own
bathroom. `src/noise-floor.mjs` already computes exactly this from same-session
spread.

The cost is real and should be decided deliberately: 3 analyses ≈ 48 units per
trial. Options are to require it, offer it as a "calibrate for sharper results"
step, or fall back to the reference floors with a visible caveat. Undecided.

Note this measures *instrument* noise only. Day-to-day biological scatter runs
1.1–3.4× larger (Finding 5) and cannot be measured on day one by construction —
it needs consecutive days. Until a trial has those, use the conservative
multiplier and say so.

---

## Open questions

- **Mid-trial routine changes.** Someone adds a product in week 3 of a 9-month
  trial. Split into two trials, add an intervention with a later `startedOn`, or
  mark a discontinuity? Leaning toward the second, since `startedOn` already
  exists and segmented analysis is already needed for purge detection.
- **Trial abandonment.** Distinct from ending early, which is now the normal
  way a trial finishes. Abandonment is a trial nobody closed and nobody logs to
  — it needs a visible state, not a summary.
- **Overlapping trials.** Two concurrent trials on different concerns share a
  photo stream. The captures are reusable; the attribution sets are not
  independent.
- ~~**Whether `endDate` should be editable.**~~ Resolved 2026-08-05: the window
  is open-ended by default and a set end date is a marker, not a lock. See
  [The window is open-ended by default](#the-window-is-open-ended-by-default).
