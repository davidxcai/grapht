# Grapht

### 🔗 **[skin-tracker-beige.vercel.app](https://skin-tracker-beige.vercel.app)**

Run a real trial on your own skin. Change one thing in your routine, log a
standardised selfie daily, and watch what measurably changes — for as long as
you care to. End it whenever you've seen enough.

**The app knows its own measurement error and says so.** Every metric that
doesn't clear the detection gate is reported as *"no measurable change"* — a
statement about the instrument, not a verdict on the product. An app that
declines to conclude reads as instrumentation; an app that always has an
answer reads as a horoscope.

See [`PRODUCT.md`](PRODUCT.md) for the product design and [`BRIEF.md`](BRIEF.md)
for the hackathon requirements this was built against.

---

## What's built

The web app is live at the link above, backed by Clerk accounts and Neon
Postgres:

- Dashboard, saved routines, and trial creation/detail with daily capture
- Community surfaces: a published-trial index at `/`, `/products`, `/search`,
  comments, saves, and view counts
- A Gemini-generated trial summary on trial end
- Product picking from a 183k-product catalog (`/catalog`, incidecoder-sourced,
  synced daily) — barcode scan, ingredient-photo, or typed name
- Live capture guide enforcing framing, face scale, and head pose; uneven
  lighting is reported but not yet blocking

**Only the first and last photo of a trial are analysed** — every daily log in
between is stored and shown in the timeline, but doesn't spend a YouCam unit.
This keeps a 30-day trial to a flat ~40 units regardless of how often the user
logs. See "Repository state" in [`CLAUDE.md`](CLAUDE.md) for the full history.

Not yet built: the rest of the capture quality gate (light colour, sharpness,
clipping, occlusion) and a name→barcode seed table that nothing reads yet.

The app runs end-to-end from a committed fixture (`fixtures/trials.json`) with
**no API key, no network, and no database** — that's the judging path.

---

## Setup

Requires Node 22+ and macOS (`sips` handles HEIC decoding).

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # typechecks and builds
```

Everything you create yourself — accounts, saved routines, saved trials, and
capture photos — needs Neon, Clerk, and Vercel Blob, all Vercel-provisioned:

```bash
vercel link
vercel integration add neon --plan free_v3
vercel integration add clerk
vercel blob create-store <name> --access private --yes
vercel env pull .env.local --yes

node --env-file=.env.local scripts/migrate-routines.mjs   # idempotent
node --env-file=.env.local scripts/migrate-trials.mjs     # idempotent
node --env-file=.env.local scripts/migrate-profiles.mjs   # idempotent
node --env-file=.env.local scripts/migrate-catalog.mjs    # idempotent
```

Skip this and the demo still works from the committed fixture — routines and
trial creation just report themselves unavailable.

Creating a live trial additionally needs `YOUCAM_API_KEY` (its first capture
is analysed on save). `GEMINI_API_KEY` and `INCI_API_KEY` are optional —
without them you tick a product's concerns by hand instead of getting a
classifier suggestion.

---

## Pipeline

```
live camera capture
  → capture guide       framing, face scale, head pose live; rest [not built]
  → YouCam HD Skin Analysis   initial + final photo only, 15 concerns
  → device-offset correction  cross-device, dormant while single-device
  → detection gate       MDE from real timestamps; 3-way verdict     [not built]
  → attribution          per-metric, from the trial's frozen targets[]
  → summary               gated narration + Gemini + the user's note
```

Product picking is separate, run once at trial creation: barcode scan,
ingredient-panel photo, or typed name → the incidecoder catalog / INCI data →
a frozen `targets[]` on the intervention. It never touches the measurement
path and cannot spend a YouCam unit.

### Offline test suites

Deterministic, no key, no network, no database, no YouCam spend. Each runs
individually:

```bash
node scripts/test-capture-guide.mjs      # camera guide geometry
node scripts/test-attribution.mjs        # the four-way attribution table
node scripts/test-products.mjs           # product identity + cache
node scripts/test-trial-model.mjs        # lib/trials.ts + lib/trial-detail.ts:
                                          #   day numbering, what counts as analysed,
                                          #   the inconclusive verdict, device
                                          #   correction, the wobble gate
node scripts/test-search.mjs             # lib/fuzzy.ts, lib/format.ts,
                                          #   lib/concerns.ts, lib/greeting.ts
node scripts/test-measurement.mjs        # burst grouping, noise floor,
                                          #   cross-device offsets, normalizeScores()
```

A suite that imports a `.ts` module needs `--experimental-strip-types` on Node
below 23.6, and reaches the app's `@/*` alias (and its extensionless JSON
imports) through `scripts/alias-hook.mjs` — a test script should not be the
reason app code changes its import style.

`scripts/test-scenarios.mjs` still runs but scores the wrong objective now
that the product doesn't forecast — see
[`docs/trial-analysis.md`](docs/trial-analysis.md), "Open items."

---

## Budget discipline

Units are metered against a limited hackathon quota. Roughly **572 of 1040
consumed** as of this writing (~468 remain) — check the console before any
batch analysis run.

- Only successful tasks are billed; probing, uploading, and polling are free.
- Everything is cached to disk — re-running never re-spends units.
- Since the initial/final-only pivot, a trial costs a flat ~40 units
  regardless of its length or how often the user logs.

Full discipline notes in [`CLAUDE.md`](CLAUDE.md), "API budget discipline."

---

## Documentation

| Doc | Contents |
|---|---|
| [`PRODUCT.md`](PRODUCT.md) | Product design of record |
| [`CLAUDE.md`](CLAUDE.md) | Triage index — which doc to read for what, plus the rules and commands needed at a glance |
| [`docs/app-ui.md`](docs/app-ui.md) | Screens and flows, ratified section by section |
| [`docs/trial-model.md`](docs/trial-model.md) | Trials, interventions, attribution, compliance |
| [`docs/product-identity.md`](docs/product-identity.md) | Product picking, catalog, INCI, target derivation |
| [`docs/trial-analysis.md`](docs/trial-analysis.md) | Detection gate, narration rules, engine |
| [`docs/measurements.md`](docs/measurements.md) | Empirical findings from the reference dataset |
| [`docs/capture-quality.md`](docs/capture-quality.md) | Pre-analysis quality gate design |
| [`docs/youcam-api.md`](docs/youcam-api.md) | Full API contract, mostly undocumented publicly |

---

## License

MIT.
