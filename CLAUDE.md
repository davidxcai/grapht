# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Repository state

The data pipeline and YouCam API integration work. Attribution and product
picking are built and tested. In the web app the dashboard (`/dashboard`),
saved routines, trial creation, the trial detail page, daily capture, accounts,
the Gemini trial summary, and the community surfaces (marketing home at `/`,
`/community`, `/products`, `/search`, comments, saves, views) are built — trial
creation and daily capture both analyse a live capture, so they are the only
screens that spend units; extra per-day photos upload straight to Blob and cost
nothing. The capture quality gate is not built.

The fixture now carries **scores as well as timestamps**, so the detail page
renders with no `data/` directory. Seven of the fourteen concerns per capture are
**invented** by `seed-trials.mjs` — the reference series only ever measured seven
and backfilling costs ~400 of the ~468 remaining units. Every fabricated value
carries `synthetic: true`; never strip that flag. Photos live under gitignored
`public/captures/`, regenerated from `data/normalized/`.

```bash
npm install                              # Node 22+, macOS (sips is used for HEIC)
npm run dev                              # the web app, http://localhost:3000
node scripts/seed-trials.mjs             # rebuild fixtures/trials.json, free

vercel env pull .env.local --yes                          # Neon credentials
node --env-file=.env.local scripts/migrate-routines.mjs   # routine tables, idempotent
node --env-file=.env.local scripts/migrate-trials.mjs     # trial tables, idempotent
node --env-file=.env.local scripts/migrate-profiles.mjs   # profile table, idempotent
node --env-file=.env.local scripts/seed-dev-trial.mjs     # stored trial, backdated, free
node --env-file=.env.local scripts/seed-dev-trial.mjs --clean

node scripts/prepare.mjs                 # ingest sample-photos/ -> data/prepared/
node scripts/normalize-faces.mjs         # face-crop -> data/normalized/
node scripts/analyze-all.mjs --dry-run   # show plan and unit cost, spend nothing
node scripts/analyze-all.mjs             # THE ONLY STEP THAT COSTS UNITS
node scripts/device-offset.mjs           # derive cross-device offsets, free
node scripts/summarize.mjs               # series (raw + device-corrected) + noise floor, free

node scripts/test-attribution.mjs        # attribution table, offline, free
node scripts/test-products.mjs           # product identity + cache, offline, free
node scripts/probe-catalog.mjs           # harvest product catalog, public web only, free

node --env-file=.env scripts/classify-product.mjs --name "..."   # costs a Gemini call
```

`npm run build` typechecks and builds the app. There is no lint command yet.

## The web app

Next.js 16 (App Router) + Tailwind v4 + shadcn/ui, initialised on the **Base UI**
primitives — so composition uses `render={<Link />}`, **not** Radix's `asChild`.

**`src/` is the pipeline library, not Next's source directory.** The app lives in
`app/` at the repo root precisely so Next never claims `src/`. The `@/*` alias
resolves from the root; pipeline modules import as `@/src/concerns.mjs`.

The app reads `fixtures/trials.json` and needs no API key, no network, and no
photos — `data/` is gitignored because it holds faces, so the committed fixture
carries capture timestamps and trial metadata only. Regenerate it with
`scripts/seed-trials.mjs`; never hand-edit it.

**What the user creates is persistent; the reference series is not.** Saved
routines and saved trials live in Neon Postgres (`lib/routines.ts`,
`lib/trial-store.ts`, `DATABASE_URL` in `.env.local`, tables from
`scripts/migrate-routines.mjs` and `scripts/migrate-trials.mjs`). Capture photos
live in a private Vercel Blob store (`BLOB_READ_WRITE_TOKEN`).

**Accounts are Clerk; ownership is enforced in the data layer.** Credentials,
Google and the avatar are Clerk's (`lib/auth.ts`); the username, skin type and
birthday are ours (`lib/profile-store.ts`, `scripts/migrate-profiles.mjs`), and
that row existing is how the app knows sign-up finished. Every function in
`lib/routines.ts`, `lib/trial-store.ts` and `lib/profile-store.ts` **takes the
owner as an argument** rather than reading the session — an unscoped query
should be a type error, not a leak. `proxy.ts` only redirects; it is not the
boundary, and neither is the page that rendered a form, which is why each server
action resolves the caller itself. `currentUserId()` returns `'local'` when
Clerk is unconfigured, so a keyless build behaves exactly as it did before
accounts existed and the demo path stays writable; the first account to finish
sign-up claims those rows, once, and never again.

