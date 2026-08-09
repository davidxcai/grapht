
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
| `fixtures/trials.json` | Seeded trials. Committed, carries no pixels — currently `[]` (2026-08-08) |
| `scripts/seed-trials.mjs` | Rebuilds that fixture from `data/manifest.json`. No longer hardcodes any trial |
| `scripts/migrate-routines.mjs` | Creates the routine tables. Idempotent |
| `scripts/migrate-trials.mjs` | Creates the trial tables. Idempotent |
| `scripts/migrate-profiles.mjs` | Creates the profile table. Idempotent |

**`src/` is the pipeline library, not the Next.js source directory.** The app
deliberately lives in `app/` at the repo root so Next never claims `src/`. The
`@/*` alias resolves from the root, so pipeline modules import as
`@/src/concerns.mjs`.

`fixtures/` exists because `data/` is gitignored — it holds faces. The fixture