# Grapht

Run a real trial on your own skin. Change one thing in your routine, log a
standardised selfie each day, and watch your metrics move for as long as you
want to. End it whenever you've seen enough and get back what measurably
changed — including, honestly, what was too small to measure.

**The app knows its own measurement error and says so.** That's the whole
product. Every number comes with whether the instrument could actually resolve a
change that size, given how noisy it is and how consistently you logged.
Anything that didn't clear the bar is reported as *"no measurable change"* — a
statement about the instrument, not a verdict on the product.

An app that says "I can't tell" reads as instrumentation. An app that always has
an answer reads as a horoscope.

See [`PRODUCT.md`](PRODUCT.md) for the product design and [`BRIEF.md`](BRIEF.md)
for the hackathon requirements.

---

## Status

Pipeline and API integration work. In the web app the dashboard, saved routines,
and trial creation are built.

- [x] Photo ingestion, EXIF/orientation/colour normalisation
- [x] Face detection and standardised cropping
- [x] YouCam auth, upload, task, polling, result unpacking
- [x] Full 20-photo reference dataset analysed and cached
- [x] Measurement noise floor established
- [x] Device-offset correction
- [x] Trend estimation with uncertainty (Kalman + OLS blend)
- [x] Per-metric attribution — the four-way table from `docs/trial-model.md`
- [x] Product identity, derived-targets cache, ingredient enrichment
- [x] Dashboard — trials list, progress rings, seeded fixture trials
- [x] Saved routines — CRUD, classifier-derived targets, coverage at a glance
- [x] Trial data model — windows, captures, frozen baseline snapshots
- [x] New trial — products, routine, duration, frequency, analysed first capture
- [ ] Product search — targets still come from the product name alone
- [ ] Detection gate and summary generation
- [ ] Capture quality gate
- [ ] Trial detail, daily capture, summary screens

The project pivoted from forward forecasting to retrospective trials. The
estimation engine survived with a new job; the Skin Simulation renderer was
dropped. Rationale in [`PRODUCT.md`](PRODUCT.md) §8, superseded docs in
[`docs/_archive/`](docs/_archive/).

---

## Setup

Requires Node 22+ and macOS (ingestion uses `sips` for HEIC decoding and
Display P3 → sRGB conversion).

```bash
npm install
```