A signed-out visitor reads the fixture and writes nothing. Keep it that way:
`/` and `/trials/[id]` are public because the reference series is a published
sample, and a trial that isn't yours 404s rather than admitting it exists.

`loadTrials()` unions the stored trials with the fixture and **catches the
database failure rather than throwing** — the same deliberate degradation
`app/page.tsx` applies to routines. A missing `DATABASE_URL` costs what the user
created and never the twenty-photo reference series, because the fixture-only
demo path is a hackathon requirement. Keep it that way: nothing that renders the
fixture may require the database.

Two rules specific to routines:

- **A routine's coverage is never credit.** It is the union of its products'
  `targets[]`, and a baseline is acknowledged but never attributed — coverage is
  the `confounded` row of the attribution table. The user-facing word is
  **covers**; *improves* and *treats* are wrong.
- **A trial embeds `snapshotRoutine()`, never a routine id.** Editing or
  deleting a routine must not reach into a running trial, for the same reason
  `targets[]` freeze at creation (rule 9).

Reads of any `analysis_concern[]` column — `routine_items.targets` and
`trial_interventions.targets` — **must cast to `text[]`**. The Neon driver only
parses arrays of built-in types, so an `analysis_concern[]` comes back as the
raw literal `"{acne,texture}"` — a string. Nothing throws; coverage just
silently renders empty. `ITEM_COLUMNS` in `lib/routines.ts` and
`INTERVENTION_COLUMNS` in `lib/trial-store.ts` are the only places this is
spelled out.

Screens are designed in `docs/app-ui.md` and ratified one section at a time.
Read the section before building it. Two rules from §3 apply project-wide:

- **No clinical framing.** The user is not a test subject and the app is not a
  supervisor. `compliance` survives as an internal field name and never as a
  user-facing string — the surface word is **streak** or **days logged**. This
  costs nothing: daily logging genuinely gives the tightest error bars, so the
  friendlier word and the honest maths agree.
- **Nothing is projected forward, anywhere in the UI.** No forecast, no
  trajectory, no extrapolated endpoint (`PRODUCT.md` §8).

Mid-trial metrics **are** shown in full. **The daily log is the product, not a
waiting room for the summary** — withholding measurements until a trial ends
would make the outcome the only thing of value, which it isn't. The detection
gate governs what gets *narrated*, never what gets *displayed*.

**Visual validation of the frontend belongs to the user.** Don't launch a
browser or take screenshots to check how something looks. Verify by build,
route status, clean dev-server logs, and rendered markup, then hand over the URL.

`scripts/test-scenarios.mjs` is the only test suite. It scores the forecast
engine against synthetic series with known ground truth — **which is now the
wrong objective**, since the product no longer forecasts. It still runs and its
scenario taxonomy is still valuable. Read `docs/trial-analysis.md`, "Open
items," before changing it or `src/kalman.mjs` / `src/regression.mjs`. Several
of its scenarios are inputs the app should *reject at capture*, not trajectories
the engine must handle, and the doc tags which is which. Don't harden the engine
against a photo that should never have been analysed.

`scripts/forecast.mjs` and `scripts/kalman-forecast.mjs` project forward and are
diagnostics only. Nothing product-facing should call them.

### Planning documents

- `PRODUCT.md` — the **design of record**. Product spec for the trial log.
- `BRIEF.md` — the **external hackathon brief** (YouCam API Skin AI & Apparel
  VTO Hackathon): rules, deliverables, judging criteria. Not ours to edit.

Reference documentation, kept current:

- `README.md` — setup, pipeline, budget discipline, architecture
- `docs/trial-model.md` — trials, interventions, attribution, compliance. The
  conceptual core; read before building any data model
- `docs/product-identity.md` — how a bottle becomes `targets[]`: the INCI API,
  the four input paths, the classifier, and the product cache. Read before
  touching `src/products.mjs`, `src/inci.mjs`, or `src/product-targets.mjs`
