# CLAUDE.md

This file is a **triage index**, not the documentation itself. It tells you
which doc to read before touching a given piece of the system, plus the
handful of rules and commands that are genuinely needed at a glance no matter
what you're doing. When you learn or change something that belongs in a
specific doc, put it there — this file should stay short enough to read in
full every session.

## Where to look

| If you're about to... | Read |
|---|---|
| Touch trial/intervention/routine data, attribution, compliance, `targets[]` | [`docs/trial-model.md`](docs/trial-model.md) |
| Touch `src/products.mjs`, `src/inci.mjs`, `src/product-targets.mjs`, or the catalog | [`docs/product-identity.md`](docs/product-identity.md) |
| Touch `src/kalman.mjs`, `src/regression.mjs`, `src/noise-floor.mjs`, or the detection gate | [`docs/trial-analysis.md`](docs/trial-analysis.md) |
| Question a threshold, offset, or noise-floor number | [`docs/measurements.md`](docs/measurements.md) — the evidence base for most rules below |
| Touch capture, the camera guide, or anything pre-analysis | [`docs/capture-quality.md`](docs/capture-quality.md) |
| Touch anything that calls YouCam directly, or need a request/response shape | [`docs/youcam-api.md`](docs/youcam-api.md) |
| Build or change a screen, flow, or shared UI component | [`docs/app-ui.md`](docs/app-ui.md) — ratified section by section; read the section before building it |
| Need setup, the full command list, or "what's built" | [`README.md`](README.md) |
| Need the product spec / design of record | [`PRODUCT.md`](PRODUCT.md) |
| Need the external hackathon rules (not ours to edit) | [`BRIEF.md`](BRIEF.md) |
| Wonder why the forecasting/simulation design was dropped | [`docs/_archive/`](docs/_archive/) — retired, not authoritative |

Each doc above states its own current status inline (what's built vs. not,
dated as of when it changed) — that's the source of truth, not this file.

## Commands

```bash
npm install                              # Node 22+, macOS (sips is used for HEIC)
npm run dev                              # the web app, http://localhost:3000
npm run dev:mobile                       # same over HTTPS on the LAN IP, for a phone
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

node scripts/test-capture-guide.mjs      # camera guide geometry, offline, free
node scripts/test-attribution.mjs        # attribution table, offline, free
node scripts/test-products.mjs           # product identity + cache, offline, free
node scripts/test-trial-model.mjs        # trial model + detail-page maths, offline, free
node scripts/test-search.mjs             # search ranking, counts, concern labels, offline, free
node scripts/test-measurement.mjs        # bursts, noise floor, device offsets, scores, offline, free
node scripts/probe-catalog.mjs           # harvest product catalog, public web only, free

node scripts/scrape-incidecoder.mjs --report                     # incidecoder cache stats, free
node scripts/scrape-incidecoder.mjs                               # crawl sitemap + new slugs, public web only, free
node --env-file=.env.local scripts/migrate-catalog.mjs           # catalog_* tables, idempotent
node --env-file=.env.local scripts/import-catalog.mjs --dry-run  # parse + report, no DB writes
node --env-file=.env.local scripts/import-catalog.mjs            # load scraped cache into Neon
node --env-file=.env.local scripts/sync-catalog.mjs --dry-run    # daily job: what's new, no writes
node --env-file=.env.local scripts/sync-catalog.mjs              # /products/new -> Neon, free (also runs daily via GH Actions)

node --env-file=.env scripts/harvest-barcodes.mjs --dry-run   # batches, no spend
node --env-file=.env scripts/harvest-barcodes.mjs             # brands -> candidate barcodes (Gemini)
node scripts/harvest-barcodes.mjs --reparse                   # re-filter cached responses, free
node --env-file=.env scripts/verify-barcodes.mjs              # candidates -> verified (INCI)
node scripts/verify-barcodes.mjs --offline                    # replay INCI cache, free

node --env-file=.env scripts/classify-product.mjs --name "..."   # costs a Gemini call
```

