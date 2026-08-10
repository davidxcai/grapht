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
| 2 | Sign-up | **resolved and built** |
| 3 | Dashboard | **resolved, built** |
| 3.1 | Routines | **resolved, built** |
| 4 | New trial | **resolved, built**; stepper prototype added 2026-08-09 |
| 5 | In-trial / daily capture | **resolved and built**; quality gate not built |
| 6 | Trial end and summary | **built**, including the Gemini summary |
| 7 | Share and privacy | per-trial visibility built; face censoring deferred |
| 8 | Community | **built 2026-08-07**; PRODUCT.md §7 amended to match |
| 9 | Home and search | **built 2026-08-07**; hero 2026-08-08, search not yet wired past trials |

---

## 1. Platform

**Web first**, for iteration speed. One real cost: browser capture exposes no
EXIF, so the **EV100 ambient-light check is unavailable** — it needs aperture,
exposure time, and ISO. The pixel-based checks (light direction, colour,
sharpness, framing) all still work. The demo path is fixture replay and needs no
camera.

**Page width caps at 1440px** — 75% of a 1920px (1080p) screen — via the
`.page-width` utility in `app/globals.css`, applied identically in
`app/layout.tsx` (main content), `components/site-nav.tsx` (header row) and
`components/site-footer.tsx`. It is one shared class rather than three
hardcoded widths on purpose: those three previously drifted (full-width header,
1440px content, 896px footer) and read as a layout bug rather than a design
choice. Add any future full-bleed region to `.page-width`, not a new
`max-w-[...]`.

---

## 2. Sign-up

**Status: resolved 2026-08-05, built 2026-08-06; onboarding split into a
stepper 2026-08-09.** `app/login`, `app/signup`, `app/welcome`, `app/profile`,
`components/onboarding-stepper.tsx`, `components/profile-form.tsx`,
`lib/auth.ts`, `lib/profile-store.ts`.

**first and last name**, **username** (unique), **email**, **password**,
**skin type**, **birthday**, **profile visibility**, and an **optional
profile picture**.

- Auth is email + password — no email delivery in the loop, which matters when
  demoing.
- Split in two: Clerk takes the credentials, then `/welcome` collects the rest.
  Google arrives with no password and no chance to have filled a form, so one
  post-account step is the only version of this that isn't written twice. The
  profile row existing *is* the "finished signing up" flag.
- `/welcome` is a 4-step stepper (`OnboardingStepper`), not a flat form — name
  + birthday, picture, username + visibility, skin type — built on the same
  REUI `Stepper` primitives as `components/trial-editor-stepper.tsx`, with a
  checkmark-on-completed treatment on the nav (`indicators={{completed: ...}}`)
  rather than that component's plain numbers. `/profile` keeps the original
  flat `ProfileForm` for edits after the fact — one screen at a time only
  matters the first time, when every field is empty.
- Clerk owns email, password, Google, the picture, **and now first/last
  name** (`user.update()`, alongside the existing `setProfileImage()`); Neon
  owns username, skin type, birthday and visibility. Google prefills the name
  through Clerk; it does not prefill birthday — no OAuth scope this app
  requests carries one, so that field always starts empty regardless of
  sign-up method.
- Ownership is enforced in the data layer, where every query takes the owner as
  an argument — the proxy only redirects. A build with no Clerk keys writes as
  one implicit local owner, which is what keeps the keyless demo writable; those
  rows stay on the keyless path, never claimed by an account. Accounts start
  empty, and the reference series is not listed as theirs.
- Skin type is oily / dry / combination / normal / sensitive. Fitzpatrick is
  more clinically precise but most users don't know their number, and it answers
  a UV question this product isn't asking.
- Profile visibility is public / private, defaulting to public. **It is
  collected and persisted (`profiles.visibility`) but not yet enforced** —
  nothing in search, `/products`, or comments reads it. It exists so the field
  isn't asked for twice once that gating gets built.
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

**Status: resolved and built, 2026-08-05.** `app/dashboard/page.tsx`,
`components/trial-card.tsx`, `components/trial-ring.tsx`, `lib/trials.ts`,
`components/card-grid.tsx` (added 2026-08-08).

The homescreen — seen every day for the length of a trial, not a results screen.
A **New trial** button at the top, four tabs (**Active**, **Completed**,
**Routines**, **Saved**), and nothing else. Every number and every decision
lives one tap deeper, on the trial detail page.

