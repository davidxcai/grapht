# The app — screens and flows

**Status: designing.** Nothing here is built. Sections are ratified one at a
time and each carries its own status.

Product logic is settled elsewhere and isn't relitigated here —
[`../PRODUCT.md`](../PRODUCT.md), [`trial-model.md`](trial-model.md),
[`trial-analysis.md`](trial-analysis.md),
[`capture-quality.md`](capture-quality.md). Where this disagrees with those,
this is wrong.

| § | Surface | Status |
|---|---|---|
| 2 | Sign-up | **resolved** |
| 3 | Dashboard | **resolved, built** |
| 3.1 | Routines | **resolved, built** |
| 4 | New trial | **resolved, built** |
| 5 | In-trial / daily capture | **resolved and built**; quality gate not built |
| 6 | Trial end and summary | ending built; the summary itself not built |
| 7 | Share and privacy | not discussed |
| 8 | Community | not discussed, **conflicts with PRODUCT.md §7** |

---

## 1. Platform

**Web first**, for iteration speed. One real cost: browser capture exposes no
EXIF, so the **EV100 ambient-light check is unavailable** — it needs aperture,
exposure time, and ISO. The pixel-based checks (light direction, colour,
sharpness, framing) all still work. The demo path is fixture replay and needs no
camera.

---

## 2. Sign-up

**Status: resolved, 2026-08-05.**

**username** (unique), **email**, **password**, **skin type**, **birthday**, and
an **optional profile picture**.

- Auth is email + password — no email delivery in the loop, which matters when
  demoing.
- Skin type is oily / dry / combination / normal / sensitive. Fitzpatrick is
  more clinically precise but most users don't know their number, and it answers
  a UV question this product isn't asking.
- The profile picture is a plain avatar. It never goes near the analysis
  pipeline, isn't a capture, and has no framing or lighting requirement.

**No photo is analysed at sign-up, and there is no calibration or noise-floor
step.** Both would spend YouCam units per account against a ~468-unit budget.
The cost of skipping is already priced in: `capture-quality.md` specifies that
the consistency checks can't run until a user has history, so the first 3–5
captures get absolute checks and guidance rather than gating either way.

**Skin type and birthday never enter the measurement path.** Same rule as
ingredients: they can shape who a reader compares themselves to, and a sentence
of framing in the summary. They may never adjust, weight, or normalise a score.
No age-adjusted wrinkle score — the noise floor is per-user and empirical, and a
demographic prior would corrupt it invisibly.

---

## 3. Dashboard

**Status: resolved and built, 2026-08-05.** `app/page.tsx`,
`components/trial-card.tsx`, `components/trial-ring.tsx`, `lib/trials.ts`.

The homescreen — seen every day for the length of a trial, not a results screen.
A **New trial** button at the top, three tabs (**Active**, **Completed**,
**Routines**), and nothing else. Every number and every decision lives one tap
deeper, on the trial detail page.

One card, used in both tabs:

- radial progress ring, `4 / 10 Days` at its centre — or plain `4 Days` on an
  open-ended trial, where the missing denominator *is* the signal
- the user's own name for the trial
- what it tracks
- a small icon for today's log state — logged / not yet
- a `Completed` badge, in the completed tab

The ring measures **days elapsed, not days logged**, and fills on its own. A ring
that stalls when you miss a day is a nag; the logging record belongs on the
detail page, where the user goes to look rather than being shown unasked.

With no end date there is nothing to fill toward, so the ring renders as bare
track. It isn't a progress bar without a target — an indeterminate spinner or a
ring that fills against an invented horizon would both imply an endpoint the
user declined to set.

Empty states are one line each: *no trials in progress*, *no trials completed
yet*.

"What it tracks" is the **interventions**, signed `+` / `−` so removals read as
removals — not the target concerns, which are vocabulary the user didn't choose
and can't act on from here. Targets live on the detail page.

One accent colour, `--progress`, carries the ring, the calendar's capture dots,
and the `Completed` badge — everything about *where a trial is*, and nothing
else. It must never encode a metric: a hue that means "progress" in one place and
"acne" in another is how a chart starts lying. Direction of change has its own
two tokens, `--improved` and `--declined`.

One-at-a-time is a recommendation on the new-trial CTA, never a block — the soft
answer to the "overlapping trials" question in `trial-model.md`. Concurrent
trials share a photo stream, so captures are reusable but attribution sets aren't
independent: every metric both trials target gets `|T| > 1` and stops being
attributable. It is still legitimate to run a second trial against metrics the
first doesn't touch, so the cost is stated and the choice is the user's.