`npm run build` typechecks and builds the app. There is no lint command yet.
Full pipeline diagrams and the offline test-suite list are in
[`README.md`](README.md), "Pipeline".

**The working tree has no safety net — commit finished work.** The repo has
gone uncommitted for days at a time despite substantial work landing on top,
and the reflog has shown a plain `git reset` on top of that. A styling change
that "keeps resetting" across sessions is almost always this: nothing wrong
with the code, the edit just never got committed, so the next `git reset` /
`checkout` / stash silently drops it and the next session redoes it from
scratch. Commit changes once they look right instead of leaving them
staged-only for days.

## Web app architecture

Next.js 16 (App Router) + Tailwind v4 + shadcn/ui, initialised on the **Base UI**
primitives — so composition uses `render={<Link />}`, **not** Radix's `asChild`.

**`src/` is the pipeline library, not Next's source directory.** The app lives in
`app/` at the repo root precisely so Next never claims `src/`. The `@/*` alias
resolves from the root; pipeline modules import as `@/src/concerns.mjs`.

The app reads `fixtures/trials.json` and needs no API key, no network, and no
photos — `data/` is gitignored because it holds faces, so the committed fixture
carries capture timestamps and trial metadata only. Regenerate it with
`scripts/seed-trials.mjs`; never hand-edit it. See
[`docs/trial-model.md`](docs/trial-model.md), "The committed fixture
synthesises the other eight," before treating any fixture value as measured.

**What the user creates is persistent; the reference series is not.** Saved
routines and saved trials live in Neon Postgres (`lib/routines.ts`,
`lib/trial-store.ts`, `DATABASE_URL` in `.env.local`). Capture photos live in
a private Vercel Blob store (`BLOB_READ_WRITE_TOKEN`).

**Accounts are Clerk; ownership is enforced in the data layer, not the route.**
Credentials, Google and the avatar are Clerk's (`lib/auth.ts`); the username,
skin type and birthday are ours (`lib/profile-store.ts`), and that row
existing is how the app knows sign-up finished. Every function in
`lib/routines.ts`, `lib/trial-store.ts` and `lib/profile-store.ts` **takes the
owner as an argument** rather than reading the session — an unscoped query
should be a type error, not a leak. `proxy.ts` only redirects; it is not the
boundary, and neither is the page that rendered a form, which is why each
server action resolves the caller itself. `currentUserId()` returns `'local'`
when Clerk is unconfigured, so a keyless build behaves exactly as it did
before accounts existed and the demo path stays writable.

A signed-out visitor reads the fixture and writes nothing. Keep it that way:
`/` and `/trials/[id]` are public because the reference series is a published
sample, and a trial that isn't yours 404s rather than admitting it exists.
`loadTrials()` lists the fixture only for the signed-out reader and the
keyless demo owner — a real account sees only its own trials. It **catches
the database failure rather than throwing**, the same deliberate degradation
`app/page.tsx` applies to routines: a missing `DATABASE_URL` costs what the
user created and never the twenty-photo reference series. Keep it that way —
nothing that renders the fixture may require the database.

## The product: Grapht

A skin trial log. You change something in your routine, log a standardised
selfie daily, and watch what measurably changes — for as long as you care to.
A **trial** is a *delta on a routine*: the existing routine is acknowledged
but never attributed; only tracked additions and removals can receive credit.
Full spec: [`PRODUCT.md`](PRODUCT.md).

**The credibility mechanism is the whole product.** The app knows its own
measurement error and refuses to report a change smaller than it. Every
metric that doesn't clear the detection gate is reported as *"no measurable
change"* — a statement about the instrument, not a verdict on a product. An
app that declines to conclude reads as instrumentation; an app that always
has an answer reads as a horoscope. Preserve this behaviour. Changes that
make the output more confident than the data supports — narrowing error
bars, narrating sub-threshold deltas, splitting credit between two products
that both target a metric, inferring causation — undercut the entire
premise.