All four tabs lay their cards out through one shared container,
`components/card-grid.tsx` — a CSS grid, one column on mobile and up to four
across on desktop (`grid-cols-1 lg:grid-cols-4`). `TrialCard` and
`RoutineCard` don't know they're in a grid; the container is the only place
the column count is decided, so a layout change applies to all four tabs at
once instead of drifting between copies. The Saved tab's card (borrowed from
§8) is the same `TrialCard`, passed the entry's `handle` — see §8.

One card, used in both tabs:

- radial progress ring, `4 / 10 Days` at its centre — or plain `4 Days` on an
  open-ended trial, where the missing denominator *is* the signal
- the user's own name for the trial, with an AM/PM badge beside it — which
  routine slot (`timeOfDay`) the trial sits on
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
removals, plus the concerns their `targets[]` union to, as flat neutral chips
(`ConcernChips`, the same component `RoutineCard` uses for coverage). This is
the trial's own attributable set, not the baseline's — never render
`baselineTargets()` here, since a confounded metric and a tracked one look
identical as chips otherwise. No colour by concern, per the accent-colour rule
below.

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
`lib/routines.ts`. The product row itself —
add-from-catalog, brand/name, targets, reorder — is
`components/product-draft-card.tsx`, shared with §4's trial-creation picker.
The card's content — name, product count, coverage, and each product listed
vertically with its catalog image where one exists — is
`components/routine-summary.tsx` (added 2026-08-08), shared with §4's
chosen-routine preview for the same reason: two screens showing the same
routine must render it identically, not maintain two copies that drift.

A saved product's image is not stored. `routine_items.catalog_product_id` is a
nullable FK into `catalog_products` (`on delete set null` — a catalog row
disappearing must cost a picture, not a routine item), set only when the
product came from a `/catalog` pick; a typed name, barcode scan, or
ingredient-photo read leaves it null. `listRoutines()` / `getRoutine()` join on
it and read `image_url` live, so the image always reflects the catalog's
current picture rather than one frozen at save time. It is read-only
enrichment — `targets[]`/`brand`/`name` stay the identity the item was added
under, same as always.

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
- **All fifteen concerns are offered per product**, not a plausible subset. The
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

A routine can be published (`RoutineVisibility`, `getPublicRoutine()`,
2026-08-09) — `/routines/[id]` renders a read-only page with the owner's
@username for anyone with the link, same split as `/trials/[id]`. A
product's page (§8) surfaces this: "Routines that use this" is community-wide
— every public routine carrying the product, from any owner — not just the
signed-in viewer's own, mirroring "Trials that use this" directly below it
(`publicRoutinesWithProduct()` in `lib/routines.ts`; fixed 2026-08-09 after
the section shipped scoped to `listRoutines(userId)` and stayed that way
after publishing landed).

Open: whether a routine can be *derived* from a finished trial's baseline;
whether editing a routine should offer to fork rather than mutate, once more
than one trial references it.

---

## 4. New trial

**Status: resolved and built, 2026-08-05; a second, stepper-based
implementation of this same screen coexists as of 2026-08-09 behind a toggle —
see "The stepper flow" below.** `app/trials/new/`,
`app/trials/actions.ts`, `components/trial-editor.tsx`, `lib/capture.ts`,
`lib/trial-store.ts`, `scripts/migrate-trials.mjs`. The tracked-product row
(§3.1) is `components/product-draft-card.tsx`, not local to this screen — and
neither is the chosen-routine preview, which is §3.1's
`components/routine-summary.tsx`.

One screen, saved in one action, landing on the trial detail page:

name → time of day → tracked product(s) → the routine it sits on → metrics to
track → duration and frequency → first photo.

| Step | Model |
|---|---|
| name | `name` — free text, pre-filled from the first tracked product |
| time of day | `timeOfDay` — AM or PM, defaults to AM; which routine slot this trial sits on |
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
- All 15 concerns are collected regardless. "Metrics to track" chooses what gets
  *narrated*, never what gets *collected*.
- **The screen sets no expectations.** No resolvable-effect statement, no "a
  14-day window can't resolve this," no predicted outcome. The user is here to
  find out what happens, not to be told in advance what could be found. The
  detection gate is a *reporting-time* mechanism and appears nowhere on this
  screen.