**Mid-trial metrics are shown, in full, on the detail page.** The daily log is
the product as much as the summary is; withholding measurements until the end
date would make the outcome the only thing of value and the app a black box. What
is never shown is anything projected forward — no forecast, no trajectory, no
extrapolated endpoint (`PRODUCT.md` §8).

### Tone

Project-wide, not local to this screen. **No clinical framing.** The user is not
a test subject and the app is not a supervisor — people opt into this for
themselves, not to supply anyone with data.

`compliance` survives as an internal field name and never as a user-facing
string; the surface word is **streak** or **days logged**. The metaphor happens
to agree with the maths — daily logging genuinely gives the tightest error bars —
so nothing is traded away by using the friendlier word.

**A missed day does not reset the streak to zero.** A zeroed counter reads as
*you blew it*, which is the pressure this framing exists to avoid, and it
punishes a user whose series is still perfectly usable. Show days logged;
consecutive days, if shown at all, stay secondary.

Open: how an abandoned trial appears; "ended early" must be visually distinct
from "completed."

---

## 3.1 Routines

**Status: resolved and built, 2026-08-05.** `app/routines/`,
`components/routine-editor.tsx`, `components/routine-card.tsx`,
`lib/routines.ts`.

A **routine** is a named, ordered set of products the user already uses —
`[Morning]`, `[Night]`, as many as they want. Full CRUD from the third dashboard
tab. It exists so the baseline is picked rather than retyped: starting an eye
cream, you choose `[Night]` and the whole background routine comes with it.

Each product carries `targets[]` from the same classifier the trial flow uses
(`docs/product-identity.md`), pre-ticked ≤3 high-confidence and the rest offered
as suggestions. The card shows the routine's **coverage** — the union of its
products' targets.

Three things this screen must keep straight:

- **Coverage is not credit.** A baseline routine is never attributed. Coverage
  is the set of metrics that already have a background explanation, i.e. the
  `confounded` row of the attribution table — the opposite of a claim that these
  products work. The surface word is **covers**, never *improves* or *treats*.
- **A trial stores a snapshot, never a routine id** (`snapshotRoutine()`).
  Editing `[Night]` in October must not move a metric between `confounded` and
  `unexplained` in a trial that started in August. Same rule as `targets[]` and
  the end date; deleting a routine likewise leaves running trials untouched.
- **All fourteen concerns are offered per product**, not a plausible subset. The
  moisturiser nobody thought about is the entire argument for baselines
  (`trial-model.md`), so the picker must not hide the metric that confounds you.

Bias-narrow is inherited from `product-identity.md` but the reasoning is
weaker here, and deliberately so: an over-broad *baseline* confounds every
metric, which is a different failure from an over-broad *intervention* making
everything unattributable. Both end in a table that says nothing, so the same
≤3 cap applies.

Storage is Neon Postgres — the first persistent state in the app. Routines are
the only thing that needs it; trials still replay from the committed fixture, so
an absent `DATABASE_URL` costs the routines tab and leaves the demo path intact.
The `analysis_concern` enum is generated from `src/concerns.mjs`, so the
database rejects `pores` exactly as `normalizeConcerns()` does.

Open: whether a routine can be *derived* from a finished trial's baseline;
whether editing a routine should offer to fork rather than mutate, once more
than one trial references it.

---

## 4. New trial

**Status: resolved and built, 2026-08-05.** `app/trials/new/`,
`app/trials/actions.ts`, `components/trial-editor.tsx`, `lib/capture.ts`,
`lib/trial-store.ts`, `scripts/migrate-trials.mjs`.

One screen, saved in one action, landing on the trial detail page:

name → tracked product(s) → the routine it sits on → metrics to track →
duration and frequency → first photo.

| Step | Model |
|---|---|
| name | `name` — free text, pre-filled from the first tracked product |
| tracked products | `interventions[]`, always `direction: 'add'` |
| the routine it sits on | `routine.baseline[]` — **one** saved routine (§3.1), frozen by `snapshotRoutine()` |
| metrics to track | per-product `targets[]`, ≤3 pre-ticked, frozen at creation |
| duration | `window.endDate` + `endDateSource` — 30 days by default, null if open-ended |
| frequency | the logging schedule; reminders and the streak only |
| first photo | `captures[0]`, analysed on save |

Carried in from the model, non-negotiable:

- Products resolve to `targets[]` per `product-identity.md`; the user confirms
  or edits every time.
- `targets[]` bias narrow (pre-tick ≤3 high-confidence concerns) and freeze at
  creation.