- `docs/trial-analysis.md` — the detection gate, narration rules, and what the
  estimation engine does now. Read before touching `src/kalman.mjs`,
  `src/regression.mjs`, or `src/noise-floor.mjs`
- `docs/measurements.md` — empirical findings from the reference dataset. The
  evidence base for nearly every decision here
- `docs/capture-quality.md` — the pre-analysis quality gate: designed, not
  built. Thresholds measured against the reference photos. **Read this before
  adding robustness to the estimation engine** — bad-photo handling belongs
  here, not in `src/kalman.mjs`
- `docs/youcam-api.md` — the full API contract, most of it undocumented publicly
- `docs/_archive/` — the retired forecasting/simulation design. Not
  authoritative. Kept because the simulation findings were expensive to recover
  and are absent from Perfect Corp's public docs

## The product: Grapht, a skin trial log

You change something in your routine, log a standardised selfie daily, and watch
what measurably changes — for as long as you care to, ending whenever you decide
you've seen enough. A **trial** is a *delta on a routine*: your existing routine
is acknowledged but never attributed; only the tracked additions and removals
can receive credit.

The core insight driving every design decision: skin changes too slowly for
human vision, so people fall back on guessing whether something worked. The
product's job is to replace the guess with a measurement — and to be honest
about when the measurement can't resolve the question.

**The credibility mechanism is the whole product.** The app knows its own
measurement error and refuses to report a change smaller than it. Every metric
that doesn't clear the detection gate is reported as *"no measurable change"* —
a statement about the instrument, not a verdict on a product. An app that
declines to conclude reads as instrumentation; an app that always has an answer
reads as a horoscope. Preserve this behaviour.

Changes that make the output more confident than the data supports — narrowing
error bars, narrating sub-threshold deltas, splitting credit between two
products that both target a metric, inferring causation — undercut the entire
premise.

**Be careful which noise floor you mean.** There are two. Instrument noise
(bursts seconds apart) is 1.1–3.4× smaller than day-to-day scatter — see
`docs/measurements.md`, Finding 5. Compare against the conservative figure.

**There is no fixed detection horizon, and you must not invent one.** Whether a
change is measurable depends on **how big it is** relative to this user's own
scatter — nothing else. A face wash can move oiliness 30 points overnight; a
retinoid can take a year. Both are ordinary. The 100–200 day figure that used to
appear here was a misreading of Finding 5: that table asks how long *the
reference series' own unusually slow slopes* would take to separate from noise,
and it is not a statement about skin. Short trials are legitimate, their results
are real data, and the app never tells a user their window is too short to
bother.

## Rules that will silently corrupt results if broken

These are not style preferences. Each one has already produced a wrong answer in
this repo.

1. **Scores run 0–100 where HIGHER IS HEALTHIER.** "Acne got worse" means the
   score went *down*. Confuse this and every chart, slope, and verdict inverts.

2. **Use `raw_score` for everything. `ui_score` is display-only, and the app no
   longer displays it.** `ui_score` is a non-linear consumer compression, and
   measuring its steepness across all 140 cached pairs settles the question:
   d(ui)/d(raw) is ~0.55 at raw 40–55, ~0.39 at raw 70–85, and ~1.26 above raw
   85. The same real change therefore renders up to **3× differently** depending
   on where the score happens to sit. Concretely, the reference series' acne
   purge is raw 60.3 → 43.5 (−16.8) but ui 76 → 66 (−10) — 40% of it hidden.
   Since the app's headline is a *change*, not a level, `ui` is disqualified
   everywhere. It stays in the fixture only so a synthesised concern is shaped
   like a measured one.

3. **Face scale is part of the measurement.** The crop fraction determines
   pixels-per-cm of skin, which drives texture and pore. It is in the analysis
   cache key (`hd_f055_*`) for that reason. Changing it invalidates every cached
   result. Never mix crop scales in one series — doing so fabricated a set of
   confident, entirely false trends here once already.

4. **Never mix SD and HD across a time series.** They are different models for
   `acne`, `texture`, and `pore`, differing by 13–18 points — several times any
   real biological signal. `assertUniformResolution()` guards a single request;
   nothing guards a series, so this one is on you.