### Duration

**Pre-filled at 30 days.** A blank field asks the user to guess at something
they have no basis for; 30 days is a defensible default and reads as sufficient
because it usually is. Also offered: 14 and 60 days, and a custom length. If the
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
all fifteen offered, ≤3 pre-ticked. The trial tracks the union.

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
a trial that isn't testing it. The AM/PM choice is the field that keeps them
separate — it renders as a badge beside the trial name, on the card and on the
detail page, and never changes after creation.

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

Taken here on the live camera — there is no upload, §5 — and **analysed on
save**, establishing day-1 values for all 15 concerns. HD, always — mixing HD and SD within a series shifts acne,
texture and pore by 13–18 points, several times any real change (rule 4).
Images live in Vercel Blob, private; they are never committed and never enter
the fixture.

A framing guide holds face scale roughly constant across captures. Automatic
crop-to-`TARGET_FACE_FRACTION` is deferred — until it exists, consistency
rests on the guide and the user, and rule 3 is the standing warning about what
happens if scale drifts within one series.

**No noise-floor burst.** Instrument noise floor falls back to the reference
figures with a visible caveat, refined from the user's own consecutive captures
as the trial accrues. This is defensible: burst noise is 1.1–3.4× *smaller* than
day-to-day scatter (`measurements.md` Finding 5), and the gate uses the
conservative day-to-day figure, which a burst can't measure anyway.

### The stepper flow (2026-08-09)

A second implementation of this whole screen, `components/trial-editor-stepper.tsx`,
now exists **alongside** the one-screen form described above rather than
replacing it. `components/trial-creation-flow-switch.tsx` renders both behind a
`Switch` (`app/trials/new/page.tsx` mounts the switch, not either editor
directly) and defaults to the stepper — explicitly a prototype-comparison
device, per that file's own comment: pick one and delete the switch and the
loser once the stepper is settled. Nothing below is authoritative over the
one-screen form; it is what the stepper does instead, screen by screen.

Both editors share `components/product-draft-card.tsx`'s `ProductDraft` type,
`blankProductDraft()` and `provenanceOfDraft()` — but not the card component
itself. The stepper has its own `ProductStepCard`, local to
`trial-editor-stepper.tsx`, so its card layout could be redesigned without
touching what `routine-editor.tsx` and the classic `trial-editor.tsx` render.

Split into six steps rather than one screen: track (product/routine toggles +
time of day) → product(s) → routine → schedule (duration + frequency) → photo
→ review. Product and routine are each skippable, so the step count is 5 or 6.

**Every field lives in the top-level `TrialEditorStepper` state, never inside a
step's own JSX.** REUI's `StepperContent` (`src/components/reui/stepper.tsx`)
unmounts a step's subtree the moment it isn't active — state that lived there
instead would be lost the moment the user clicked Back. This is what makes
Back non-destructive across the whole flow; there is no separate "preserve on
back" mechanism to maintain, only the rule that nothing stateful may be
declared below the step-render boundary.

- **Track:** a checkbox to the left of each row (`components/ui/checkbox.tsx`,
  new — built on `@base-ui/react/checkbox`, since nothing in the repo wrapped
  it before) rather than a switch inside the row. Time of day keeps its wire
  values (`TimeOfDay` is still `"am" | "pm"`) but reads **Day** / **Night** on
  screen — `TIMES_OF_DAY` maps the label only, the stored value doesn't change.
