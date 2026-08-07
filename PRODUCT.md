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
| **Baseline capture** | Day 1. Optionally a burst, which measures your own noise floor. |
| **Daily captures** | The measurement. |
| **Summary** | Generated when you end the trial, annotated by you, optionally published. |

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

### Every metric, every scan

Fourteen analysis concerns are recorded on every capture, regardless of what the
trial targets. Billing is tiered per task, not per metric, so narrowing the set
saves nothing; side effects live in untargeted metrics; and you cannot
retroactively ask a question of data you never collected. Targeting decides what
gets *narrated*, never what gets *collected*.

### Compliance is part of the result

Logging 8 of 14 days is not one number. Slope precision goes as
`σ / (sd_x · √n)`, so *when* you logged matters as much as how often. Against a
perfectly-logged 14-day trial:

| What you logged | Error bars |
|---|---|
| 14 of 14, daily | 1.00× |
| 8 days, spread across the window | 1.25× |
| 8 days, all in the first week | **2.33×** |

Identical `8/14` badges, more than a 2× spread in credibility. Clustering
shortens the lever arm.

So the app shows the ratio, because people read `8/14` instantly, but the
summary's *language* is gated by the minimum detectable effect computed from the
real capture timestamps. And the summary says so out loud — "your captures were
front-loaded, so the second half of this window is thinly sampled" — rather than
burying it. Transparency about the sampling is what makes the conclusion
trustworthy.

### Detection depends on effect size, not on a fixed number of days

There is no universal waiting period, and the app must never imply one. Whether
a change is measurable is a comparison between **how much it moved** and **how
much this user's captures scatter** — nothing else. A big fast change resolves in
days; a slow drift takes months. Both are ordinary.

`docs/measurements.md`, Finding 5 tabulates how long *the reference dataset's own
very slow slopes* would take to separate from noise (acne moved +0.074
points/day, so ~131 days). That table describes one series' effect sizes and is
routinely misread as a claim about skin in general. It is not one. Read the
warning attached to it before quoting any number from it.

**Every window length is legitimate and every result is worth having.** Fourteen
days answers the question for changes big enough to see in fourteen days. If it
returns "no measurable change," that is a real finding about that window — and
the same product logged for forty days by someone else is how the two windows
begin to inform each other. The app's job is to report what this window could and
could not resolve, never to talk someone out of running it.

**Nothing about resolvability is stated at trial creation.** The user is there to
find out what happens, not to be told in advance what they are unlikely to find
(`docs/app-ui.md` §4).

---

## 6. The summary

Generated when the user ends the trial — a retrospective on the log, not the
reason the log existed. Three layers, in order:

1. **The numbers.** Per-metric start, end, delta, and whether it cleared the
   detection bar. Graphs. The photo timeline.
2. **The narrative.** An LLM-written account of the *shape* of the run, not just
   its endpoints — "your acne score dropped for the first three weeks, bottomed
   out around January 8, then improved steadily through April." Shape, not
   slope, is what people recognise as their own experience.
3. **Your words.** A free-text note. How it felt, what the numbers missed, what
   you'd tell someone considering the same thing.

The narrative is constrained by the measurement, not free-running. Rules in
[`docs/trial-analysis.md`](docs/trial-analysis.md):

- A metric that didn't clear its detection bar is described as unchanged. It
  never receives a story, a percentage, or a direction.
- A metric with more than one targeting intervention is never credited to one.
- A metric the background routine touches is never credited to the trial.
- Compliance and clustering are stated, not omitted.

This is what keeps the summary from being fiction. The generator can only narrate
what survived the gate.

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
Public browsing of ongoing and completed trials (`/community`), comments the
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
- The purge-trough detector, formerly a liability for forecasting, becomes the
  primary narrative device for the summary. Shape is what a retrospective wants.

**What survived intact:** the entire capture and analysis pipeline, the noise
floor, device-offset correction, and the trend-estimation engine — the last with
a new job, estimating a *past* trend and its uncertainty rather than projecting a
future one.

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
