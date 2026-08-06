/**
 * Seed a *stored* trial for exercising daily capture. Free — Neon only.
 *
 *   node --env-file=.env.local scripts/seed-dev-trial.mjs
 *   node --env-file=.env.local scripts/seed-dev-trial.mjs --clean
 *
 * Costs no YouCam units and makes no Gemini call. Nothing here is analysed;
 * the scores are lifted from the committed fixture so the metric list and the
 * photo overlay render against plausible numbers.
 *
 * It exists because the capture prompt is otherwise unreachable. Creating a
 * trial through the app analyses its first photo — ~20 units — and that trial
 * is then logged for the day, so "No photo for today" cannot appear until
 * tomorrow. This writes the captures backdated and stops short of today.
 *
 * **Development only.** It writes `captured_at` directly, which the app never
 * does and must never do: captures are timestamped server-side precisely so a
 * compliance record cannot be edited after the fact, and because minimum
 * detectable effect is computed from the real timestamps, a moved photo
 * silently moves the error bars (`docs/app-ui.md` §5). Seeding a fake history
 * is a different act from logging one, and only this script is allowed it.
 *
 * `blob_url` points at the fixture's own photos under gitignored
 * `public/captures/`, so the timeline renders if the pipeline has been run and
 * degrades to "photo isn't available locally" if it hasn't.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { neon } from '@neondatabase/serverless';

const NAME = 'Dev capture test';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run: vercel env pull .env.local --yes');
  process.exit(1);
}
const sql = neon(url);

if (process.argv.includes('--clean')) {
  const gone = await sql`delete from trials where name = ${NAME} returning id`;
  console.log(`removed ${gone.length} seeded trial${gone.length === 1 ? '' : 's'}`);
  process.exit(0);
}

// The reference trial's five captures — real measured scores, in order.
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/trials.json'), 'utf8'),
);
const source = fixture.find((t) => t.id === 'did-it-hold-2026') ?? fixture[0];

// Four captures, oldest 5 days back, none today. The gap is the point: it is
// what puts the detail page into its "No photo for today" state.
const OFFSETS = [5, 4, 3, 2];

/** Both ends are inclusive, so the window spans one fewer day than it counts. */
const WINDOW_DAYS = 30;
const captures = OFFSETS.map((daysAgo, i) => ({
  daysAgo,
  concerns: source.captures[i]?.concerns ?? source.captures[0].concerns,
  photo: source.captures[i]?.photoUrl ?? null,
}));

await sql`delete from trials where name = ${NAME}`;

const [trial] = await sql`
  insert into trials (name, start_date, end_date, end_date_source)
  values (
    ${NAME},
    current_date - ${OFFSETS[0]}::int,
    current_date + ${WINDOW_DAYS - OFFSETS[0] - 1}::int,
    'user-chosen'
  )
  returning id`;

await sql.query(
  `insert into trial_interventions (trial_id, position, direction, name, started_on, targets)
   values ($1, 0, 'add', 'Test serum', current_date - $2::int, $3::analysis_concern[])`,
  [trial.id, OFFSETS[0], ['acne', 'texture']],
);

for (const capture of captures) {
  await sql.query(
    `insert into trial_captures (trial_id, captured_at, device, resolution, blob_url, concerns)
     values ($1, now() - ($2::int * interval '1 day'), 'seed-dev-trial', 'hd', $3, $4::jsonb)`,
    [trial.id, capture.daysAgo, capture.photo, JSON.stringify(capture.concerns)],
  );
}

console.log(`seeded "${NAME}" — ${captures.length} captures, none today`);
console.log(`  http://localhost:3000/trials/${trial.id}`);
console.log('  remove with: --clean');