**There is no fixed detection horizon, and you must not invent one.** Whether
a change is measurable depends only on how big it is relative to this user's
own scatter. A face wash can move oiliness 30 points overnight; a retinoid
can take a year — both are ordinary. See
[`docs/measurements.md`](docs/measurements.md), Finding 5, for the full
reasoning and why a "100–200 day" figure that once appeared here was a
misreading of that data.

## Rules that will silently corrupt results if broken

Each of these has already produced a wrong answer in this repo. They're kept
short here on purpose — full evidence is linked, not duplicated.

1. **Scores run 0–100 where HIGHER IS HEALTHIER.** "Acne got worse" means the
   score went *down*. Confuse this and every chart, slope, and verdict inverts.

2. **Use `raw_score` for everything; the app does not display `ui_score`
   anywhere.** `ui_score` distorts a real *change* by up to 3× depending on
   where it sits — [`docs/measurements.md`](docs/measurements.md), Finding 6.
   `ui_score` survives only in the fixture, so a synthesised concern stays
   shaped like a measured one.

3. **Face scale is part of the measurement** and is in the analysis cache key.
   Never mix crop scales in one series — doing so fabricated a set of
   confident, entirely false trends here once already. See
   [`docs/measurements.md`](docs/measurements.md), Finding 4, and
   [`docs/capture-quality.md`](docs/capture-quality.md) §5 for the live
   capture guide's target.

4. **Never mix SD and HD across a time series** — different models for
   `acne`, `texture`, and `pore`. `assertUniformResolution()` guards a single
   request; nothing guards a series, so this one is on you. See
   [`docs/youcam-api.md`](docs/youcam-api.md), "Concerns."

5. **Route every concern name through `src/concerns.mjs`.** It is the
   canonical vocabulary for all 15 analysis concerns; `targets[]` must use
   those keys, never free text. Use `normalizeConcerns()`, which throws on an
   unrecognised key — pass `{ drop: true }` only for raw model output. The
   *API* silently ignores an unrecognised key rather than rejecting it; our
   validator deliberately does the opposite.

6. **Never compare raw `raw_score` across devices.** Camera hardware shifts
   every metric except acne by 5–90 points. Route any cross-device comparison
   through `correctForDevice()` in `src/device-offset.mjs` first — see
   [`docs/measurements.md`](docs/measurements.md), Finding 2. Record the
   device on every capture regardless; a phone upgrade mid-trial injects a
   step change that must be corrected or visibly marked.

7. **Device-corrected observations are allowed outside 0–100, on purpose.**
   The correction is additive and unclamped. Do **not** clip them back into
   range — clipping hides exactly the cases where the correction is least
   trustworthy. `clampScore()` in `src/concerns.mjs` is for the retired
   forecast path only.

8. **Collect all 15 concerns on every capture that gets analysed**, regardless
   of what the trial targets. Billing is tiered per task, not per metric, so
   narrowing saves nothing; side effects appear in metrics nobody targeted;
   and you cannot retroactively ask a question of data you never collected.
   Since the daily-analysis pivot, "every capture that gets analysed" is just
   the **initial** and **final** photo per trial — see "API budget
   discipline" below and [`docs/trial-analysis.md`](docs/trial-analysis.md).

9. **Intervention `targets[]` bias narrow, and freeze at trial creation.** Too
   narrow pushes a real effect into the `unexplained` row, which is visible
   and correctable. Too broad makes `|T| > 1` fire on nearly every metric, so
   nothing is ever attributable — the attribution table stops carrying
   information at all. See [`docs/product-identity.md`](docs/product-identity.md),
   "Bias narrow, deliberately." Separately: once a trial starts, a cache
   refresh or classifier upgrade must never mutate its targets — that
   retroactively rewrites attribution with no new measurement.

## API budget discipline

Units are metered against a limited hackathon quota. The analysis pass is the
largest single spend in the project. Roughly **572 of 1040 units are already
consumed** (~468 left); check the console before spending more, and confirm
with the user before any batch run.