- **Product:** the `SearchCombobox` bar above the list (described under "Open"
  below) is gone in this flow. Each `ProductStepCard` searches inline —
  typing into either the Brand or the Name input debounces a call to
  `searchCatalogForPicker` (250ms, guarded against out-of-order responses by a
  request-id ref, the same pattern `SearchCombobox` itself uses); the dropdown
  sits under both fields and works from either one, since the query is just
  `` `${brand} ${name}`.trim() `` and the underlying SQL already matches against
  both `brand_name` and `name` (`lib/catalog.ts`). Picking a match fills brand,
  name, image and the real INCI list — a free catalog read. **It does not call
  `suggestConcerns()`.** That classifier is a paid Gemini call, and firing it
  automatically on every catalog pick was the previous behaviour; now it only
  runs when the user presses "Suggest" in `ConcernPicker`, same as manual entry.
  Metrics are the one field a catalog pick no longer autofills, on purpose.
  Cards carry a fixed image/placeholder slot on the left (`Package` icon when
  there's no image yet) so a picked photo never reflows the fields beside it,
  and reorder via drag using REUI's `Sortable` / `SortableItem` /
  `SortableItemHandle` (`src/components/reui/sortable.tsx`, new — the same
  registry as `stepper.tsx`, backed by `@dnd-kit/core` + `@dnd-kit/sortable` +
  `@dnd-kit/utilities`, newly added dependencies). This replaced an earlier
  pass built on the bare HTML5 drag-and-drop API, which worked but felt
  noticeably less smooth than a real sensor-driven sort. "+ Add own" is now
  "+ Add product," sized up and outlined in the primary colour.
- **Routine:** unchanged from the shared design.
- **Schedule:** unchanged from the shared design; still due a spacing/visual
  pass, not yet done.
- **Photo:** heading is "AI Skin Analysis," with subtext naming what happens to
  it — analysed to score trouble areas, so change over time is measurable.
  Camera and nav buttons are sized up on mobile (`h-12` vs. the desktop `h-9`)
  since the default `Button` sizes read as too small a thumb target on a phone.
- **Review:** "Review" sits above the trial name. Visibility options read
  "Only me" / "Everyone" (still `TrialVisibility`'s `"private" | "public"`
  underneath) and the subtext is the flat "You can change this at any time" —
  no longer conditional on which option is selected. The photo reappears here
  in a two-column layout on desktop (`lg:grid-cols-[minmax(0,260px)_1fr]`,
  capped at 260px so it doesn't dominate the screen) and stacks as
  details → photo → visibility on mobile, via Tailwind's `order-*` plus
  `col-start-*`/`row-start-*` grid placement rather than raw arbitrary-property
  bracket syntax.

The step-nav bar itself got two fixes that apply regardless of which editor is
mounted, since both use `src/components/reui/stepper.tsx`: a step's name used
to be `hidden` below the `sm` breakpoint, which meant a phone showed numbered
bubbles with no labels at all; `StepperTrigger` is now `flex-col` on mobile so
the label sits below the bubble instead of disappearing (`sm:flex-row` restores
the side-by-side layout once there's room), and the connector line is pinned to
the bubble's own vertical centre (`self-start` + a 12px offset, half the
bubble's `size-6`) rather than drifting to the middle of the now-taller
two-row trigger. A plain "New Trial" heading sits above the nav bar in the
stepper flow.

### Open

- **Product search now covers the common case, via the incidecoder catalog
  rather than `src/products.mjs`.** `components/product-draft-card.tsx` puts a
  `SearchCombobox` (`components/search-combobox.tsx`) above the tracked-product
  list, backed by `searchCatalogForPicker` (`lib/catalog.ts`); picking a match
  fills brand, name and the real INCI list, which `suggestConcerns` then
  classifies into `targets[]`. "Add own" is still the fallback for anything not
  in the catalog, and stays the only path that reaches the `src/products.mjs`
  cache (keyed by INCI/barcode/name) — that source is still unwired here, so a
  typed name with no catalog match is still classified from the name alone,
  the weakest of the four paths in `product-identity.md`.
- **`downloadResult()` shells out to `unzip`** (`src/results.mjs`), which is not
  present on Vercel's Node runtime. Captures work locally and would fail on a
  deployment.
- Whether the first photo can be deferred — "log it whenever they can" conflicts
  with a fixed `startDate`, and a baseline landing three days in would count
  those days as missed.

---

## 5. In-trial / daily capture

**Status: resolved and built, 2026-08-06; daily capture stopped analysing,
2026-08-08; camera roll replaced by a paginated grid with a lightbox,
2026-08-09.** `app/trials/[id]/page.tsx`,
`components/trial-detail-tabs.tsx`, `components/trial-photos.tsx`,
`components/trial-calendar.tsx`, `components/metric-list.tsx`,
`components/trial-gauge.tsx`, `components/trial-details.tsx`,
`components/trial-products.tsx`,
`components/end-trial-button.tsx`, `lib/trial-detail.ts`. Daily capture lives in
`components/trial-photos.tsx` and `components/camera-capture.tsx`, with
`logCapture()` in `app/trials/actions.ts`. The quality gate
(`capture-quality.md`) is still unbuilt.

Four tabs: **Photos**, **Details**, **Progress**, **Summary**.

**Photos leads**, because the photograph is the thing the user came to see and
the only part they can judge unaided. Opens on the most recent capture.

**It's a grid, capped at sixteen tiles a page, on both breakpoints
(2026-08-09).** One column on mobile, four across by four down on desktop —
the same limit either way, so a long trial paginates instead of scrolling
forever. This replaced an earlier split where mobile got a single-frame
swipeable carousel and desktop got a separate four-across grid component;
that fork made "the grid isn't showing up" genuinely ambiguous to debug across
breakpoints, and the two views could (and once did) drift apart. Now there is
one grid.

Clicking a tile reopens the old carousel as a **lightbox** — same Embla roll,
same drag-to-swipe, same per-photo overlay and dots, now reached on demand
instead of being the default view below `md`. It always browses every capture
in the trial, never just the page the tile came from, so paginating the grid
never narrows what a swipe can reach. The dots remain tappable inside the
lightbox but are not the primary control — hunting for an 8px target to move
one day is the wrong verb for a photo timeline.

**A live capture's tile is a proxied URL, never `blobUrl` (2026-08-09).**
`analyzeAndStore()` uploads with `access: 'private'` on purpose — these are
faces — so the raw blob URL 403s for anyone who requests it directly,
`next/image` included; it rendered as a broken-image glyph in every browser
that showed it rather than a normal decode failure, which is what made it
look like a framing bug at first. Every tile and every lightbox frame instead
builds `/trials/[id]/photo/[photoId]`, the same route
`components/capture-extras.tsx` already used for extra angles, which re-checks
ownership and streams the bytes server-side. Fixture captures are unaffected
— `photoUrl` points at a public file under `public/captures/` and needs no
proxy.

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

**Today is the first tile of the grid, not a card beneath it.** With no photo
logged, that tile carries *Log today's photo* and the camera button directly
— what you land on is the thing you came to do, with yesterday's face one tile
over. A card underneath was built first and was wrong: it greeted you with
yesterday and put the action somewhere further down.

The empty tile keeps the day counter, because it *is* a day of the trial, and
takes a dot like any other frame inside the lightbox. It carries **no metric
overlay** — nothing has been measured yet. Once today is logged it is simply
today's photo, and the next capture becomes the new first tile.

**It only ever knows about today**, so a missed day is never mentioned, marked,
or offered a backfill.

Capturing takes over the whole area rather than animating inside the frame: a
live camera and the roll's drag handler would fight for the same pointer, and
there is nothing to browse mid-capture.

**The camera is ours (2026-08-08)** — `getUserMedia`, BlazeFace for the face and
its six landmarks, and the guide from `docs/capture-quality.md` §5. It ran on
Perfect Corp's JS Camera Kit for a day; that is in §5 and in
`docs/youcam-api.md`, along with why it went.

**The frame is fixed and the user moves.** Every capture is the same crop — the
largest 3:4 window in the camera's frame — with the outline drawn inside it at
`TARGET_FACE_FRACTION` and `FACE_CENTER_Y`, the same constants the server-side
cropper uses. A capture that passes is therefore already normalised, so face
scale is constant by construction. One hint shows at a time, worst problem first;
a camera that lists four faults at once is a camera nobody reads.

**The shutter is manual and disabled until the frame passes.** Framing, scale and
pose gate it; uneven light is named underneath and never blocks, because its
threshold is the user's own baseline and a new user has none. Auto-firing was
what the Camera Kit did and it took the moment away from the user — the whole
point of a guide is that the frame is already right when you press.

Capture does not spend units. Every frame is still reviewed before it is sent,
because it joins the timeline either way — and on the day that photo happens
to be analysed (day one, always; end-trial, sometimes — see §6), an
unreviewed one costs ~20 units on top of that. Since the 2026-08-08
daily-analysis pivot, most reviewed frames cost nothing at all: only a
trial's initial and final photo are ever analysed, so a typical daily log
spends zero units regardless of review. The review step stays for the same
reason either way — a mis-framed photo is a bad measurement long before it's
a bad picture, and it might yet be the one that gets analysed.

Resolution asks for 1920×2560 and falls back to 2560×1920, taking whichever the
device grants and cropping the tallest 3:4 window from it — 1920×2560 whole, or
1440×1920 from a landscape stream. Both clear the analysis floor of 1080px on the
short side comfortably; a stream that cannot is refused rather than upscaled,
because inventing pixels would be inventing the measurement. Nothing is ever
scaled up: the API works at 1920×2560 and resizes anything else itself.

This is a real gain over the Camera Kit, which could only manage 1080×1920 on a
phone — its working buffer was derived from the camera stream inside a heap it
could not grow, so a wider frame crashed it outright (`docs/youcam-api.md`).

**The live camera is the only way in, on both screens (2026-08-07).** An
existing photo carries whatever framing, light and face scale it was taken
under, and each of those is part of the measurement rather than a property of
the picture (rules 3 and 4). The guide, the resolution check and the quality
gate only bind if the frame passes through them, so the file picker is gone from
creation and from daily capture alike.

The cost, stated: a desktop user whose webcam cannot give a 3:4 window 1080px
across, or who denies camera access, has no way to log a photo on that device and
is told to use their phone. That is the intended trade — a series is
single-device by default anyway (rule 6), and a phone camera clears this where
laptop webcams often don't.

This does not touch the extra angles attached to a day (`capture-extras.tsx`),
which are never analysed and where framing carries no measurement.

Cost, stated: the kit floors face scale at 0.75 and never pins it
(`face_ratio_upper_threshold` is 1.0 in every preset), so scale still drifts
inside that band and rule 3 stands as the warning. The correction is the user
moving closer, which the kit prompts — not a crop, which would discard the
resolution texture and pore depend on.

**Unverified, and to check on the first real capture:** the handedness of the
kit's output. The hand-rolled camera deliberately mirrored the preview and not
the file. Which handedness hardly matters; that it never changes mid-trial
does — so a trial started before this change should be checked against one
started after.

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

**Progress** carries the calendar, metrics, and **End trial**. Metrics are
split into what you're tracking (intervention `targets[]`) and what's merely
confounded (the baseline routine's coverage) — but that's the only split
shown. A concern with none of the fifteen wired to it, tracked or confounded,
is not rendered at all (2026-08-09): all fifteen are always *collected*
(rule 8) and, on the seeded fixture, all fifteen have data — but rendering
every metric the trial never targeted and no product in the routine covers
just restates "everything else," which the "Untracked" heading already said
without help from ten more rows. `metricChanges()` still returns all fifteen
with data (`lib/trial-detail.ts`); the tab is what filters to
`tracked || confounded` (`components/trial-detail-tabs.tsx`).

**Details** carries the tracked products, the baseline routine under its frozen
name, and the setup rows. The products sat above the tabs first and were wrong
there: fixed to the page, they pushed the photo down on every tab to restate
something only the setup tab is asking about.

The routine reads like a routine card — frozen name, product count, and what it
**covers** — but deliberately isn't `components/routine-summary.tsx`:
`RoutineSnapshotCard` in `components/trial-products.tsx` renders a frozen
`RoutineSnapshot`, which has no id or image to join against (freezing it is the
whole point — §3.1), so it can't share the component the dashboard and the
new-trial picker do. The section is present even when the trial has no
routine, saying so: an absent panel reads as a bug, where "nothing" is a fact
about the trial.

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

With a single capture nothing is called flat, because nothing has been asked
yet — `MetricList` renders that metric's row as its bare day-one number, no
arrow, no colour (`metric.series.length < 2` in `components/metric-list.tsx`).

**This "single capture" row is the normal state for most of a trial's active
duration (since 2026-08-08)**, not just its first day — since only the
initial and final photo are ever analysed, every tracked and confounded metric
reads this way from the moment the initial photo lands until a final photo is
added at end-trial. It is a per-row state, not a whole-tab placeholder: the
initial photo is analysed immediately (`PRODUCT.md`, "Initial photo"), so
Progress shows real baseline numbers from day one — it must never fall back to
a "come back tomorrow" placeholder while there are tracked or confounded
metrics with data to show (`components/trial-detail-tabs.tsx`,
`onlyBaseline = relevant.length === 0`). That placeholder is reserved for the
genuine edge case of a trial with no tracked targets and no baseline coverage
at all, where another photo wouldn't add anything to show either. The photo
roll's per-frame overlay follows the same "always show something real" spirit:
a capture with no scores at all (every daily log) shows the caption *"Logged —
not scored"* instead of an empty overlay, so a blank frame reads as intended
rather than as a bug (`components/trial-photos.tsx`).

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

It cannot be undone, and the confirmation says so — with one narrow exception
for an inconclusive result. The `status = 'active'` guard in `closeTrial()` is
what enforces the general rule: a second call matches no rows. Since
2026-08-08, ending is also where the trial's final analysed photo gets
decided — see §6, "Ending, since the daily-analysis pivot," for the full
flow.

### The day counter

A half ring above the trial name (`components/trial-gauge.tsx`), reading `4/30`
over `days` when a duration was set and plain `4` when it wasn't — the missing
denominator is the whole signal on an open-ended trial, and the arc stays bare
track rather than filling toward an invented horizon.

It fills on **elapsed** days, not logged ones, for the same reason the
dashboard's ring does: an arc that stalls on a missed day is a supervisor.

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

### Added 2026-08-07, from ideas.md

- **"Applied products" check-in** — a button under the trial title, one press,
  server-stamped like `captured_at` and for the same reason. Each photo shows
  hours since the last press; with no press in the prior 24h the gap is
  projected from the last press's clock time and labelled "going by your usual
  time" rather than passing as measured. The pressed state holds 12 hours.
- **Dosage** — free-text amount per use on each intervention, frozen with it.
  Display and summary framing only; never the maths.
- **Photo notes** — per-capture, editable and removable, shown on the photo
  above the day. The one editable part of a capture: it is the user's words,
  not a measurement.
- **Extra photos** — additional angles attached to a day's capture, stacked
  under the roll. Never analysed, so they cost no units and carry no scores.

---

## 6. Trial end and summary

**Status: built 2026-08-07, ending flow rebuilt 2026-08-08**
(`lib/summary.ts`, `components/trial-summary.tsx`, `components/end-trial-button.tsx`,
`components/add-final-photo.tsx`). On a completed trial the owner asks for the
summary; Gemini writes it from a gated prompt — a metric inside its wobble
reaches the model as "no measurable change" with no delta or direction to
narrate — and the user's own review sits beneath it, editable. Regeneration is
allowed: the window is closed, so the numbers it describes cannot drift. On a
running trial the tab is always visible — hiding it would shift the layout
when a trial closes — and states why it is empty:

- **running, fixed duration** — `3 more days until complete.`
- **running, past its end date** — end it whenever you're ready
- **running, open-ended** — `No summary until you stop this trial. It runs as
  long as you want it to.`
- **ended, conclusive** — the summary, and the review beneath it
- **ended, inconclusive** — no summary generator at all (`generateSummary()`
  refuses it — the gate would silently read every metric as "no measurable
  change," indistinguishable from a real null result, when actually nothing
  was ever measured a second time). Instead: a plain explanation and an "Add
  a final photo" control (`AddFinalPhoto`). Succeeding there converts the tab
  to "ended, conclusive" on the next render — there's no separate "resolved"
  state to design for.

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

Regenerable, resolved: the inputs are frozen when the trial closes, so
regenerating can only rephrase, never re-litigate. Open: the photo/metric
browser.

### Ending, since the daily-analysis pivot (2026-08-08)

Only a trial's initial and final photo are ever analysed (`CLAUDE.md`,
"Repository state"), so ending a trial is also the moment its final
measurement gets decided. The confirmation dialog (`EndTrialButton`) offers
two paths, not one:

- **Take final photo** — opens the same live camera used for daily capture,
  reviews it, then ends the trial with that photo analysed fresh. The most
  accurate option, since it's a photo taken right at the close of the window.
- **End without a new photo** — falls back to whichever photo was logged most
  recently (analysed retroactively from storage, no re-upload) if anything
  was logged past day one; otherwise nothing is analysed and the trial ends
  **inconclusive**.

Copy states which fallback applies before the user confirms, so "end without
a new photo" is never a surprise about which photo — or lack of one — will
end up as the result.

**Inconclusive is not a stored status.** `status` stays `active`/`completed`;
inconclusive is "completed and fewer than two of its captures carry scores"
(`isInconclusive()`, `lib/trials.ts`), computed the same way `tracked` and
`confounded` are elsewhere in this model. It shows as an outline "Inconclusive"
badge wherever "Completed" would otherwise render (dashboard card, community
card, the detail page header) — deliberately not `--complete`'s green fill,
since nothing was resolved.

**The one exception to "ended is immutable":** an inconclusive trial can take
exactly one more photo, from the Summary tab (`AddFinalPhoto`,
"ended, inconclusive" above). The guard enforcing this lives in the store
(`addFollowUpCapture()`, `lib/trial-store.ts`) — it only inserts while fewer
than two captures carry scores, so it closes itself the moment it succeeds
once. No UI-side bookkeeping needed to prevent a second use.

---

## 7. Share and privacy

**Status: per-trial visibility built.** Default private, publishable and
unpublishable at any time, running or finished. A published trial carries the
whole record — routine, duration, days logged, and currently the photos too;
the metrics-first, photos-opt-in split and the eye-bar face censoring
(ideas.md) are deferred. Profiles stay private; only the @username of a
publisher is shown.

Open: photos as a separate opt-in; face censoring; what happens on account
deletion.

---

## 8. Community

**Status: built 2026-08-07**, with `PRODUCT.md` §7 amended on purpose.
Community trial cards were consolidated into `TrialCard` on 2026-08-10 (see
below); the rest of this section is unchanged. `app/page.tsx`, `app/products`,
`lib/community.ts`, `components/trial-card.tsx`, `components/trial-comments.tsx`.

Public trials browse in two tabs (ongoing / completed), narrowed by the home
search (§9). A published trial page shows
its owner's @username and view count, takes comments (the owner's switch), and
can be saved — saves land on a dashboard tab. The product index is derived
entirely from published trials: a product exists because someone trialled it,
and its page is the trials themselves. A product page also lists every
published routine (§3.1) that carries the product, across every owner —
`lib/routines.ts`'s `listPublicRoutines()` / `publicRoutinesWithProduct()`,
the same `visibility = 'public'`-only, no-owner-filter shape as
`listPublicTrials()` here.

Two of the old open items are resolved by construction: **no likes** — views
are the only count, so a feed can't be sorted against the premise — and
**aggregation stops at listing**; nothing averages outcomes across faces.

**A community trial is `TrialCard`, not a separate card.** It used to be
`CommunityTrialCard` — same information, different layout (left-aligned title,
day count as text, view count on the card itself). Collapsed into `TrialCard`
so a trial looks identical whether it's yours or someone else's: same gauge,
same corner badges, same centred chips, same product rows. The one addition is
an optional `handle` prop — `@handle` (or `anonymous`) rendered under the
title, exactly the pattern `RoutineCard` already used for the same reason.
Passing it is what makes a card "the community one"; every community call site
(`app/page.tsx`, `/search`, a product page's "Trials that use this", the
dashboard's Saved tab) now converts its `PublicTrial` entries with
`toCardData(entry.trial)` and passes `entry.handle` alongside. Cost: the view
count and skin type that used to sit on the card are gone from it — views are
still shown on the trial detail page itself, just not repeated on the card.
Moderation stays open, and matters, given the content is faces.

## 9. Home and search

**Status: built 2026-08-07; home replaced 2026-08-08; hero added 2026-08-08.**
`/` is the community index itself — a first-time visitor lands on the published
trials rather than on a page describing them, and there is no marketing landing
page. The nav labels it **Home**; the `/community` route is gone. Cost: the
sample trial's acne series no longer appears above the fold.

Above those trials sits a centred hero (`components/hero-search.tsx`):
**Skincare, Verified.** over *Search thousands of skincare products to see
real-world results*, and one large search field. It states the pitch a
first-time visitor was previously left to infer, and it makes search — not the
trial list — the thing the page opens with.

The field is **one box across every category**, matching `/search`; the skin
type and concern selects are gone. Cost: the two structured narrowings the
community index had are no longer reachable from the home page, and until the
box is wired past trials its placeholder promises products, brands and
ingredients that it does not yet search.

The dashboard lives at `/dashboard` (sign-in required; the keyless build's
implicit local owner passes). `/search` is one box over the public corpus —
trials, products, people, tabbed with counts, fuzzy (`lib/fuzzy.ts`, in-memory;
an index when the corpus outgrows it).