5. **Route every concern name through `src/concerns.mjs`.** It is the canonical
   vocabulary for all 14 analysis concerns, and intervention `targets[]` must
   use those keys rather than free text. Use `normalizeConcerns()`, which throws
   on an unrecognised key — pass `{ drop: true }` only for raw model output,
   where one bad suggestion should cost that suggestion rather than the whole
   product. The archived simulation mapping is still in that file and still
   carries its warning: four of the ten simulation names differ from their
   analysis names with inconsistent pluralisation (`pore` → `pores`, `age_spot`
   → `spots`), and the *API* silently ignores an unrecognised key rather than
   rejecting it. Our validator deliberately does the opposite.

6. **Never compare raw `raw_score` across devices.** Camera hardware shifts
   every metric except acne by 5–90 points — pore and texture worst, several
   times any real biological change (`docs/measurements.md`, Finding 2). Route
   any cross-device comparison through `correctForDevice()` in
   `src/device-offset.mjs` first. Live trials are single-device by default, so
   this mostly lies dormant — but record the device on every capture anyway,
   because a phone upgrade mid-trial injects a step change that must be
   corrected or visibly marked.

7. **Device-corrected observations are allowed outside 0–100, on purpose.** The
   correction is additive and unclamped (`docs/measurements.md` Finding 2, where
   corrected pore reaches −5.9). Do **not** clip them back into range: clipping
   hides exactly the cases where the correction is least trustworthy.
   `clampScore()` in `src/concerns.mjs` exists for the retired forecast path and
   should not be applied to observations.

8. **Collect all 14 concerns on every live capture**, regardless of what the
   trial targets. Billing is tiered per task, not per metric, so narrowing saves
   nothing; side effects appear in metrics nobody targeted; and you cannot
   retroactively ask a question of data you never collected. Targeting decides
   what gets *narrated*, never what gets *collected*.

9. **Intervention `targets[]` bias narrow, and freeze at trial creation.** The
   two failure modes are not symmetric. Too narrow pushes a real effect into the
   `unexplained` row, where it is visible and the user can fix it. Too broad
   makes `|T| > 1` fire on nearly every metric, so every result is "credit
   shared, unsplittable" and *nothing* is ever attributable — the attribution
   table stops carrying information at all. Ingredient data pushes hard toward
   broad, which is why `src/product-targets.mjs` pre-ticks only high-confidence
   concerns, capped at three, and offers the rest as suggestions. Separately:
   once a trial starts, a cache refresh or classifier upgrade must never mutate
   its targets. That retroactively rewrites attribution with no new
   measurement.

## API budget discipline

Units are metered against a limited hackathon quota. The analysis pass is the
largest single spend in the project. Roughly **572 of 1040 units are already
consumed** (~468 left); check the console before spending more, and confirm with
the user before any batch run.

**Only successful tasks are billed.** Authentication, uploads, polling,
malformed requests, and failed tasks are all free. This makes schema discovery
by deliberate 4xx probing a legitimate and free tool — `scripts/probe.mjs` is
how most of `docs/youcam-api.md` was recovered.

Pricing is **tiered per task**: HD is 16 units for up to 7 concerns, so the 7th
was free and an 8th likely crosses into the next tier. The 14-concern price is
unknown; one photo would reveal it for ~20 units.

**The reference dataset will not be backfilled to 14 concerns.** At ~20 units
per photo that is ~400 of the remaining 468, for a demo asset that already
works. The demo runs on 7 metrics; live trials collect 14. Consequence to
remember: `moisture`, `wrinkle`, `dark_circle_v2`, `eye_bag`, `firmness`, and
both eyelid metrics have **no measured noise floor and no device offset**.

Everything is cached to disk. Prefer replaying fixtures over re-hitting the live
API, always. If a task times out locally it may still complete and bill you —
use `scripts/repoll.mjs` to recover the result rather than paying twice.

**The INCI and Gemini keys are unrelated quotas** and cannot consume YouCam
units. INCI's free tier is 20,000 requests/month with free 404s, so coverage
probing is cheap. Both are optional: `src/inci.mjs` runs in offline mode when
`INCI_API_KEY` is unset, replaying fixtures only, and every test suite runs with
no key at all.