Create `.env` with credentials from the
[YouCam API console](https://yce.perfectcorp.com/api-console/):

```
YOUCAM_API_KEY=...
YOUCAM_SECRET_KEY=...

# Optional. Product lookup only — separate quotas, cannot cost YouCam units.
INCI_API_KEY=...        # https://inciapi.com  (free tier: 20k req/month)
GEMINI_API_KEY=...      # target classification from a product name or photo
```

`.env`, `sample-photos/`, and `data/` are gitignored. Face photos and API
credentials must never be committed.

The app runs end-to-end from cached fixtures with **no API key** — that's the
judging path.

### Running the web app

```bash
npm run dev          # http://localhost:3000
npm run build
```

Next.js 16 (App Router) + Tailwind v4 + shadcn/ui. It reads
`fixtures/trials.json` and needs no key, no network, and no photos.

**Anything you create yourself** — your account, saved routines and saved trials
— needs a database, and capture photos need a blob store. Accounts are Clerk,
also from the Marketplace. All three are Vercel-provisioned:

```bash
vercel link
vercel integration add neon --plan free_v3
vercel integration add clerk                             # accounts
vercel blob create-store <name> --access private --yes   # face photos: private
vercel env pull .env.local --yes
node --env-file=.env.local scripts/migrate-routines.mjs   # idempotent
node --env-file=.env.local scripts/migrate-trials.mjs     # idempotent
node --env-file=.env.local scripts/migrate-profiles.mjs   # idempotent
```

Skip this and the demo still works: the 20-photo reference series replays from
the committed fixture, the routines tab reports itself unavailable, and every
screen reads signed out. A build with no Clerk keys writes as one implicit local
owner, exactly as it did before accounts existed, so the demo path stays
writable rather than read-only.
Creating a trial needs both the database and `YOUCAM_API_KEY`, since its first
capture is analysed on save. `GEMINI_API_KEY` is likewise
optional — without it, you tick a product's concerns yourself instead of asking
the classifier.

---

## Pipeline

Every stage caches, so re-running is cheap and never re-spends units.

```
sample-photos/          source HEIC/JPEG, any device, any orientation
  ↓  scripts/prepare.mjs            HEIC→JPEG, P3→sRGB, EXIF rotation baked in
data/prepared/          upright sRGB JPEGs + data/manifest.json
  ↓  quality gate                   block bad captures, warn on drift    [not built]
  ↓  scripts/normalize-faces.mjs    BlazeFace detect → crop to 0.55 face fraction
data/normalized/        1920×2560, consistent face scale across all devices
  ↓  scripts/analyze-all.mjs        YouCam HD skin analysis  ← the only step that costs units
data/analysis/          per-photo scores, masks, raw JSON
  ↓  scripts/device-offset.mjs      cross-device offsets -> data/device-offsets.json
  ↓  scripts/summarize.mjs          series (raw + device-corrected), noise floor
  ↓  detection gate                 MDE from real timestamps; 3-way verdict [not built]
  ↓  src/attribution.mjs            per-metric: attributed/shared/confounded/unexplained
  ↓  summary                        gated narration + the user's own note   [not built]
```

Product picking runs alongside, at trial creation rather than per capture:

```
barcode scan ──┐
INCI photo ────┤→ src/inci.mjs           ingredient data + deterministic signals
name / label ──┘   src/product-targets.mjs  ranked classification, top 3 pre-ticked
                   src/products.mjs         identity, cache, provenance, freeze
                        ↓
                   Intervention.targets[]   frozen at trial creation
```

```bash
node scripts/prepare.mjs                 # free
node scripts/normalize-faces.mjs         # free
node scripts/analyze-all.mjs --dry-run   # show the plan and cost
node scripts/analyze-all.mjs --limit 1   # spend 16 units, verify
node scripts/analyze-all.mjs             # the rest
node scripts/summarize.mjs               # free
```

### Tests

Both suites are offline, deterministic, and free — no API key, no network.

```bash
node scripts/test-attribution.mjs        # the four-way attribution table
node scripts/test-products.mjs           # identity, cache, pre-tick policy
```

Product classification runs from the command line, for checking that the
classifier actually biases narrow rather than pre-ticking half the vocabulary:

```bash
node --env-file=.env scripts/classify-product.mjs --name "Paula's Choice 2% BHA Liquid"
node --env-file=.env scripts/classify-product.mjs --panel ./ingredients.jpg --save
```

`--panel` reads the ingredient list off a photo of the back label, feeds it to
the INCI database, and classifies from real ingredients. It is the strongest
path and the only automatic one on a free Gemini key — `--lookup`, which
searches the web for a published ingredient list, needs Google Search grounding
and returns 429 on free tier.

### Diagnostics

`scripts/forecast.mjs` and `scripts/kalman-forecast.mjs` still run, but they
project *forward*, which is no longer the product. `kalman-forecast.mjs` remains
the best way to watch the filter absorb the January 8 purge reversal with no
hardcoded purge logic. Nothing product-facing should call either.

`scripts/test-scenarios.mjs` scores forecast error at 7 days — the wrong
objective now. See [`docs/trial-analysis.md`](docs/trial-analysis.md), "Open
items."

### Utilities

| Script | Purpose | Cost |
|---|---|---|
| `probe.mjs` | Discover undocumented request schemas from 4xx bodies | free |
| `repoll.mjs` | Recover a timed-out task's result instead of paying again | free |
| `test-face-fraction.mjs` | Find the smallest face crop the API accepts | 16 units on first success |
| `probe-intensity.mjs` | Simulation intensity range and concern names | free (simulation is archived) |

---

## Budget discipline

Units are metered against a limited hackathon quota, and **the analysis pass is
the single largest spend in the project**. Two facts make it manageable:

1. **Failed tasks cost nothing.** Only `task_status: "success"` is billed.
   Probing, polling, uploading, and authenticating are all free — which makes
   schema discovery by deliberate 4xx probing a legitimate free tool.
2. **Everything is cached to disk.** `analyze-all.mjs` skips anything already
   analysed.

Consumed: **~572 of 1040 units** across 20 photos in HD at 7 concerns, including
calibration and one superseded pass. Roughly 468 remain. Check the console
before spending, and confirm before any batch run.

Pricing is **tiered per task, not per metric**: HD is 16 units for up to 7
concerns, so the 7th was free and an 8th likely crosses into the next tier. This
is why live captures should request all 14 concerns rather than only what a
trial targets — narrowing the set saves nothing and throws away side-effect data.

**The reference dataset will not be backfilled to 14 concerns.** At ~20 units per
photo that's ~400 of the remaining 468, for a demo asset that already works.

Never re-run the analysis pass to "refresh" results. Changing the face crop or
concern set invalidates the entire cache — face scale is part of the
measurement, which is why it's in the cache key.

---

## Architecture

`src/`

| Module | Responsibility |
|---|---|
| `youcam.mjs` | Auth handshake, upload, task creation, polling |
| `concerns.mjs` | Canonical concern vocabulary, SD/HD guard, score bounds |
| `results.mjs` | ZIP download, extraction, score normalisation |
| `face.mjs` | BlazeFace detection, standardised crop geometry |
| `device-offset.mjs` | Cross-device score offsets, derived from cached data |
| `sessions.mjs` | Group photo records into capture sessions (bursts) |
| `noise-floor.mjs` | Measurement noise floor from same-session score spread |
| `kalman.mjs` | Local-linear-trend filter + KF/OLS inverse-variance blend |
| `regression.mjs` | OLS fit with slope variance; purge-trough detection |
| `attribution.mjs` | Per-metric: who may be named next to an observed change |
| `products.mjs` | Product identity, derived-targets cache, provenance, freezing |
| `inci.mjs` | INCI API client; deterministic ingredient → concern signals |
| `product-targets.mjs` | Constrained Gemini classification into the 14-concern vocabulary |

Three things are load-bearing and easy to get wrong:

- **Scores run 0–100 where higher is healthier.** "Worse acne" is a *lower*
  number. Every chart and verdict inverts if this is confused.
- **Fit on `raw_score`, display `ui_score`.** The UI score is a non-linear
  consumer-facing compression and corrupts a slope.
- **Face scale is part of the measurement.** Changing the crop fraction changes
  pixels-per-cm of skin, which changes texture and pore. It's in the cache key
  for that reason.
- **Intervention targets bias narrow.** Over-broad `targets[]` don't add noise,
  they erase the output: every metric becomes "credit shared, unsplittable" and
  nothing is attributable to anything. Only high-confidence concerns are
  pre-ticked, capped at three.

### Web app

| Path | Responsibility |
|---|---|
| `app/` | Next.js App Router — `page.tsx` is the dashboard, `routines/` is routine CRUD, `trials/new/` is trial creation |
| `components/` | `trial-editor.tsx`, `routine-editor.tsx`, the cards and the ring, `concern-picker.tsx`, plus `ui/` from shadcn |
| `lib/trials.ts` | Trial types, fixture loader, day/streak derivation |
| `lib/trial-store.ts` | Saved trials in Neon, and the fixture ∪ database union |
| `lib/routines.ts` | Saved routines — queries, coverage, and the trial snapshot |
| `lib/auth.ts` | Who is asking. Clerk session → the owner every query is scoped to |
| `lib/profile-store.ts` | Username, skin type, birthday — and the one-time claim of pre-account rows |
| `lib/capture.ts` | A live capture: 14 concerns in HD, then private Vercel Blob |
| `lib/concerns.ts` | Display labels for the 14 concerns. Labels only, never keys |
| `fixtures/trials.json` | Seeded trials. Committed, and carries no pixels |
| `scripts/seed-trials.mjs` | Rebuilds that fixture from `data/manifest.json` |
| `scripts/migrate-routines.mjs` | Creates the routine tables. Idempotent |
| `scripts/migrate-trials.mjs` | Creates the trial tables. Idempotent |
| `scripts/migrate-profiles.mjs` | Creates the profile table. Idempotent |

**`src/` is the pipeline library, not the Next.js source directory.** The app
deliberately lives in `app/` at the repo root so Next never claims `src/`. The
`@/*` alias resolves from the root, so pipeline modules import as
`@/src/concerns.mjs`.

`fixtures/` exists because `data/` is gitignored — it holds faces. The fixture
carries capture timestamps and trial metadata only, which is what makes the
pre-seeded dataset shippable.

Full rules in [`CLAUDE.md`](CLAUDE.md).

## Documentation

| Doc | Contents |
|---|---|
| [`PRODUCT.md`](PRODUCT.md) | Product design of record |
| [`docs/app-ui.md`](docs/app-ui.md) | Screens and flows, ratified section by section |
| [`docs/trial-model.md`](docs/trial-model.md) | Trials, interventions, attribution, compliance |
| [`docs/product-identity.md`](docs/product-identity.md) | Product picking, INCI API, target derivation, caching |
| [`docs/trial-analysis.md`](docs/trial-analysis.md) | Detection gate, narration rules, engine |
| [`docs/measurements.md`](docs/measurements.md) | Empirical findings from the reference dataset |
| [`docs/capture-quality.md`](docs/capture-quality.md) | Pre-analysis quality gate design |
| [`docs/youcam-api.md`](docs/youcam-api.md) | Full API contract, mostly undocumented publicly |
| [`docs/_archive/`](docs/_archive/) | The retired forecasting/simulation design |

---

## Why BlazeFace and not Vision

Face cropping originally targeted Apple's Vision framework via a small Swift
helper. The installed Command Line Tools have a broken module map (duplicate
`SwiftBridging` definitions) that makes any Vision import fail to compile.
BlazeFace on the pure-JS tfjs backend needs no native build and runs unchanged
in the browser, so the live capture path can reuse `src/face.mjs` directly.
`scripts/detect-faces.swift` is kept for reference but is not in the pipeline.

---

## License

MIT.