- All 14 concerns are collected regardless. "Metrics to track" chooses what gets
  *narrated*, never what gets *collected*.
- **The screen sets no expectations.** No resolvable-effect statement, no "a
  14-day window can't resolve this," no predicted outcome. The user is here to
  find out what happens, not to be told in advance what could be found. The
  detection gate is a *reporting-time* mechanism and appears nowhere on this
  screen.

### Duration

**Pre-filled at 30 days.** A blank field asks the user to guess at something
they have no basis for; 30 days is a defensible default and reads as sufficient
because it usually is. Also offered: other fixed lengths, and open-ended. If the
classifier returned a `durationClaimDays` from the label, that length is offered
too and sets `endDateSource: 'product-claim'`.

None of these lock anything (`trial-model.md`) — the date is a marker the day
counter counts toward, and the trial ends when the user ends it.

### Frequency

Daily by default, then every other day, weekly, specific weekdays, every N days,
and **none** — log whenever you feel like it.

Frequency drives reminders and what counts as a missed day. It never enters the
maths: `se(slope)` reads the real capture timestamps, not the planned schedule,
so logging more often than you promised always helps and picking a sparse
schedule doesn't change the rules, only the error bars.

### Metrics attach to the product, not the trial

The chip picker is per tracked product — the same control as the routine editor,
all fourteen offered, ≤3 pre-ticked. The trial tracks the union.

With one tracked product the distinction is invisible, which is the common case.
It exists so that two products don't collapse into one undifferentiated target
set, which is what would force `|T| > 1` on every metric and empty the
attribution table (rule 9).

### One routine, and what that costs

