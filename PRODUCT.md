# Grapht

> **Tagline:** Run a real trial on your own skin, and find out what actually
> changed.

This is the design of record. It replaces the previous product brief
(`IDEA.md`, "DermaCast AI"), which was a *predictive* trajectory engine. That
direction was retired — see [What changed and why](#8-what-changed-and-why) at
the bottom for the measurements that killed it.

---

## 1. The product in one paragraph

You change something in your skincare routine. You log a standardised selfie
each day and watch your metrics move, for as long as you want to. When you
decide you've seen enough, the app tells you what measurably changed, what
didn't, and what it could not tell either way — then writes a plain-language
summary of the whole run, which you annotate in your own words and keep. If you want, you publish it: a review backed by daily
photographs, fourteen quantitative metrics, a compliance record, and an explicit
statement of measurement error.

The thing being tested is **your routine**, not a brand's claim. Nobody is
issuing a verdict on anyone.

---

## 2. The problem

Skin changes too slowly for human vision to track. A 1% daily improvement is
invisible in a mirror and invisible in a phone selfie, so people fall back on
vibes: *I think it's working?* That single failure produces every downstream
problem worth solving.

- **You can't tell if a product is working**, so you either quit something
  effective at week two or keep paying for something inert for a year.
- **You can't tell what a treatment is doing to you while it's happening.**
  Nine months of isotretinoin is a long time to go on faith, especially through
  the first six weeks when it makes your skin visibly worse before it gets
  better.
- **Reviews are useless.** "My skin looks amazing now" is one person, one
  routine, zero controls, no baseline, no timeline, no error bars — and no way
  to know if they'd have said the same thing about a placebo.

Existing apps are passive logbooks that draw a line through noisy points and
call it a trend, or beauty filters that erase the thing being measured. Neither
knows how wrong it might be.

## 3. What makes this different

**The app knows its own measurement error, and says so.**

That is the entire product. It is why a summary here means something and a
5-star review doesn't. Every number is reported alongside whether the app can
actually resolve a change that size, given how noisy the instrument is and how
consistently you logged. Metrics that didn't clear the bar are reported as *"no
measurable change"* — which is a statement about the instrument, not a verdict
on the product.

An app that says *"I can't tell"* reads as instrumentation. An app that always
has an answer reads as a horoscope. Preserve this behaviour; it's load-bearing.

---

## 4. The trial

A **trial** is the core object. It is a *delta on a routine*, measured over a
fixed window with a known instrument.

Full data model in [`docs/trial-model.md`](docs/trial-model.md). The shape:

| Element | What it is |
|---|---|
| **Baseline routine** | What you were already using. Acknowledged, never attributed. |
| **Tracked interventions** | What you're adding. Empty on a removal trial. |
| **Window** | A start date. An end date if you want one, otherwise it runs until you end it. |
| **Initial photo** | Day 1, analysed immediately — the trial's starting measurement. |
| **Daily logs** | A photo every day, encouraged throughout — stored and shown in the timeline, but not analysed. Cost is the reason: see §5. |
| **Final photo** | Analysed once, when you end the trial — fresh if you take one there, otherwise the most recently logged photo. |
| **Summary** | Generated when you end the trial, annotated by you, optionally published. |

**Amended 2026-08-08: only the initial and final photo are ever analysed.**
Every daily capture used to run the full analysis; at real usage (twice a day
for a month) that's roughly $60/user/month, which the product cannot charge
anyone. A trial now costs a flat ~2 analyses no matter how long it runs or how
often you log — see §5 and §6 for what this changed, and §8 for the reasoning
that got retired along with it (the daily-analysed series was also what made
"shape, not slope" possible; a two-point trial has no shape to narrate).

Three things make this model work.

**The window is yours, and it can stay open.** A dermatologist said nine months.
A bottle said fourteen days. You guessed three weeks, or you'd rather just track
it and see. The app doesn't argue and doesn't set expectations up front — it
records what you chose, shows you the metrics as they move, and reports what it
measured when you stop.

**Background routine constrains explanations without being tested.** If you're
on isotretinoin *and* using a moisturiser you'd already been using, and moisture
goes up, the app must not credit the isotretinoin — which dries skin badly. It
knows something in the background targets moisture, so that improvement is
reported as observed and unattributed. Untracked means "assume already in use."

**Removals are supported, as their own trial.** *Stop the vitamin C serum, watch
redness for three weeks* is a real experiment and nothing else does this. It is
filed as a trial whose routine omits the product and whose tracked list is
empty — not as a start-and-stop inside one log, which would leave the series
ambiguous about which regime each capture belongs to. Such a trial attributes
nothing by construction; see [`docs/trial-model.md`](docs/trial-model.md).

### Attribution

Per metric, count the tracked interventions that target it:

| Targeting interventions | Verdict |
|---|---|
| exactly one | attributable to that intervention |
| more than one | real effect, credit shared, flagged as unsplittable |
| none, but the background routine touches it | observed, not attributed |
| none anywhere | observed, unexplained — a possible side effect |

That last row is frequently the most valuable output. Side effects show up in
metrics nobody was targeting, which is exactly why the app measures everything
every time rather than only what the trial is about.

---

## 5. Measurement discipline

### Every metric, on both analysed scans

Fourteen analysis concerns are recorded on every capture that gets analysed,
regardless of what the trial targets. Billing is tiered per task, not per
metric, so narrowing the set saves nothing; side effects live in untargeted
metrics; and you cannot retroactively ask a question of data you never
collected. Targeting decides what gets *narrated*, never what gets
*collected*. Since 2026-08-08 that's a maximum of two scans per trial — the
initial and final photo — never a daily log; see §4.

### Daily logging is for engagement and for choosing your final photo, not statistics

Before the pivot, logging 8 of 14 days fed directly into the maths — *when*
you logged changed the precision of a fitted slope. That machinery never
actually shipped in the live app (`docs/trial-analysis.md`), and it's moot
regardless now: with only two analysed points, there's no slope to fit and no
sampling pattern to weight.

What daily logging still buys you: a photo record of the whole run, worth
having on its own; and, practically, it's what "final photo" falls back to —
end a trial without taking a fresh photo and the app uses whichever one you
logged most recently, so logging more often means a fresher, more relevant
final measurement if you forget to take one on purpose. A trial with nothing
logged past day one has nothing to fall back to and ends **inconclusive** —
see §6.

### Detection is a before/after comparison against the camera's own wobble

There is no fitted trend and no minimum-detectable-effect-from-timestamps
calculation — that was only ever designed, never live (`docs/trial-analysis.md`).
The real gate, in `lib/trial-detail.ts`, is simpler: **initial score vs. final
score**, called measurable only if it moved further than the camera's own
measurement wobble (2× the spread between two photos taken seconds apart under
held lighting — `WOBBLE` in that file, sourced from `docs/measurements.md`,
Finding 5). Below that, it's reported as *no measurable change* — a statement
about the instrument, never about whether something happened.

**Every trial length is legitimate.** A big fast change clears the wobble in a
week; a slow drift needs the gap between initial and final to be wide enough
to separate from camera noise. The app's job is to report what the two photos
it has could and could not resolve, never to talk someone out of running a
trial at whatever length they choose.

**Nothing about resolvability is stated at trial creation.** The user is there to
find out what happens, not to be told in advance what they are unlikely to find
(`docs/app-ui.md` §4).

---

## 6. The summary

Generated when the user ends the trial — a retrospective on the log, not the
reason the log existed. Three layers, in order:

1. **The numbers.** Per-metric start, end, delta, and whether it cleared the
   detection bar. The photo timeline.
2. **The narrative.** An LLM-written account of what the two measured photos —
   initial and final — say. **Amended 2026-08-08:** with only two analysed
   points there is no shape to narrate, only a before/after; the earlier design
   here described a fitted trend finding a purge/trough mid-run, which needed a
   daily-analysed series that no longer exists (and, per
   `docs/trial-analysis.md`, was never actually wired into the live app in the
   first place). The daily photos and notes the user logged in between are
   still real and still shown in the timeline — the narrative just can't put a
   number on them.
3. **Your words.** A free-text note. How it felt, what the numbers missed, what
   you'd tell someone considering the same thing.

**A fourth, non-narrative outcome: inconclusive.** If the trial ends with
nothing analysed beyond the initial photo — no final photo taken and nothing
logged since day one to fall back to — there is no second measurement to
compare against. The app says so plainly rather than writing a summary from
one data point, and offers a standing invitation to add a final photo later,
which resolves it retroactively.

The narrative is constrained by the measurement, not free-running. Rules in
[`docs/trial-analysis.md`](docs/trial-analysis.md):

- A metric that didn't clear its detection bar is described as unchanged. It
  never receives a story, a percentage, or a direction.
- A metric with more than one targeting intervention is never credited to one.
- A metric the background routine touches is never credited to the trial.

This is what keeps the summary from being fiction. The generator can only narrate
what survived the gate — and, since 2026-08-08, is refused outright on an
inconclusive trial rather than asked to narrate a single point.

---

## 7. Sharing

Optional, and the reason the quantitative discipline matters beyond one user.

A published trial carries **the whole routine** — background and tracked, the
duration, the compliance record, and the error bars. Not a product name and a
star rating. A conventional review is just as confounded as this; it simply
hides it. Showing the confound is what makes the artifact more honest than the
thing it replaces.

Defaults: **metrics-only, photos opt-in per trial.** Never the reverse.

### Community — amended 2026-08-07, built

Previously out of scope; promoted by `ideas.md` and built deliberately.
Public browsing of ongoing and completed trials — the home page `/` — comments the
owner can switch off, saves, a product index derived from published trials
(`/products`), and fuzzy search over trials, products and people (`/search`).
Views are the only count — no likes, because a dramatic before/after would
out-score an honest "no measurable change" and sort the feed against the
premise. Trials stay default-private, published per trial.

Cost, stated: publishing currently shares the whole trial, photos included,
rather than metrics-first with photos as a separate opt-in. The eye-bar face
censoring from ideas.md is deferred with it.

### Out of scope for now

- **Browser extension.** Surfacing quantitative trials on any retail product
  page is the right long-term bet, because it puts the data at the moment of
  purchase. It is a slide, not a build.

---

## 8. What changed and why

The previous design predicted the future and rendered it. Both halves were
retired on evidence, not taste.

| Retired | Why |
|---|---|
| Forward forecast (+14 / +30 / +60 days) | A projection needs the slope pinned down far more tightly than "did this move?" does. On the reference dataset's slopes, a 14-day forward forecast contains nothing resolvable (Finding 5). |
| Skin Simulation rendering | A real forecast slope maps to intensity ~0.02–0.04, which renders as no visible change (`docs/_archive/simulation-constraints.md`). |
| "Abandonment trajectory" | Simulation intensity is clamped to [0.0, 1.0]. The renderer cannot be asked to make skin look worse. |
| Adherence/abandonment branching | Depended on both of the above. |

**What the pivot bought:**

- The "before" is now a real photograph rather than a synthesised counterfactual,
  which is strictly more credible.
- Dropping the renderer promotes `moisture`, `firmness`, and both eyelid metrics
  from "measurable but not renderable" to fully first-class — the pivot *gained*
  four metrics.
- A trial is single-device by default, so the cross-device confound that
  dominates the historical dataset mostly disappears. It only returns when
  someone changes phones mid-trial.

**What survived intact:** the entire capture and analysis pipeline and
device-offset correction. The purge-trough/regression/Kalman trend-estimation
engine this section originally said would become "the primary narrative
device for the summary" **did not** — see the next amendment. It was never
actually wired into the live app's summary path in the first place
(`docs/trial-analysis.md`), and the second pivot below made a multi-point
narrative impossible regardless.

### Amended 2026-08-08: daily analysis retired

The retrospective pivot above kept analysing every daily capture — it just
stopped projecting the series forward. That's still $60/user/month at real
usage (twice a day, a month), which nobody can be charged. Retired a second
time, on cost rather than evidence about what's measurable:

| Retired | Why |
|---|---|
| Analysing every daily capture | ~20 units/photo, unaffordable at real usage. Only the initial and final photo are analysed now — §4, §5. |
| "Shape, not slope" narration (purge/trough detection, the fitted trend line) | Needs a multi-point analysed series. Two points have no shape, only a delta. The engine this described (`src/regression.mjs`, `src/kalman.mjs`) was diagnostic tooling that never ran in the live app anyway — see `docs/trial-analysis.md`. |
| Compliance/clustering feeding the detection maths | That design was never live either (the shipped gate in `lib/trial-detail.ts` was always a plain first-vs-latest comparison). Daily logging still matters — for the photo record and as the fallback source for the final photo — just not for statistical precision. |

**What the second pivot bought:** a trial now costs a flat ~2 analyses no
matter its length, which is the difference between a feature that can ship to
real users and one that can't. **What it cost:** no mid-trial quantitative
trend, and a new failure mode — **inconclusive** — when a trial ends with
nothing to compare its starting photo against. Both are named plainly in §6
rather than papered over.

---

## 9. Demo

The reference dataset is already a completed trial, which makes it the strongest
possible pre-seed: none of it is synthetic.

- **Dec 20 2024 → Jun 13 2025**, 175 days, acne medication. Acne `raw_score`
  60.3 → trough 43.5 (Jan 8) → 89.4. Purge, trough, and recovery are all
  unambiguous in the data (Finding 3).
- The acne change is large relative to acne's own scatter over this window, so it
  clears comfortably. The headline is honest.
- Acne is the device-robust metric (offset ≈ 6–10 points), so it survives the
  iPhone XS → iPad → iPhone 16e churn across the series.
- **Aug 2026** (Block C) serves as a "fourteen months later, did it hold?"
  epilogue, honest about the 416-day gap in between.

The demo shows a finished six-month trial with a real arc, not a seven-day
delta. Judges see the full trajectory immediately, with no live API key and no
waiting — the requirement in `BRIEF.md`.

Note the demo trial carries **7 metrics**, not 14: the cached analysis predates
this design. Backfilling the other seven would cost roughly 400 of ~468
remaining units, so it isn't happening. Live trials collect all 14.

---

## 10. Hackathon deliverables

From `BRIEF.md`:

- [ ] Public repository, MIT licensed, all source and assets, runnable from
      cached fixtures with no API key
- [ ] YouCam Skin Analysis integrated non-trivially — pipeline, caching, device
      calibration, noise floor, capture gate
- [ ] Pre-seeded dataset (the 175-day series above)
- [ ] Screenshots
- [ ] 1–3 minute demo video, publicly on YouTube, explaining the API integration
- [ ] Exit interview and blog consent

Judged on Technological Implementation, Design, Potential Impact, and Quality of
the Idea. The pitch against each is the same sentence: *this is the only skincare
app that tells you when it can't tell.*