**A trial costs a flat ~40 units, not one analysis per day.** Only the
initial (trial creation) and final (trial end) photo are ever analysed; every
daily log in between is stored and shown in the timeline but carries no
score. Before this pivot a 30-day trial logged daily could spend ~600 units
on its own.

**Only successful tasks are billed.** Authentication, uploads, polling,
malformed requests, and failed tasks are all free — which makes schema
discovery by deliberate 4xx probing a legitimate and free tool
(`scripts/probe.mjs`).

Pricing is **tiered per task**: HD is 16 units for up to 7 concerns, so the
7th was free and an 8th likely crosses into the next tier. The 15-concern
price is unknown; one photo would reveal it for ~20 units.

**The reference dataset will not be backfilled to 15 concerns.** At ~20
units per photo that is ~400 of the remaining 468, for a demo asset that
already works. The demo fixture runs on 7 measured metrics (the rest
synthesised, see "Web app architecture" above); live trials collect all 15.

Everything is cached to disk. Prefer replaying fixtures over re-hitting the
live API, always. If a task times out locally it may still complete and bill
you — use `scripts/repoll.mjs` to recover the result rather than paying
twice.

**The INCI and Gemini keys are unrelated quotas** and cannot consume YouCam
units. INCI's free tier is 20,000 requests/month with free 404s. Both are
optional: `src/inci.mjs` runs in offline mode when `INCI_API_KEY` is unset,
and every test suite runs with no key at all.

**The LLM here is Gemini, not Claude.** `src/product-targets.mjs` uses
`@google/genai` against `gemini-3.6-flash`. Don't "helpfully" port it to the
Anthropic SDK — that is a deliberate choice, not an oversight.

**Google Search grounding is paid-tier only.** On a free Gemini key, plain
generation and vision both work, but `tools: [{ googleSearch: {} }]` returns
429 on the same key and model. This makes `readInciFromPhoto()` — the
ingredient-panel photo — the only automatic enrichment path on free tier.

## Design decisions that are settled

Do not relitigate these without new measurement:

- **No forward forecasting.** A projection needs the slope pinned down far
  more tightly than "did this move?" does. Retrospective only.
- **No Skin Simulation rendering.** A real slope maps to intensity
  ~0.02–0.04, which renders as nothing. The "before" is a real photograph,
  which is more credible anyway.
- **Three-way verdicts, never two.** Improved / worsened / no measurable
  change. The third is the common case on short trials and must never be
  presented as a failure of the product being tested.
- **Attribution is correlational, never causal.** There is no control face.
- **A trial runs until the user ends it.** A duration is a marker, never a
  lock; open-ended is fully supported. The summary is generated when the
  user stops — this is acceptable only because mid-trial metrics are shown
  in full, so stopping reveals nothing that wasn't on screen the day before.
- **Compliance is reported, including its shape.** Clustering matters as much
  as count — 8 consecutive days costs 2.33× the error bars of 8 spread days,
  and both read as `8/14`.
- **An analysed photo comes from the live camera. There is no upload.** An
  existing photo carries whatever framing, light and face scale it was taken
  under, and every one of those is part of the measurement (rules 3 and 4).
  A device that cannot give a 3:4 window 1080px across, or a denied camera
  permission, leaves that device with no way to log.
- **No clinical framing.** The user is not a test subject and the app is not
  a supervisor. `compliance` survives as an internal field name and never as
  a user-facing string — the surface word is **streak** or **days logged**.
- **Nothing is projected forward, anywhere in the UI.** No forecast, no
  trajectory, no extrapolated endpoint.
- **Mid-trial metrics are shown in full.** The daily log is the product, not
  a waiting room for the summary. The detection gate governs what gets
  *narrated*, never what gets *displayed*.
- **Visual validation of the frontend belongs to the user.** Don't launch a
  browser or take screenshots to check how something looks. Verify by build,
  route status, clean dev-server logs, and rendered markup, then hand over
  the URL.

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