A single saved routine, not several — and a saved one only. `BaselineEntry`
still admits a bare string (the fixture's baseline is three of them), but the
form no longer offers a free-text field: a typed product carries no `targets[]`,
so it confounds nothing and buys the user only the illusion of having declared
it. A removal trial therefore needs a saved routine, which is the thing it is a
removal *from*.

Morning and night are separate logs; naming both here would attach a routine to
a trial that isn't testing it.

The cost, stated because it is real: the baseline is never attributed, so naming
both routines would not dirty anything — it would *widen the confounded set*,
which is the honest direction. Excluding the other routine means a metric it
covers reads `unexplained` ("possible side effect") when a perfectly good
background explanation exists in the user's own saved data. The detail page
should eventually close this by noting, on an `unexplained` metric, that another
saved routine covers it. The creation form stays single-select regardless.

### Removals

Not a control on this screen. A removal is its own trial: pick the routine
without the product, leave the tracked list empty, name it *No vitamin C*. See
`trial-model.md` — such a trial attributes nothing, by construction.

### The first photo

Taken or uploaded here and **analysed on save**, establishing day-1 values for
all 14 concerns. HD, always — mixing HD and SD within a series shifts acne,
texture and pore by 13–18 points, several times any real change (rule 4).
Images live in Vercel Blob, private; they are never committed and never enter
the fixture.

A framing guide holds face scale roughly constant across captures. Automatic
crop-to-0.55 is deferred — until it exists, consistency rests on the guide and
the user, and rule 3 is the standing warning about what happens if scale drifts
within one series.

**No noise-floor burst.** Instrument noise floor falls back to the reference
figures with a visible caveat, refined from the user's own consecutive captures
as the trial accrues. This is defensible: burst noise is 1.1–3.4× *smaller* than
day-to-day scatter (`measurements.md` Finding 5), and the gate uses the
conservative day-to-day figure, which a burst can't measure anyway.

### Open

- **Product search is unbuilt, and it is the real fix for target quality.**
  Products are typed in and classified from the name alone — the weakest of the
  four paths in `product-identity.md`, and one that doc explicitly calls
  insufficient for an *intervention*, where targets decide credit rather than
  just confounding. Searching the product cache (`src/products.mjs`, keyed by
  INCI/barcode/name) would fill brand, name, `targets[]` and `productKey` from
  real ingredient data in one step. Until then "Add own" is the only path, which
  is what that button name anticipates.
- **`downloadResult()` shells out to `unzip`** (`src/results.mjs`), which is not
  present on Vercel's Node runtime. Captures work locally and would fail on a
  deployment.
- Whether the first photo can be deferred — "upload whenever they can" conflicts
  with a fixed `startDate`, and a baseline landing three days in would count
  those days as missed.

---

## 5. In-trial / daily capture

**Status: resolved and built, 2026-08-06.** `app/trials/[id]/page.tsx`,
`components/trial-detail-tabs.tsx`, `components/trial-photos.tsx`,
`components/trial-calendar.tsx`, `components/metric-list.tsx`,
`components/end-trial-button.tsx`, `lib/trial-detail.ts`. Daily capture lives in
`components/trial-photos.tsx` and `components/camera-capture.tsx`, with
`logCapture()` in `app/trials/actions.ts`. The quality gate
(`capture-quality.md`) is still unbuilt.

Three tabs: **Photos**, **Progress**, **Summary**.

**Photos leads**, because the photograph is the thing the user came to see and
the only part they can judge unaided. Opens on the most recent capture.

**It scrolls like a camera roll**, not a slideshow with buttons. Drag or swipe
the photo itself; the dots stay as a position indicator and remain tappable, but
they are not the primary control — hunting for a 8px target to move one day is
the wrong verb for a photo timeline.

**The overlay is per photo, not per trial.** It reports day 1 → *the capture
being looked at*, capped at three tracked metrics or the picture becomes a
dashboard. The first photo reads `baseline` rather than `0`, because nothing was
asked of it yet.

This was got wrong first time: the overlay showed the whole-trial change on every
frame, so the day-1 photo carried `+21` and read as though it already contained
the improvement. Per-photo also makes the series tell its own story — swiping the
reference trial now runs −12 through the January purge before climbing to +48,
which is the shape the summary is supposed to narrate.

### Today's photo

**Today is the last frame of the roll, not a card beneath it.** With no photo
logged, that slot is an empty frame carrying *No photo for today* and the two
buttons, and the tab opens on it — what you land on is the thing you came to do,
with yesterday's face one swipe back. A card underneath was built first and was
wrong: it greeted you with yesterday and put the action somewhere further down.

The empty frame keeps the day counter, because it *is* a day of the trial, and
takes a dot like any other frame. It carries **no metric overlay** — nothing has
been measured yet. Once today is logged it is simply today's photo.

**It only ever knows about today**, so a missed day is never mentioned, marked,
or offered a backfill.

Capturing takes over the whole area rather than animating inside the frame: a
live camera and the roll's drag handler would fight for the same pointer, and
there is nothing to browse mid-capture.

The shutter does not spend units. Every frame is reviewed before it is sent,
because an unreviewed capture costs ~20 units *and* joins the series either way.

Two constraints are checked in the browser, before the call, because both are
free there and unrecoverable after: **short side ≥ 1080px** blocks the shutter
and offers upload instead — most laptop webcams are 720p, so this fires often —
and a long side over 2560px is downscaled on the canvas.

The preview is mirrored and the file is not. Which handedness hardly matters;
that it never changes mid-trial does.

Cost, stated: face framing rests on an oval guide and the user. There is no
automatic crop-to-0.55, so rule 3 stands as the warning about scale drift.

**Same-day captures are allowed by the store and never prompted for.** Nothing
in the model forbids them and consecutive captures are how the per-user
instrument noise floor gets refined (§4); asking for one is what the app has no
business doing.

**The running sample trial gets the today slot too**, so the surface is routed
uniformly and there is one shape to plug into. It cannot actually be written to
— a capture needs the database and nothing that renders the fixture may — so
`logCapture()` refuses it by id, for free, before the analysis. The refusal
surfaces as an error on the review step rather than as a missing button.

`scripts/seed-dev-trial.mjs` writes a stored trial with backdated captures and
no photo today, because the prompt is otherwise unreachable: creating a trial
through the app analyses a photo and that trial is then logged for the day. It
sets `captured_at` directly, which only a dev script may ever do.

**Progress** carries the calendar, all fourteen metrics split into what you're
tracking and everything else, the products, and **End trial**.

### The headline number is today minus day one

Not a fitted slope, which is the less noisy estimate and was the earlier
proposal. Showing `+7` beside "improved by 3" is incoherent to anyone not
running experiments for a living, and the question people actually ask is *how
do I look now versus when I started* — a two-point question. The slope still
appears as the sparkline's shape, where it reads as trajectory rather than as a
competing number.

### Green, red, and white

A metric is coloured only when it moved further than the camera's own wobble;
otherwise it reads **no change**, in muted foreground. White is a third state and
must never be styled as a weak green.

The thresholds are 2× the spread measured across the two clean burst pairs in
the reference dataset — photos 9 and 31 seconds apart under held lighting, where
any difference is the instrument rather than the face. Doubling puts them inside
the 1.1–3.4× band between instrument noise and day-to-day scatter
(`measurements.md`, Finding 5) without a per-user calibration step, which would
cost YouCam units at every sign-up. The third burst is excluded on purpose: its
lighting was varied deliberately and it produced a 57.6-point texture spread in
39 seconds. That is a capture failure, and `capture-quality.md` owns it.

**The numbers are always visible.** The check controls the arrow, the colour and
the word — never whether the user may see their own measurement.

With a single capture nothing is called flat, because nothing has been asked yet.
The copy is *"No progress yet — come back and upload another picture tomorrow."*

### The calendar

Month grid, a dot under every day with a capture, opening on the month holding
the most recent activity rather than the first. **A missed day is a day without a
dot** — no red square, no broken-streak marker. The app is not a supervisor.

The **full date range sits above the grid** (`20 December 2024 – 13 June 2025`),
so how far back there is to look is legible without paging. Arrows step one
month; a select on the month name jumps to any month in the window, because a
six-month trial is otherwise eight clicks from its own first month.

### Ending

`End trial` sits on Progress, is available from day one, and is the normal way a
trial finishes. The copy avoids *stop early* and *quit* — there is nothing to be
early for — and never says *stop the treatment*, because it doesn't mean that.
The log closes; the routine is the user's own business.

It cannot be undone, and the confirmation says so. The `status = 'active'` guard
in `closeTrial()` is what enforces it: a second call matches no rows.

### The day counter

`Day 4 of 30` when a duration was set,
plain `Day 4` when it wasn't.

**No backdating.** Captures are timestamped server-side at upload and can't be
assigned to a previous day. The compliance record is a published artifact, and
one that can be edited after the fact is worth nothing. It also protects the
maths: minimum detectable effect is computed from real timestamps, so a
backdated photo doesn't just misreport adherence, it silently moves the error
bars.

A missed day is missed forever — intended. Recovery is the in-flight nudge from
`trial-model.md` ("logging tomorrow and Thursday recovers most of your
resolution"), not a backfill.

Also here: quality gate before upload (block / warn-and-confirm, never silent
drop), and **ending the trial** — the normal way a trial finishes, available
from day one, not an escape hatch. Passing a set `endDate` prompts but doesn't
close: logging past your own marker is allowed and the extra captures are real
data.

Open: whether a photo taken 11:58pm and uploaded 12:03am counts as yesterday (a
local day boundary with a grace window isn't the same as backdating).

---

## 6. Trial end and summary

**Status: ending is built; the summary is not.** The Summary tab exists and is
always visible — hiding it would shift the layout when a trial closes — and
states why it is empty:

- **running, fixed duration** — `3 more days until complete.`
- **running, past its end date** — end it whenever you're ready
- **running, open-ended** — `No summary until you stop this trial. It runs as
  long as you want it to.`
- **ended** — the summary belongs here; not built yet

An open-ended trial is not excluded from having a summary. It has no *scheduled*
completion, so there is nothing to count down to, but stopping one produces
exactly the same data as stopping a fixed-length one and earns the same summary.

When the user ends the trial, captures go to an LLM for the narrative layer.
Three layers fixed in `PRODUCT.md` §6: the numbers, the narrative, the user's
own words. Photos and metrics browsable over time.

The summary is a retrospective on a log the user chose to close, never a
result they committed to in advance. It has no special claim on the metrics —
those were on screen the whole time.

The gate is upstream of the LLM, not inside it — a metric that didn't clear its
detection bar reaches the model as *unchanged*, with no delta or direction to
narrate.

Open: the photo/metric browser; whether the narrative is regenerable, and
whether regenerating until you like the answer is a problem.

---

## 7. Share and privacy

**Status: not discussed.**

Per-trial at summary time: keep private, or publish. Default private, photos a
separate opt-in from metrics, never the reverse. A published trial carries the
whole routine, duration, compliance, and error bars — not a product name and a
star rating.

Open: whether publishing is reversible; what happens on account deletion.

---

## 8. Community

**Status: not discussed. Conflicts with the design of record** — `PRODUCT.md` §7
lists the community feed as out of scope for this cycle. Building it means
amending that doc on purpose, not diverging from it quietly.

Browse others' trials by product, search products to try next, view photos and
compliance, heart/like.

Open, and load-bearing:

- **Likes are a popularity signal on a measurement artifact.** A dramatic
  before/after out-hearts a well-run trial that honestly returned "no measurable
  change" — and the second is the more valuable document. Sorting by hearts
  optimises the feed against the premise of the app.
- Aggregating across trials of the same product is the obvious next step and the
  easiest place to fabricate confidence.
- Moderation, given the content is faces.