**The LLM here is Gemini, not Claude.** `src/product-targets.mjs` uses
`@google/genai` against `gemini-3.6-flash`. Don't "helpfully" port it to the
Anthropic SDK — that is a deliberate choice, not an oversight.

**Google Search grounding is paid-tier only.** On a free Gemini key, plain
generation and vision both work, but `tools: [{ googleSearch: {} }]` returns
429 on the same key and model. Backoff does not help; it is a tier limit.
`lookupInciByName()` is therefore unavailable on free tier, which makes
`readInciFromPhoto()` — the ingredient-panel photo — the only automatic
enrichment path. Vision is not restricted.

## Pipeline

```
Camera capture / archive photos
  → prepare.mjs         HEIC→JPEG, DisplayP3→sRGB, EXIF orientation baked in
  → quality gate        block bad captures, warn on lighting drift    [not built]
  → normalize-faces.mjs BlazeFace detect, crop to 0.55 face fraction, 1920×2560
  → analyze-all.mjs     YouCam HD Skin Analysis, results cached
  → device-offset.mjs   per-metric cross-device correction (dormant single-device)
  → detection gate      MDE from real timestamps; 3-way verdict          [not built]
  → attribution.mjs     per-metric, from the trial's intervention sets
  → summary             gated narration + the user's own note            [not built]
```

Product picking is a separate path, run once at trial creation rather than per
capture. Barcode scan, ingredient-panel photo, or typed name → `inci.mjs` →
`product-targets.mjs` → `products.mjs` → a frozen `targets[]` on the
intervention. It never touches the measurement path and cannot cost YouCam
units.

Capture constraints, measured rather than assumed:

- short side **≥ 1080 px** (HD minimum), long side **≤ 2560 px** (the model works
  at 1920×2560; anything larger is discarded)
- face height **≥ 0.55** of frame height, or the API returns
  `error_src_face_too_small`
- **lighting must be held constant.** Varying it raised texture noise from 2.1 to
  57.6 points on photos 39 seconds apart — larger than 18 months of real change.
  Standardized capture is the measurement, not UI polish.

## Design decisions that are settled

Do not relitigate these without new measurement:

- **No forward forecasting.** A projection needs the slope pinned down far more
  tightly than "did this move?" does. Retrospective only.
- **No Skin Simulation rendering.** A real slope maps to intensity ~0.02–0.04,
  which renders as nothing; and intensity is clamped to [0.0, 1.0], so worsening
  could never be rendered at all. The "before" is now a real photograph, which
  is more credible anyway.
- **Three-way verdicts, never two.** Improved / worsened / no measurable change.
  The third is the common case on short trials and must never be presented as a
  failure of the product being tested.
- **Attribution is correlational, never causal.** There is no control face.
- **A trial runs until the user ends it.** A duration is set at creation —
  30 days by default, or from a clinician or a label claim — but it is a marker,
  never a lock, and open-ended is fully supported. The summary is generated when
  the user stops. Cost: the endpoint is chosen with the data already seen. That
  is acceptable here *only* because mid-trial metrics are shown in full, so
  stopping reveals nothing that wasn't on screen the day before — and it means
  a summary must never be framed as a pre-registered result.
- **Compliance is reported, including its shape.** Clustering matters as much as
  count — 8 consecutive days costs 2.33× the error bars of 8 spread days, and
  both read as `8/14`.

## Hackathon constraints that affect the code

From `BRIEF.md`, real requirements rather than aspirations:

- At least one YouCam API integrated in a genuinely working way; judging
  explicitly penalizes thin wrappers around a single call.
- The repo must be self-contained: all source, assets, and setup instructions
  needed to run the project, under a public license (MIT) or shared privately
  with the organizers.
- A **pre-seeded sample dataset** so judges see a full trajectory without
  waiting. The 20-photo reference series in `data/analysis/` is a completed
  175-day acne-medication trial and serves this directly. Keep the app runnable
  end-to-end from cached fixtures with no live API key.
- Face photos and `.env` must never be committed. `sample-photos/` and `data/`
  are gitignored; the shipped fixture set must be scrubbed of anything the owner
  does not intend to publish.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
